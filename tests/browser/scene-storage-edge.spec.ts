import { expect, test, type Page } from '@playwright/test';
import { jogJointTo, selectGripper, selectRobot } from './selection-panels';

const key = 'uf-robots:scene';
const ready = async (page: Page) => expect(page.locator('#stage')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
const raw = async (page: Page) => page.evaluate(key => localStorage.getItem(key), key);
const saved = async (page: Page) => JSON.parse((await raw(page))!);
const put = async (page: Page, value: string) => page.evaluate(({ key, value }) => {
  window.dispatchEvent(new Event('pagehide'));
  localStorage.setItem(key, value);
}, { key, value });
const collidingXarm7 = JSON.stringify({
  schemaVersion: 1, assetId: 'xarm7', hulls: [
    { bodyKey: 'link_base', kind: 'box', center: [0, 0, 0], halfExtents: [2, 2, 2] },
    { bodyKey: 'link7', kind: 'box', center: [0, 0, 0], halfExtents: [2, 2, 2] },
  ],
});

test('collision stops at a saved safe joint pose and rejected accessories never replace it', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await ready(page);
  await page.locator('#joint-tab').click();
  await jogJointTo(page, 1, 40);
  const lastSafe = Number(await page.locator('#stage-joint-1').innerText());
  expect(lastSafe).toBeGreaterThan(20);
  expect(lastSafe).toBeLessThan(40);
  await expect(page.locator('#collision-toast')).toBeVisible();
  expect((await saved(page)).joints[1] * 180 / Math.PI).toBeCloseTo(lastSafe, 2);
  await page.reload();
  await ready(page);
  await expect(page.locator('#stage-joint-1')).toHaveText(lastSafe.toFixed(2));
  await expect(page.locator('#scene-notices')).toBeHidden();

  await page.locator('#joint-tab').click();
  await jogJointTo(page, 1, 0);
  for (const [index, angle] of [70, 2, -13, -4, 104, -44].entries()) await jogJointTo(page, index, angle);
  const before = await raw(page);
  await selectGripper(page, 'bio-gripper-g2');
  await ready(page);
  await expect(page.locator('#collision-toast')).toBeVisible();
  await expect(page.locator('#tool-gripper-select')).toHaveValue('');
  expect(await raw(page)).toBe(before);
  await page.reload();
  await ready(page);
  expect(await raw(page)).toBe(before);
  await expect(page.locator('#stage-joint-4')).toHaveText('104.00');
});

test('a superseded accessory load cannot save a partial or obsolete scene', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.locator('#joint-tab').click();
  await jogJointTo(page, 0, 3);
  let release!: () => void;
  let intercepted!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const waiting = new Promise<void>(resolve => { intercepted = resolve; });
  await page.route('**/models/gripper-g2/base.glb', async route => { intercepted(); await gate; await route.abort(); });
  await selectGripper(page, 'gripper-g2');
  await waiting;
  expect((await saved(page)).gripper).toBeNull();
  await selectGripper(page, 'bio-gripper-g2');
  await ready(page);
  await expect.poll(async () => (await saved(page)).gripper).toBe('bio-gripper-g2');
  const result = await saved(page);
  expect(result.joints[0]).toBeCloseTo(3 * Math.PI / 180, 6);
  expect(result.opening).toBe(150);
  release();
  await page.waitForTimeout(500);
  expect(await saved(page)).toEqual(result);
  await page.reload();
  await ready(page);
  await expect(page.locator('#stage')).toHaveAttribute('data-gripper', 'bio-gripper-g2');
  await expect(page.locator('#stage-joint-0')).toHaveText('3.00');
});

test('if both saved and link scenes collide the default loads while the record remains intact', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const invalidScene = JSON.stringify({
    version: 1, robot: 'xarm6', joints: [0, 40 * Math.PI / 180, 0, 0, 0, 0],
    rail: null, railMm: 0, sensor: null, gripper: null, opening: null,
  });
  await put(page, invalidScene);
  // Inject colliding hulls to exercise a link-scene collision independent of current model assets.
  await page.route('**/models/xarm7/collision.json', route => route.fulfill({
    contentType: 'application/json', body: collidingXarm7,
  }));
  await page.goto('/?model=xarm7');
  await ready(page);
  await expect(page.locator('#stage')).toHaveAttribute('data-robot', 'xarm6');
  await expect(page.locator('#scene-notices')).toContainText('保存的场景发生碰撞');
  await expect(page.locator('#scene-notices')).toContainText('链接场景发生碰撞');
  expect(await raw(page)).toBe(invalidScene);
  expect(new URL(page.url()).searchParams.has('model')).toBe(false);
  await page.locator('#joint-tab').click();
  await jogJointTo(page, 0, 1);
  await expect.poll(async () => (await saved(page)).joints[0]).toBeCloseTo(Math.PI / 180, 6);
});

