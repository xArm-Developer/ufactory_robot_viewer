import { devices, expect, test, type Page } from '@playwright/test';
import { returnToAssembly, selectRobot, viewStandalone } from './selection-panels';

const g2 = { id: 'gripper-g2', name: 'Gripper G2', min: 0, max: 84, url: 'https://www.shop.ufactory.cc/products/gripper-g2' };
const bio = { id: 'bio-gripper-g2', name: 'BIO Gripper G2', min: 71, max: 150, url: 'https://www.shop.ufactory.cc/products/bio-gripper-g2' };

async function ready(page: Page) {
  await expect(page.locator('#stage')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
}

async function setOpening(page: Page, value: string) {
  await page.locator('#opening-number').fill(value);
  await page.locator('#opening-number').dispatchEvent('change');
}

async function selectGripper(page: Page, value: '' | 'gripper-g2' | 'bio-gripper-g2') {
  const radioId = value ? `#tool-gripper-${value}` : '#tool-gripper-none';
  await page.locator(radioId).check();
}

test('standalone grippers load on demand, open and close, and retain valid direct-link state', async ({ page }) => {
  test.setTimeout(180_000);
  const loaded: string[] = [];
  page.on('response', response => { if (response.url().endsWith('.glb') && response.ok()) loaded.push(response.url()); });
  await page.goto('/');
  await ready(page);
  expect(loaded.every(url => !url.includes('gripper'))).toBe(true);

  for (const spec of [g2, bio]) {
    await viewStandalone(page, spec.id);
    await ready(page);
    await expect(page.locator('#stage')).toHaveAttribute('data-mode', 'gripper');
    await expect(page.locator('#stage-heading')).toHaveText(spec.name);
    await expect(page.locator('#stage-telemetry')).toBeHidden();
    await expect(page.locator('#arm-controls')).toBeHidden();
    await expect(page.locator('#robot-select')).toHaveValue('standalone');
    await expect(page.locator('#tool-summary')).toHaveText('独立查看中');
    await expect(page.locator('#standalone-hint')).toBeVisible();
    await expect(page.locator(`[data-gripper-view="${spec.id}"]`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#toggle-tcp-frame')).toBeHidden();
    await expect(page.locator('#opening-number')).toHaveValue(`${spec.max}.0`);
    await expect(page.locator('#assets a')).toHaveCount(1);
    await expect(page.locator('#assets a')).toHaveAttribute('href', spec.url);
    // Changing the opening should not recreate or repeatedly announce the unchanged inventory.
    await page.locator('#assets li').first().evaluate(element => { (element as HTMLElement).dataset.preserved = 'yes'; });
    const canvas = page.locator('#canvas-area canvas');
    const openImage = await canvas.screenshot();
    await setOpening(page, String(spec.min));
    await expect(page.locator('#opening-number')).toHaveValue(`${spec.min}.0`);
    await expect(page.locator('#assets li').first()).toHaveAttribute('data-preserved', 'yes');
    await page.waitForTimeout(100);
    expect((await canvas.screenshot()).equals(openImage)).toBe(false);
    expect(page.url()).toContain(`opening=${spec.min}.0`);
    await setOpening(page, String(spec.min - 0.1));
    await expect(page.locator('#opening-number')).toHaveValue(`${spec.min}.0`);
    await expect(page.locator('#status-text')).toContainText('有效');
    await setOpening(page, '');
    await expect(page.locator('#opening-number')).toHaveValue(`${spec.min}.0`);
    await setOpening(page, String(spec.min + 0.05));
    await expect(page.locator('#opening-number')).toHaveValue(`${spec.min}.0`);
    const middleValue = (spec.min + spec.max) / 2;
    const middle = middleValue.toFixed(1);
    await page.locator('#opening-range').fill(String(middleValue));
    await expect(page.locator('#opening-number')).toHaveValue(middle);
    expect(page.url()).toContain(`opening=${middle}`);
    await setOpening(page, String(spec.min));
    await page.reload();
    await ready(page);
    await expect(page.locator('#opening-number')).toHaveValue(`${spec.min}.0`);
  }
});

test('all eight assemblies retain opening and pose, show fixed TCP and official assets', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/');
  await ready(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.locator('#joint-tab').click();
  await page.locator('#joint-number-0').fill('20');
  await page.locator('#joint-number-0').dispatchEvent('change');

  for (const id of ['xarm5', 'xarm6', 'xarm7', 'uf850']) {
    if (id !== 'xarm5') {
      // A compatible arm switch preserves the installed gripper and its opening.
      await selectRobot(page, id);
      await ready(page);
      await expect(page.locator('#tool-summary')).toHaveText(bio.name);
      await expect(page.locator('#opening-number')).toHaveValue('110.0');
    } else {
      await selectRobot(page, id);
      await ready(page);
    }
    await page.locator('#joint-number-0').fill('20');
    await page.locator('#joint-number-0').dispatchEvent('change');
    for (const spec of [g2, bio] as const) {
      await selectGripper(page, spec.id as 'gripper-g2' | 'bio-gripper-g2');
      await ready(page);
      await expect(page.locator('#stage')).toHaveAttribute('data-gripper', spec.id);
      await expect(page.locator('#stage-joint-0')).toHaveText('20.00');
      await expect(page.locator('#assets a')).toHaveCount(2);
      await expect(page.locator('#assets a').nth(1)).toHaveAttribute('href', spec.url);
      const fixedTcp = await page.locator('#fk-fields').innerText();
      await setOpening(page, spec.id === bio.id ? '110' : '42');
      expect(await page.locator('#fk-fields').innerText()).toBe(fixedTcp);
      await expect(page.locator('#stage-joint-0')).toHaveText('20.00');
      await page.locator('#cartesian-tab').click();
      const z = Number(await page.locator('#fk-2').innerText());
      await page.locator('[data-jog-axis="z"][data-jog-dir="1"]').click();
      await expect(page.locator('#status-text')).toHaveText('目标已求解');
      expect(Number(await page.locator('#fk-2').innerText()) - z).toBeCloseTo(1, 1);
      await page.locator('#joint-tab').click();
      // The jog changes multiple joints; adjust each manually before the next case.
      const jointCount = await page.locator('#joint-list .joint-row').count();
      for (let i = 0; i < jointCount; i++) {
        await page.locator(`#joint-number-${i}`).fill('0');
        await page.locator(`#joint-number-${i}`).dispatchEvent('change');
      }
      await page.locator('#joint-number-0').fill('20');
      await page.locator('#joint-number-0').dispatchEvent('change');
    }
  }
  const attachedTcp = await page.locator('#fk-fields').innerText();
  await selectGripper(page, '');
  await ready(page);
  await expect(page.locator('#stage')).not.toHaveAttribute('data-gripper');
  await expect(page.locator('#assets a')).toHaveCount(1);
  expect(await page.locator('#fk-fields').innerText()).not.toBe(attachedTcp);
  await selectGripper(page, 'bio-gripper-g2');
  await ready(page);
  await selectRobot(page, 'lite6');
  await ready(page);
  await expect(page.locator('#tool-summary')).toHaveText('无');
  await expect(page.locator('#tool-dropdown')).toBeVisible();
  await expect(page.locator('#tool-sensor-group')).toBeHidden();
  await expect(page.locator('[data-standalone-view="ai1500"]')).toBeHidden();
  await expect(page.locator('#gripper-control')).toBeHidden();
  await expect(page.locator('#assets a')).toHaveCount(1);
  expect(page.url()).not.toContain('gripper=');
  expect(errors).toEqual([]);
});

test('standalone view preserves the saved assembly and selectors return to valid assemblies', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/?model=xarm7&gripper=bio-gripper-g2&opening=110.1');
  await ready(page);
  await page.locator('#joint-tab').click();
  await page.locator('#joint-number-0').fill('20');
  await page.locator('#joint-number-0').dispatchEvent('change');

  // Matching the mounted gripper starts at the saved opening, but edits remain separate.
  await viewStandalone(page, bio.id);
  await ready(page);
  await expect(page.locator('#opening-number')).toHaveValue('110.1');
  await setOpening(page, '130');
  await returnToAssembly(page);
  await ready(page);
  await expect(page.locator('#stage')).toHaveAttribute('data-robot', 'xarm7');
  await expect(page.locator('#tool-summary')).toHaveText(bio.name);
  await expect(page.locator('#opening-number')).toHaveValue('110.1');
  await expect(page.locator('#stage-joint-0')).toHaveText('0.00');
  await expect(page.locator('#assets a')).toHaveCount(2);
  expect(page.url()).toContain('model=xarm7');
  expect(page.url()).toContain('opening=110.1');

  // A different standalone gripper starts fully open; switching arms retains the saved assembly.
  await viewStandalone(page, g2.id);
  await ready(page);
  await expect(page.locator('#opening-number')).toHaveValue('84.0');
  await setOpening(page, '42');
  await selectRobot(page, 'uf850');
  await ready(page);
  await expect(page.locator('#stage')).toHaveAttribute('data-robot', 'uf850');
  await expect(page.locator('#tool-summary')).toHaveText(bio.name);
  await expect(page.locator('#opening-number')).toHaveValue('110.1');

  // Selecting the already mounted gripper restores its saved opening; a new one starts open.
  await viewStandalone(page, g2.id);
  await ready(page);
  await selectGripper(page, 'bio-gripper-g2');
  await ready(page);
  await expect(page.locator('#opening-number')).toHaveValue('110.1');
  await viewStandalone(page, bio.id);
  await ready(page);
  await setOpening(page, '130');
  await selectGripper(page, 'gripper-g2');
  await ready(page);
  await expect(page.locator('#stage')).toHaveAttribute('data-gripper', g2.id);
  await expect(page.locator('#opening-number')).toHaveValue('84.0');

  await viewStandalone(page, g2.id);
  await ready(page);
  await setOpening(page, '30');
  await selectGripper(page, '');
  await ready(page);
  await expect(page.locator('#stage')).not.toHaveAttribute('data-gripper');
  await expect(page.locator('#assets a')).toHaveCount(1);
  await expect(page.locator('#gripper-control')).toBeHidden();

  // Lite 6 permits a return via None, but never permits an incompatible tool.
  await selectRobot(page, 'lite6');
  await ready(page);
  await viewStandalone(page, bio.id);
  await ready(page);
  await expect(page.locator('#tool-dropdown')).toBeVisible();
  await expect(page.locator(`#tool-gripper-${bio.id}`)).toBeDisabled();
  await expect(page.locator('#tool-sensor-check')).toBeDisabled();
  await expect(page.locator('#tool-sensor-group')).toBeHidden();
  await expect(page.locator('[data-standalone-view="ai1500"]')).toBeHidden();
  await expect(page.locator('#tool-dropdown')).toHaveAccessibleDescription(/独立查看/);
  await selectGripper(page, '');
  await ready(page);
  await expect(page.locator('#stage')).toHaveAttribute('data-robot', 'lite6');
  await expect(page.locator('#tool-dropdown')).toBeVisible();
  await expect(page.locator('#stage')).not.toHaveAttribute('data-gripper');
});

test('direct standalone links return to a default empty xArm 6 assembly', async ({ page }) => {
  for (const spec of [g2, bio]) {
    await page.goto(`/?model=${spec.id}&opening=${spec.min}`);
    await ready(page);
    await expect(page.locator('#opening-number')).toHaveValue(`${spec.min}.0`);
    await returnToAssembly(page);
    await ready(page);
    await expect(page.locator('#robot-select')).toHaveValue('xarm6');
    await expect(page.locator('#tool-summary')).toHaveText('无');
    await expect(page.locator('#stage')).toHaveAttribute('data-robot', 'xarm6');
    await expect(page.locator('#stage')).not.toHaveAttribute('data-gripper');
    expect(page.url()).not.toContain('opening=');
  }
});

test('direct links, incompatible parameters, localization and mobile layout', async ({ browser }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  await page.goto('/?model=xarm7&gripper=bio-gripper-g2&opening=110.1');
  await ready(page);
  await expect(page.locator('#opening-number')).toHaveValue('110.1');
  await expect(page.locator('#assets a')).toHaveCount(2);
  await page.locator('#language').click();
  await expect(page.locator('#gripper-control')).toContainText('Opening');
  await expect(page.locator('#assets')).toContainText('Accessory');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('/?model=lite6&gripper=gripper-g2&opening=42');
  await ready(page);
  await expect(page.locator('#tool-summary')).toHaveText('无');
  await expect(page.locator('#assets a')).toHaveCount(1);
  expect(page.url()).not.toContain('gripper=');
  await page.goto('/?model=xarm6&gripper=unknown&opening=42');
  await ready(page);
  await expect(page.locator('#tool-summary')).toHaveText('无');
  expect(page.url()).not.toContain('gripper=');
  await page.goto('/?model=bio-gripper-g2&opening=999');
  await ready(page);
  await expect(page.locator('#opening-number')).toHaveValue('150.0');
  await page.locator('#language').click();
  await expect(page.locator('#robot-select')).toHaveValue('standalone');
  await expect(page.locator('#tool-summary')).toHaveText('Standalone view');
  await expect(page.locator('#standalone-hint')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const armSelect = (await page.locator('#robot-models').boundingBox())!;
  const toolSelect = (await page.locator('#tool-dropdown').boundingBox())!;
  expect(toolSelect.y).toBeGreaterThan(armSelect.y + armSelect.height);
  await returnToAssembly(page);
  await ready(page);
  await expect(page.locator('#robot-select')).toHaveValue('xarm6');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await context.close();
});

test('superseded gripper loads and failed resources are handled with retry', async ({ page }) => {
  test.setTimeout(180_000);
  let release!: () => void;
  let requested!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const intercepted = new Promise<void>(resolve => { requested = resolve; });
  await page.route('**/models/gripper-g2/base.glb', async route => { requested(); await gate; await route.abort(); });
  await page.goto('/');
  await ready(page);
  await selectGripper(page, 'gripper-g2');
  await intercepted;
  await expect(page.locator('#assets a')).toHaveCount(0);
  await selectGripper(page, 'bio-gripper-g2');
  await ready(page);
  release();
  await page.waitForTimeout(500);
  await expect(page.locator('#stage')).toHaveAttribute('data-gripper', bio.id);
  await expect(page.locator('#assets a')).toHaveCount(2);
  await expect(page.locator('#load-message')).toBeHidden();
  await selectGripper(page, '');
  await ready(page);
  let attempts = 0;
  await page.route('**/models/bio-gripper-g2/bio_gripper_g2_base.glb', route => {
    attempts++;
    return attempts === 1 ? route.abort() : route.continue();
  });
  await selectGripper(page, 'bio-gripper-g2');
  await expect(page.locator('#load-message')).toContainText('模型加载失败');
  await expect(page.locator('#assets a')).toHaveCount(0);
  await page.locator('#retry').click();
  await ready(page);
  await expect(page.locator('#assets a')).toHaveCount(2);
  expect(attempts).toBe(2);
});

test('standalone loads can be superseded or retried without changing the saved assembly', async ({ page }) => {
  test.setTimeout(180_000);
  let release!: () => void;
  let requested!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const intercepted = new Promise<void>(resolve => { requested = resolve; });
  let attempts = 0;
  await page.route('**/models/gripper-g2/base.glb', async route => {
    attempts++;
    if (attempts === 1) { requested(); await gate; await route.continue(); }
    else if (attempts === 2) await route.abort();
    else await route.continue();
  });
  await page.goto('/?model=xarm7&gripper=bio-gripper-g2&opening=110');
  await ready(page);
  await viewStandalone(page, g2.id);
  await intercepted;
  await expect(page.locator('#assets a')).toHaveCount(0);
  await selectRobot(page, 'xarm7');
  await ready(page);
  release();
  await page.waitForTimeout(500);
  await expect(page.locator('#stage')).toHaveAttribute('data-robot', 'xarm7');
  await expect(page.locator('#stage')).toHaveAttribute('data-gripper', bio.id);
  await expect(page.locator('#opening-number')).toHaveValue('110.0');
  await expect(page.locator('#assets a')).toHaveCount(2);
  await expect(page.locator('#load-message')).toBeHidden();
  await expect(page.locator('#canvas-area canvas')).toHaveAttribute('aria-label', /xArm 7 and BIO Gripper G2/);

  await viewStandalone(page, g2.id);
  await expect(page.locator('#load-message')).toContainText('模型加载失败');
  await expect(page.locator('#assets a')).toHaveCount(0);
  await page.locator('#retry').click();
  await ready(page);
  await expect(page.locator('#assets a')).toHaveCount(1);
  await expect(page.locator('#assets a')).toHaveAttribute('href', g2.url);
  await returnToAssembly(page);
  await ready(page);
  await expect(page.locator('#stage')).toHaveAttribute('data-robot', 'xarm7');
  await expect(page.locator('#opening-number')).toHaveValue('110.0');
  expect(attempts).toBe(3);
});

test('model selector and standalone controls work with keyboard and both languages', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await expect(page.getByRole('combobox', { name: '机械臂', exact: true })).toBeVisible();
  await expect(page.locator('#robot-select')).toHaveValue('xarm6');
  await expect(page.getByRole('switch', { name: '直线滑轨', exact: true })).not.toBeChecked();
  await expect(page.locator('#tool-dropdown')).toHaveAccessibleName('末端工具');
  await expect(page.locator('#tool-summary')).toHaveText('无');
  await expect(page.locator('#robot-select')).toHaveAccessibleDescription('');
  await expect(page.locator('#tool-dropdown')).toHaveAccessibleDescription('');
  await page.locator('#robot-select').focus();
  await page.keyboard.press('ArrowDown');
  await ready(page);
  await expect(page.locator('#robot-select')).toHaveValue('xarm7');
  await expect(page.locator('#tool-menu')).toBeVisible();
  await page.locator(`#tool-gripper-${g2.id}`).focus();
  await page.keyboard.press('Space');
  await ready(page);
  await expect(page.locator('#tool-summary')).toHaveText(g2.name);
  const standaloneButton = page.locator(`[data-gripper-view="${g2.id}"]`);
  await standaloneButton.focus();
  await page.keyboard.press('Enter');
  await ready(page);
  await expect(standaloneButton).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#language').click();
  await expect(page.getByRole('combobox', { name: 'Robot arm', exact: true })).toBeVisible();
  await expect(page.locator('#robot-select')).toHaveValue('standalone');
  await expect(page.locator('#tool-dropdown')).toHaveAccessibleName('End effector');
  await expect(page.locator('#tool-summary')).toHaveText('Standalone view');
  await expect(page.locator('#standalone-hint')).toContainText('Viewing an end effector');
  await expect(page.locator('#robot-select')).toHaveAccessibleDescription(/Viewing an end effector/);
  await expect(page.locator('#tool-dropdown')).toHaveAccessibleDescription(/Viewing an end effector/);
  await page.locator('#return-assembly').focus();
  await page.keyboard.press('Enter');
  await ready(page);
  await expect(page.locator('#robot-select')).toHaveValue('xarm7');
  await expect(page.locator('#tool-summary')).toHaveText(g2.name);
});

test('reselecting a failed standalone direct link preserves its opening', async ({ page }) => {
  let attempts = 0;
  await page.route('**/models/gripper-g2/base.glb', route => {
    attempts++;
    return attempts === 1 ? route.abort() : route.continue();
  });
  await page.goto('/?model=gripper-g2&opening=42');
  await expect(page.locator('#load-message')).toContainText('模型加载失败');
  await viewStandalone(page, g2.id);
  await ready(page);
  await expect(page.locator('#opening-number')).toHaveValue('42.0');
  expect(page.url()).toContain('opening=42.0');
  expect(attempts).toBe(2);
});

test('BIO visual pad faces match the commanded gap and remain symmetric', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/?model=bio-gripper-g2');
  await ready(page);
  const measurements = await page.evaluate(async () => {
    const loadModule = (path: string) => import(/* @vite-ignore */ path);
    const [{ GLTFLoader }, { DRACOLoader }, { createGripperModel }, { getGripper }] = await Promise.all([
      loadModule('/node_modules/three/examples/jsm/loaders/GLTFLoader.js'),
      loadModule('/node_modules/three/examples/jsm/loaders/DRACOLoader.js'),
      loadModule('/src/gripper-model.ts'), loadModule('/src/grippers.ts'),
    ]);
    const decoder = new DRACOLoader().setDecoderPath('/draco/');
    const loader = new GLTFLoader().setDRACOLoader(decoder);
    const names = ['bio_gripper_g2_base', 'bio_gripper_g2_left_finger', 'bio_gripper_g2_right_finger'];
    const scenes = await Promise.all(names.map(name => loader.loadAsync(`/models/bio-gripper-g2/${name}.glb`)));
    const parts = Object.fromEntries(names.map((name, index) => [name, scenes[index].scene]));
    const model = createGripperModel(getGripper('bio-gripper-g2'), parts);
    return [71, 110, 150].map(opening => {
      model.setOpening(opening);
      model.root.updateMatrixWorld(true);
      const inner = (part: any, left: boolean) => {
        let limit = left ? -Infinity : Infinity;
        part.traverse((mesh: any) => {
          if (!mesh.isMesh) return;
          const positions = mesh.geometry.getAttribute('position');
          const point = model.root.position.clone();
          for (let i = 0; i < positions.count; i++) {
            point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
            model.root.worldToLocal(point);
            // The reference URDF identifies the gripping surface at X > 31 mm in the finger frame.
            if (point.x > 0.059 + 0.031) limit = left ? Math.max(limit, point.y) : Math.min(limit, point.y);
          }
        });
        return limit * 1000;
      };
      const left = inner(parts.bio_gripper_g2_left_finger, true);
      const right = inner(parts.bio_gripper_g2_right_finger, false);
      return { opening, left, right, gap: right - left };
    });
  });
  for (const { opening, left, right, gap } of measurements) {
    expect(Math.abs(gap - opening)).toBeLessThan(0.02);
    expect(Math.abs(left + right)).toBeLessThan(0.02);
  }
});
