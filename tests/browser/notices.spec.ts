import { expect, test, type Page } from '@playwright/test';
import { jogJointTo } from './selection-panels';

async function checkStageNotices(page: Page, stageSelector: string, selectors: string[]) {
  const boxes = await page.evaluate(({ stageSelector, selectors }) => {
    const stage = document.querySelector<HTMLElement>(stageSelector)!.getBoundingClientRect();
    return selectors.map(selector => {
      const element = document.querySelector<HTMLElement>(selector)!;
      const rect = element.getBoundingClientRect();
      return {
        visible: !element.hidden && rect.width > 0 && rect.height > 0,
        inside: rect.left >= stage.left && rect.right <= stage.right && rect.top >= stage.top && rect.bottom <= stage.bottom,
        centerOffset: Math.abs((rect.left + rect.right - stage.left - stage.right) / 2),
        topOffset: rect.top - stage.top,
        top: rect.top,
        bottom: rect.bottom,
      };
    });
  }, { stageSelector, selectors });
  for (const box of boxes) {
    expect(box.visible).toBe(true);
    expect(box.inside).toBe(true);
    expect(box.centerOffset).toBeLessThanOrEqual(2);
  }
  expect(boxes[0].topOffset).toBeLessThanOrEqual(75);
  for (let index = 1; index < boxes.length; index++) {
    expect(boxes[index].top).toBeGreaterThanOrEqual(boxes[index - 1].bottom);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('unreachable Cartesian targets preserve the pose without a notice for taps and holds', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#stage')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await expect(page.locator('#motion-collapse')).not.toHaveAttribute('title');
  const before = await page.locator('#stage-joint-fields output').allTextContents();
  await page.evaluate(async () => {
    // Use the module URL loaded by Vite, including any hot-reload version query.
    const moduleUrl = performance.getEntriesByType('resource')
      .find(entry => new URL(entry.name).pathname === '/src/kinematics.ts')?.name;
    if (!moduleUrl) throw new Error('Kinematics module was not loaded');
    const { IKSolver } = await import(/* @vite-ignore */ moduleUrl);
    const original = IKSolver.prototype.solve;
    const state = window as Window & { unreachableReasons?: string[]; restoreSolver?: () => void };
    state.unreachableReasons = [];
    IKSolver.prototype.solve = function (target: { position: { clone(): { set(x: number, y: number, z: number): unknown } } }) {
      const result = original.call(this, { ...target, position: target.position.clone().set(100, 100, 100) });
      state.unreachableReasons!.push(result.reason);
      return result;
    };
    state.restoreSolver = () => { IKSolver.prototype.solve = original; };
  });

  const jog = page.locator('[data-jog-axis="z"][data-jog-dir="1"]');
  await jog.evaluate(button => {
    const pointer = { bubbles: true, button: 0, pointerId: 1, pointerType: 'mouse' };
    button.dispatchEvent(new PointerEvent('pointerdown', pointer));
    button.dispatchEvent(new PointerEvent('pointerup', pointer));
  });
  await expect.poll(() => page.evaluate(() => (window as Window & { unreachableReasons?: string[] }).unreachableReasons?.length)).toBeGreaterThanOrEqual(1);
  await expect(page.locator('#solver-status')).toBeHidden();
  await expect(page.locator('#collision-toast')).toBeHidden();
  expect(await page.locator('#stage-joint-fields output').allTextContents()).toEqual(before);

  await page.locator('#language').click();
  await jog.dispatchEvent('pointerdown', { button: 0, pointerId: 1, pointerType: 'mouse' });
  await page.waitForTimeout(500);
  await jog.dispatchEvent('pointerup', { button: 0, pointerId: 1, pointerType: 'mouse' });
  const reasons = await page.evaluate(() => (window as unknown as { unreachableReasons: string[] }).unreachableReasons);
  expect(reasons.length).toBeGreaterThan(1);
  expect(reasons.every(reason => reason === 'unreachable')).toBe(true);
  await expect(page.locator('#solver-status')).toBeHidden();
  await expect(page.locator('#collision-toast')).toBeHidden();
  expect(await page.locator('#stage-joint-fields output').allTextContents()).toEqual(before);

  await page.evaluate(() => (window as unknown as { restoreSolver: () => void }).restoreSolver());
  await jog.focus();
  await page.keyboard.press('Enter');
  expect(await page.locator('#stage-joint-fields output').allTextContents()).not.toEqual(before);
});

test('collision, input and restored-scene notices stack at the top of the robot stage', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('uf-robots:scene', '{'));
  await page.goto('/?model=xarm6&rail=al0700&railPos=350&gripper=gripper-g2');
  await expect(page.locator('#stage')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await expect(page.locator('#scene-notices')).toContainText('保存的场景无效');

  await page.locator('#opening-number').fill('100');
  await page.locator('#opening-number').dispatchEvent('change');
  await page.locator('#rail-number').fill('701');
  await page.locator('#rail-number').dispatchEvent('change');
  await expect(page.locator('#opening-number')).toHaveAttribute('aria-describedby', 'opening-error');
  await expect(page.locator('#rail-number')).toHaveAttribute('aria-describedby', 'rail-error');
  await expect(page.locator('#opening-number')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#rail-number')).toHaveAttribute('aria-invalid', 'true');

  await page.locator('#joint-tab').click();
  await jogJointTo(page, 1, 60);
  await expect(page.locator('#collision-toast')).toBeVisible();
  const notices = ['#collision-toast', '#opening-error', '#rail-error', '#scene-notices'];
  for (const width of [1440, 800, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await checkStageNotices(page, '#stage', notices);
  }
  await page.locator('#language').click();
  await expect(page.locator('#opening-error')).toContainText('Opening');
  await expect(page.locator('#rail-error')).toContainText('Rail position');
  await expect(page.locator('#scene-notices')).toContainText('saved scene is invalid');
  await checkStageNotices(page, '#stage', notices);

  await page.locator('#opening-number').fill('20');
  await page.locator('#opening-number').dispatchEvent('change');
  await expect(page.locator('#opening-error')).toBeHidden();
  await expect(page.locator('#opening-number')).not.toHaveAttribute('aria-invalid');
  await expect(page.locator('#rail-error')).toBeVisible();
  await expect(page.locator('#scene-notices')).toBeVisible();
  await expect(page.locator('#dismiss-scene-notices')).toHaveAccessibleName('Dismiss scene notices');
  await page.locator('#dismiss-scene-notices').click();
  await expect(page.locator('#scene-notices')).toBeHidden();
  await expect(page.locator('#rail-error')).toBeVisible();
});

test('model loading failure is positioned above the 3D stage and can be retried', async ({ page }) => {
  await page.route('**/models/xarm6/xarm6.urdf', route => route.abort());
  await page.goto('/');
  await expect(page.locator('#load-message')).toContainText('模型加载失败');
  for (const width of [1440, 800, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await checkStageNotices(page, '#stage', ['#load-message']);
  }
  await page.locator('#language').click();
  await expect(page.locator('#load-message')).toContainText('Could not load the model');
  await page.unroute('**/models/xarm6/xarm6.urdf');
  await page.locator('#retry').click();
  await expect(page.locator('#stage')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await expect(page.locator('#load-message')).toBeHidden();
});

test('example loading errors appear at the top of the example stage and clear on retry', async ({ page }) => {
  await page.route('**/examples/packing-01/scene.xml', route => route.abort());
  await page.goto('/?example=packing-01');
  await expect(page.locator('#packing-error')).toContainText('场景加载失败', { timeout: 60_000 });
  for (const width of [1440, 800, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await checkStageNotices(page, '#packing-stage', ['#packing-error']);
  }
  await page.locator('#language').click();
  await expect(page.locator('#packing-error')).toContainText('Could not load the scene');
  await page.unroute('**/examples/packing-01/scene.xml');
  await page.locator('#packing-play').click();
  await expect(page.locator('#packing-stage')).toHaveAttribute('data-status', 'running', { timeout: 60_000 });
  await expect(page.locator('#packing-error')).toBeHidden();
});

test('example module failure is also presented above a stage with an accessible reload', async ({ page }) => {
  await page.route('**/src/packing.ts*', route => route.abort());
  await page.goto('/?example=packing-01');
  await expect(page.locator('.packing-module-failure [role="alert"]')).toContainText('示例加载失败');
  for (const width of [1440, 800, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await checkStageNotices(page, '.packing-module-failure .stage', ['.packing-module-failure [role="alert"]']);
  }
  await page.locator('#language').click();
  await expect(page.locator('.packing-module-failure button')).toHaveText('Reload page');
  await page.unroute('**/src/packing.ts*');
  await page.locator('.packing-module-failure button').click();
  await expect(page.locator('#packing-stage')).toHaveAttribute('data-status', 'running', { timeout: 60_000 });
});
