import { expect, test, type Page } from '@playwright/test';
import data from '../../src/reach-data.json' with { type: 'json' };
import { jogJointTo, selectGripper, selectRobot } from './selection-panels';

type ReachSnapshot = { visible: boolean; radius: number | null; center: number[] | null; normal: number[] | null; base: number[] | null };
type ReachHook = { snapshot(): ReachSnapshot; invalidate(): void };
const ready = async (page: Page) => expect(page.locator('#stage')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
const snapshot = (page: Page) => page.evaluate(() => (window as unknown as { __reachTest: ReachHook }).__reachTest.snapshot());
const getRadius = (robot: keyof typeof data.robots, sensor = false, gripper: string | null = null) =>
  data.robots[robot].combinations.find(item => item.sensor === sensor && item.gripperId === gripper)!.radiusM;

async function checkRing(page: Page, radius: number, center = [0, 0, 0]) {
  const state = await snapshot(page);
  expect(state.visible).toBe(true);
  expect(state.radius).toBeCloseTo(radius, 9);
  for (let i = 0; i < 3; i++) {
    expect(state.center![i]).toBeCloseTo(center[i], 6);
    expect(state.center![i]).toBeCloseTo(state.base![i], 9);
    expect(state.normal![i]).toBeCloseTo(i === 2 ? 1 : 0, 6);
  }
}

async function setRailPosition(page: Page, value: number) {
  const input = page.locator('#rail-number');
  await input.fill(String(value));
  await input.dispatchEvent('change');
  await expect(input).toHaveValue(value.toFixed(1));
}

test('ring follows the loaded TCP and base, not gripper opening or arm motion', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await ready(page);
  await checkRing(page, getRadius('xarm6'));
  await page.locator('#canvas-area canvas').screenshot({ path: '.tmp/reach-desktop.png' });

  await selectGripper(page, 'gripper-g2');
  await ready(page);
  await checkRing(page, getRadius('xarm6', false, 'gripper-g2'));
  await page.locator('#opening-number').fill('42');
  await page.locator('#opening-number').dispatchEvent('change');
  await page.locator('#joint-tab').click();
  await jogJointTo(page, 0, 10);
  await checkRing(page, getRadius('xarm6', false, 'gripper-g2'));

  await page.locator('#tool-sensor-check').check();
  await ready(page);
  await checkRing(page, getRadius('xarm6', true, 'gripper-g2'));
  await selectGripper(page, 'bio-gripper-g2');
  await ready(page);
  await checkRing(page, getRadius('xarm6', true, 'bio-gripper-g2'));
  await selectRobot(page, 'xarm7');
  await ready(page);
  await checkRing(page, getRadius('xarm7', true, 'bio-gripper-g2'));
  await selectRobot(page, 'uf850');
  await ready(page);
  await checkRing(page, getRadius('uf850', true, 'bio-gripper-g2'));
  await selectRobot(page, 'lite6');
  await ready(page);
  await checkRing(page, getRadius('lite6'));
  await selectGripper(page, 'lite6-gripper');
  await ready(page);
  await checkRing(page, getRadius('lite6', false, 'lite6-gripper'));
  await selectGripper(page, 'lite6-vacuum-gripper');
  await ready(page);
  await checkRing(page, getRadius('lite6', false, 'lite6-vacuum-gripper'));

  await selectRobot(page, 'xarm6');
  await ready(page);
  await page.locator('#rail-toggle').check();
  await ready(page);
  for (const mm of [0, 350, 700]) {
    await setRailPosition(page, mm);
    await checkRing(page, getRadius('xarm6'), [mm / 1000, 0, 0.107]);
  }
  await page.locator('#canvas-area canvas').screenshot({ path: '.tmp/reach-rail.png' });
  await page.setViewportSize({ width: 320, height: 740 });
  await checkRing(page, getRadius('xarm6'), [0.7, 0, 0.107]);
  await page.locator('#canvas-area canvas').screenshot({ path: '.tmp/reach-mobile.png' });
  expect(errors).toEqual([]);
});

test('pending, superseded, missing and failed loads never show a stale radius', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await checkRing(page, getRadius('xarm6'));
  let release!: () => void;
  let intercepted!: () => void;
  let finished!: () => void;
  const done = new Promise<void>(resolve => { finished = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const waiting = new Promise<void>(resolve => { intercepted = resolve; });
  await page.route('**/models/gripper-g2/base.glb', async route => {
    intercepted();
    await gate;
    try { await route.abort(); } finally { finished(); }
  });
  try {
    await selectGripper(page, 'gripper-g2');
    await waiting;
    expect((await snapshot(page)).visible).toBe(false);
    await selectGripper(page, 'bio-gripper-g2');
    await ready(page);
    await checkRing(page, getRadius('xarm6', false, 'bio-gripper-g2'));
  } finally { release(); }
  await done;
  await page.unroute('**/models/gripper-g2/base.glb');
  await page.waitForTimeout(300);
  await checkRing(page, getRadius('xarm6', false, 'bio-gripper-g2'));

  const warning = page.waitForEvent('console', message => message.type() === 'warning' && message.text().includes('No valid reach estimate'));
  await page.evaluate(() => (window as unknown as { __reachTest: ReachHook }).__reachTest.invalidate());
  await warning;
  expect((await snapshot(page)).visible).toBe(false);
  await selectGripper(page, '');
  await ready(page);
  await checkRing(page, getRadius('xarm6'));

  await page.route('**/models/gripper-g2/base.glb', route => route.fulfill({ status: 503, body: 'unavailable' }));
  await selectGripper(page, 'gripper-g2');
  await expect(page.locator('#retry')).toBeVisible();
  expect((await snapshot(page)).visible).toBe(false);
  await page.unroute('**/models/gripper-g2/base.glb');
  await page.locator('#retry').click();
  await ready(page);
  await checkRing(page, getRadius('xarm6', false, 'gripper-g2'));
});

test('collision rollback restores the ring for the actual assembly and packing hides its ring', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await ready(page);
  await page.locator('#joint-tab').click();
  for (const [index, angle] of [70, 2, -13, -4, 104, -44].entries()) await jogJointTo(page, index, angle);
  await checkRing(page, getRadius('xarm6'));
  await selectGripper(page, 'bio-gripper-g2');
  await ready(page);
  await expect(page.locator('#collision-toast')).toBeVisible();
  await expect(page.locator('#tool-gripper-select')).toHaveValue('');
  await checkRing(page, getRadius('xarm6'));

  // Force the target model to collide and verify that the previous model's ring returns.
  await page.route('**/models/xarm7/collision.json', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ schemaVersion: 1, assetId: 'xarm7', hulls: [
      { bodyKey: 'link_base', kind: 'box', center: [0, 0, 0], halfExtents: [2, 2, 2] },
      { bodyKey: 'link7', kind: 'box', center: [0, 0, 0], halfExtents: [2, 2, 2] },
    ] }),
  }));
  await selectRobot(page, 'xarm7');
  await ready(page);
  await expect(page.locator('#stage')).toHaveAttribute('data-robot', 'xarm6');
  await checkRing(page, getRadius('xarm6'));

  await page.locator('#page-examples').click();
  await expect(page.locator('#packing-stage')).toHaveAttribute('data-status', 'running', { timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => Boolean((window as Window & { __packingTest?: unknown }).__packingTest))).toBe(true);
  const packingReach = await page.evaluate(() => (window as unknown as { __packingTest: { reach(): ReachSnapshot } }).__packingTest.reach());
  expect(packingReach.visible).toBe(false);
  await page.locator('#page-robot').click();
  await ready(page);
  await checkRing(page, getRadius('xarm6'));
});
