import { expect, test, type Page } from '@playwright/test';
import { jogJointTo, selectGripper, selectRobot } from './selection-panels';

const key = 'uf-robots:scene';
const ready = async (page: Page) => expect(page.locator('#stage')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
const stored = async (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key);
const rawStored = async (page: Page) => page.evaluate(key => localStorage.getItem(key), key);
const putRaw = async (page: Page, raw: string) => page.evaluate(({ key, raw }) => {
  window.dispatchEvent(new Event('pagehide'));
  localStorage.setItem(key, raw);
}, { key, raw });
const pose = async (page: Page) => page.locator('#fk-fields').innerText();
const joint = async (page: Page, index = 0) => Number(await page.locator(`#stage-joint-${index}`).innerText());
const snapshot = (changes: Record<string, unknown> = {}) => ({
  version: 1, robot: 'xarm6', joints: [0, 0, 0, 0, 0, 0], rail: null, railMm: 0,
  sensor: null, gripper: null, opening: null, ...changes,
});

async function verifyReload(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  const beforePose = await pose(page);
  const before = await stored(page);
  await page.reload();
  await ready(page);
  expect(await stored(page)).toEqual(before);
  expect(await pose(page)).toBe(beforePose);
  for (let i = 0; i < before.joints.length; i++) {
    expect(await joint(page, i)).toBeCloseTo(before.joints[i] * 180 / Math.PI, 2);
  }
}

test('five robots restore joint motion and calculated TCP after reload', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await ready(page);
  for (const [id, dof] of [['xarm5', 5], ['xarm6', 6], ['xarm7', 7], ['uf850', 6], ['lite6', 6]] as const) {
    await selectRobot(page, id);
    await ready(page);
    await expect(page.locator('#stage')).toHaveAttribute('data-robot', id);
    await page.locator('#joint-tab').click();
    await jogJointTo(page, 0, 5);
    await expect.poll(async () => (await stored(page)).joints[0]).toBeCloseTo(5 * Math.PI / 180, 6);
    expect((await stored(page)).joints).toHaveLength(dof);
    await verifyReload(page);
  }
});

test('Cartesian, continuous, preset and rail movements restore their last valid pose', async ({ page }) => {
  await page.goto('/?rail=al0700&railPos=350&sensor=ai1500&gripper=gripper-g2&opening=42');
  await ready(page);
  await page.locator('[data-jog-axis="z"][data-jog-dir="1"]').click();
  await verifyReload(page);
  await page.locator('#joint-tab').click();
  await page.locator('#jog-speed').fill('100');
  const button = page.locator('.joint-jog-btn[data-joint-index="0"][data-joint-dir="1"]');
  await button.dispatchEvent('pointerdown', { pointerId: 12, pointerType: 'touch', button: 0 });
  await expect.poll(() => joint(page), { timeout: 8000 }).toBeGreaterThan(3);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await verifyReload(page);
  await page.locator('#pose-home').click();
  await verifyReload(page);
  await page.locator('#rail-number').fill('280.5');
  await page.locator('#rail-number').dispatchEvent('change');
  await page.locator('#opening-number').fill('35.5');
  await page.locator('#opening-number').dispatchEvent('change');
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await verifyReload(page);
  const saved = await stored(page);
  expect(saved).toMatchObject({ rail: 'al0700', railMm: 280.5, sensor: 'ai1500', gripper: 'gripper-g2', opening: 35.5 });
  await expect(page.locator('#rail-number')).toHaveValue('280.5');
  await expect(page.locator('#opening-number')).toHaveValue('35.5');
});

test('local scene overrides direct links, follows Lite opening, and survives reopening the homepage', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/?model=lite6&gripper=lite6-gripper&opening=0');
  await ready(page);
  await page.locator('#joint-tab').click();
  await jogJointTo(page, 0, 7);
  const beforePose = await pose(page);
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto('/?model=xarm7&rail=al0700&sensor=ai1500&gripper=bio-gripper-g2&opening=110#controls');
  await ready(reopened);
  await expect(reopened.locator('#stage')).toHaveAttribute('data-robot', 'lite6');
  await expect(reopened.locator('#stage')).toHaveAttribute('data-gripper', 'lite6-gripper');
  await expect(reopened.locator('#opening-switch')).not.toBeChecked();
  expect(await pose(reopened)).toBe(beforePose);
  const url = new URL(reopened.url());
  expect(url.searchParams.get('model')).toBe('lite6');
  expect(url.searchParams.get('gripper')).toBe('lite6-gripper');
  expect(url.searchParams.get('opening')).toBe('0.0');
  expect(url.searchParams.has('rail')).toBe(false);
  expect(url.searchParams.has('sensor')).toBe(false);
  expect(url.hash).toBe('#controls');
  await reopened.close();
  const homepage = await context.newPage();
  await homepage.goto('/');
  await ready(homepage);
  await expect(homepage.locator('#stage')).toHaveAttribute('data-robot', 'lite6');
  await expect(homepage.locator('#opening-switch')).not.toBeChecked();
  expect(await pose(homepage)).toBe(beforePose);
  await homepage.locator('#opening-switch').check();
  await verifyReload(homepage);
  await expect(homepage.locator('#opening-switch')).toBeChecked();
  await context.close();
});