test('a colliding model switch restores the entire previous scene', async ({ page }) => {
  await page.goto('/?gripper=gripper-g2&opening=42');
  await ready(page);
  await page.locator('#joint-tab').click();
  await jogJointTo(page, 0, 5);
  const before = await raw(page);
  await page.route('**/models/xarm7/collision.json', route => route.fulfill({
    contentType: 'application/json', body: collidingXarm7,
  }));
  await selectRobot(page, 'xarm7');
  await ready(page);
  await expect(page.locator('#stage')).toHaveAttribute('data-robot', 'xarm6');
  await expect(page.locator('#stage')).toHaveAttribute('data-gripper', 'gripper-g2');
  await expect(page.locator('#stage-joint-0')).toHaveText('5.00');
  await expect(page.locator('#collision-toast')).toBeVisible();
  expect(await raw(page)).toBe(before);
  await page.reload();
  await ready(page);
  await expect(page.locator('#stage-joint-0')).toHaveText('5.00');
  await expect(page.locator('#opening-number')).toHaveValue('42.0');
});

test('storage read failure reports once and leaves controls usable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } });
  });
  await page.goto('/');
  await ready(page);
  await expect(page.locator('#scene-notices')).toContainText('无法使用浏览器存储');
  await page.locator('#joint-tab').click();
  await jogJointTo(page, 0, 2);
  await expect(page.locator('#stage-joint-0')).toHaveText('2.00');
  await expect(page.locator('#scene-notices p')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('hiding a page immediately flushes pending continuous motion', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.locator('#joint-tab').click();
  await page.locator('#jog-speed').fill('100');
  await page.locator('.joint-jog-btn[data-joint-index="0"][data-joint-dir="1"]').dispatchEvent('pointerdown', {
    pointerId: 20, pointerType: 'touch', button: 0,
  });
  await expect.poll(async () => Number(await page.locator('#stage-joint-0').innerText())).toBeGreaterThan(3);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const angle = Number(await page.locator('#stage-joint-0').innerText());
  expect((await saved(page)).joints[0] * 180 / Math.PI).toBeCloseTo(angle, 2);
  await page.reload();
  await ready(page);
  expect(Number(await page.locator('#stage-joint-0').innerText())).toBeCloseTo(angle, 2);
});

test('level flange persists the solved joint step and recalculated TCP', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.locator('#joint-tab').click();
  await jogJointTo(page, 0, 12);
  await jogJointTo(page, 4, 5);
  await page.locator('#pose-level').click();
  await expect(page.locator('#stage-joint-4')).toHaveText('4.00');
  const tcp = await page.locator('#fk-fields').innerText();
  await page.reload();
  await ready(page);
  await expect(page.locator('#stage-joint-0')).toHaveText('12.00');
  await expect(page.locator('#stage-joint-4')).toHaveText('4.00');
  expect(await page.locator('#fk-fields').innerText()).toBe(tcp);
});

test('continuous gripper input is throttled and release flushes the latest opening', async ({ page }) => {
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    const writes: string[] = [];
    (window as unknown as { sceneWrites: string[] }).sceneWrites = writes;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'uf-robots:scene') writes.push(value);
      setItem.call(this, key, value);
    };
  });
  await page.goto('/?rail=al0700&railPos=350&gripper=gripper-g2');
  await ready(page);
  const result = await page.evaluate(() => {
    const writes = (window as unknown as { sceneWrites: string[] }).sceneWrites;
    const range = document.querySelector<HTMLInputElement>('#opening-range')!;
    window.dispatchEvent(new Event('pagehide'));
    const before = writes.length;
    for (const opening of [40, 41, 42, 43, 44]) {
      range.value = String(opening);
      range.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const during = writes.length - before;
    const beforeRelease = JSON.parse(localStorage.getItem('uf-robots:scene')!).opening;
    range.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    const afterRelease = JSON.parse(localStorage.getItem('uf-robots:scene')!).opening;
    range.value = '45';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    range.dispatchEvent(new Event('blur'));
    const afterBlur = JSON.parse(localStorage.getItem('uf-robots:scene')!).opening;
    const number = document.querySelector<HTMLInputElement>('#opening-number')!;
    number.value = '46';
    number.dispatchEvent(new Event('change', { bubbles: true }));
    number.dispatchEvent(new Event('blur'));
    const afterNumberBlur = JSON.parse(localStorage.getItem('uf-robots:scene')!).opening;
    const rail = document.querySelector<HTMLInputElement>('#rail-number')!;
    rail.value = '351';
    rail.dispatchEvent(new Event('change', { bubbles: true }));
    rail.dispatchEvent(new Event('blur'));
    const afterRailBlur = JSON.parse(localStorage.getItem('uf-robots:scene')!).railMm;
    return { during, beforeRelease, afterRelease, afterBlur, afterNumberBlur, afterRailBlur };
  });
  expect(result.during).toBeLessThanOrEqual(1);
  expect(result.beforeRelease).not.toBe(44);
  expect(result.afterRelease).toBe(44);
  expect(result.afterBlur).toBe(45);
  expect(result.afterNumberBlur).toBe(46);
  expect(result.afterRailBlur).toBe(351);
  await page.reload();
  await ready(page);
  await expect(page.locator('#opening-number')).toHaveValue('46.0');
  await expect(page.locator('#rail-number')).toHaveValue('351.0');
});