test('invalid records and out-of-limit joints fall back without overwriting until a valid action', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await ready(page);
  const invalid = [
    '{broken', JSON.stringify(snapshot({ version: 9 })), JSON.stringify(snapshot({ joints: [0] })),
    JSON.stringify(snapshot({ joints: [100, 0, 0, 0, 0, 0] })),
    JSON.stringify(snapshot({ rail: 'al0700', railMm: 701 })),
    JSON.stringify(snapshot({ robot: 'lite6', gripper: 'gripper-g2', opening: 42 })),
    JSON.stringify(snapshot({ robot: 'lite6', gripper: 'lite6-gripper', opening: 20 })),
  ];
  for (const value of invalid) {
    await putRaw(page, value);
    await page.goto('/?model=xarm5');
    await ready(page);
    await expect(page.locator('#stage')).toHaveAttribute('data-robot', 'xarm5');
    await expect(page.locator('#scene-notices')).toContainText('保存的场景无效');
    expect(await rawStored(page)).toBe(value);
  }
  await page.locator('#joint-tab').click();
  await jogJointTo(page, 0, 1);
  await expect.poll(async () => (await stored(page)).robot).toBe('xarm5');
  await verifyReload(page);
});

test('collision during restoration preserves the old record and falls back to the link', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const bad = JSON.stringify(snapshot({ joints: [0, 40 * Math.PI / 180, 0, 0, 0, 0] }));
  await putRaw(page, bad);
  await page.goto('/?model=lite6');
  await ready(page);
  await expect(page.locator('#stage')).toHaveAttribute('data-robot', 'lite6');
  await expect(page.locator('#scene-notices')).toContainText('保存的场景发生碰撞');
  expect(await rawStored(page)).toBe(bad);
  await page.locator('#language').click();
  await expect(page.locator('#scene-notices')).toContainText('saved scene collides');
  await page.locator('#joint-tab').click();
  await jogJointTo(page, 0, 1);
  await expect.poll(async () => (await stored(page)).robot).toBe('lite6');
});

test('newest asynchronous selection alone commits and a failed restoration can be retried', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await ready(page);
  let release!: () => void;
  let intercepted!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const waiting = new Promise<void>(resolve => { intercepted = resolve; });
  await page.route('**/models/xarm7/xarm7.urdf', async route => { intercepted(); await gate; await route.continue(); });
  await selectRobot(page, 'xarm7');
  await waiting;
  await selectRobot(page, 'lite6');
  await ready(page);
  await expect.poll(async () => (await stored(page)).robot).toBe('lite6');
  release();
  await page.waitForTimeout(500);
  expect(await stored(page)).toMatchObject({ robot: 'lite6', joints: [0, 0, 0, 0, 0, 0] });
  await page.unroute('**/models/xarm7/xarm7.urdf');

  const saved = JSON.stringify(snapshot({ robot: 'xarm7', joints: [0.1, 0, 0, 0, 0, 0, 0] }));
  await putRaw(page, saved);
  let attempts = 0;
  await page.route('**/models/xarm7/collision.json', route => ++attempts === 1 ? route.abort() : route.continue());
  await page.goto('/?model=lite6');
  await expect(page.locator('#load-message')).toContainText('模型加载失败', { timeout: 60_000 });
  expect(await rawStored(page)).toBe(saved);
  await page.locator('#retry').click();
  await ready(page);
  expect(attempts).toBe(2);
  await expect(page.locator('#stage')).toHaveAttribute('data-robot', 'xarm7');
  expect(await joint(page)).toBeCloseTo(0.1 * 180 / Math.PI, 2);
  expect(await rawStored(page)).toBe(saved);
});

test('storage write failure shows one translated warning while controls remain usable', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'uf-robots:scene') throw new DOMException('full', 'QuotaExceededError');
      original.call(this, key, value);
    };
  });
  await page.goto('/');
  await ready(page);
  await expect(page.locator('#scene-notices')).toContainText('无法使用浏览器存储');
  await page.locator('#joint-tab').click();
  await jogJointTo(page, 0, 2);
  expect(await joint(page)).toBe(2);
  await expect(page.locator('#scene-notices p')).toHaveCount(1);
  await page.locator('#language').click();
  await expect(page.locator('#scene-notices')).toContainText('Browser storage is unavailable');
  expect(await rawStored(page)).toBeNull();
});

test('tabs do not jump and the last successful write wins on refresh', async ({ context, page }) => {
  await page.goto('/');
  await ready(page);
  const other = await context.newPage();
  await other.goto('/');
  await ready(other);
  await page.locator('#joint-tab').click();
  await jogJointTo(page, 0, 4);
  await expect.poll(async () => (await stored(page)).joints[0]).toBeCloseTo(4 * Math.PI / 180, 6);
  expect(await joint(other)).toBe(0);
  await other.locator('#joint-tab').click();
  await jogJointTo(other, 0, 8);
  await expect.poll(async () => (await stored(other)).joints[0]).toBeCloseTo(8 * Math.PI / 180, 6);
  expect(await joint(page)).toBe(4);
  await page.reload();
  await ready(page);
  expect(await joint(page)).toBe(8);
});
