import { expect, test, type Page } from '@playwright/test';
import { jogJointTo, selectGripper, selectRobot } from './selection-panels';

import config from '../../src/packing-config.json' with { type: 'json' };
import { PackingSegment, packingSegmentRatios, type MotionState } from '../../src/packing-trajectory';

type Trace = { phase: string; part: number; time: number; left: boolean; right: boolean; z: number; velocityY: number };
type GraspSample = { phase: string; part: number; time: number; position: number[]; left: boolean; right: boolean; belt: boolean; fingertipZ: number; bottomZ: number; jawCommand: number };
type Event = { type: 'grip' | 'release' | 'settled'; part: number; time: number; position?: number[] };
type Segment = { phase: string; part: number; startTime: number; duration: number; start: MotionState; end: MotionState };
type SimulationResult = { status: string; progress: number; time: number; reason?: string; transitions: Trace[]; events: Event[]; segments: Segment[]; graspSamples: GraspSample[]; clearanceFindings: unknown[]; minimumClearance: number; allInBox: boolean; wasmBytes: number };
type PackingDebug = {
  run(seconds: number, recordGrasp?: boolean, recordClearance?: boolean): SimulationResult;
  advanceTo(kind: 'phase' | 'event', name: string, part: number, seconds?: number): { reached: boolean; status: string; time: number };
  reset(): void;
  snapshot(): { jaws: number[] };
  block(index: number): number[];
  moveBlock(index: number, position: number[]): void;
  disablePads(): void;
  collide(index: number): void;
  highlighted(): string[];
};
const debug = (page: Page) => page.evaluate(() => Boolean((window as Window & { __packingTest?: PackingDebug }).__packingTest));
const run = (page: Page, seconds: number) => page.evaluate(
  duration => (window as unknown as { __packingTest: PackingDebug }).__packingTest.run(duration), seconds,
);
const advanceTo = (page: Page, kind: 'phase' | 'event', name: string, part = 0) => page.evaluate(({ kind, name, part }) =>
  (window as unknown as { __packingTest: PackingDebug }).__packingTest.advanceTo(kind, name, part), { kind, name, part });
const invoke = (page: Page, name: 'disablePads' | 'collide' | 'highlighted', index = 0) => page.evaluate(({ name, index }) => {
  const hook = (window as unknown as { __packingTest: PackingDebug }).__packingTest;
  if (name === 'disablePads') return hook.disablePads();
  if (name === 'collide') return hook.collide(index);
  return hook.highlighted();
}, { name, index });

async function ready(page: Page) {
  await page.goto('/?example=packing-01');
  await expect(page.locator('#packing-stage')).toHaveAttribute('data-status', 'running', { timeout: 60_000 });
  await expect.poll(() => debug(page)).toBe(true);
  await page.evaluate(() => (window as unknown as { __packingTest: PackingDebug }).__packingTest.reset());
  await expect(page.locator('#packing-stage')).toHaveAttribute('data-status', 'paused');
}

test('ten rounds maintain physical grasp, clearance, trajectory limits and cycle time', async ({ page }) => {
  test.setTimeout(300_000);
  await ready(page);
  const before = await page.evaluate(() => { const hook = (window as unknown as { __packingTest: PackingDebug }).__packingTest; return { block: hook.block(0), jaws: hook.snapshot().jaws }; });
  expect(before.jaws[0] + before.jaws[1]).toBeCloseTo(config.gripper.pregraspOpening, 8);
  const initial = await run(page, .5);
  const after = await page.evaluate(() => (window as unknown as { __packingTest: PackingDebug }).__packingTest.block(0));
  expect(after[1]).toBeLessThan(before.block[1] - .012);
  expect(after[2]).toBeCloseTo(.055, 2);
  const { first, rounds } = await page.evaluate(() => {
    const hook = (window as unknown as { __packingTest: PackingDebug }).__packingTest;
    let first: SimulationResult | undefined;
    const rounds = [];
    for (let round = 0; round < 10; round++) {
      hook.reset();
      const result = hook.run(50, true, round === 0);
      if (!first) first = result;
      const measurements = Array.from({ length: 9 }, (_, part) => {
        const samples = result.graspSamples.filter(sample => sample.part === part);
        const held = samples.filter(sample => ['lift', 'carry', 'transfer'].includes(sample.phase) && sample.left && sample.right && !sample.belt);
        const onBelt = samples.some(sample => sample.phase === 'close' && sample.left && sample.right && sample.belt);
        const maxTipError = held.length ? Math.max(...held.map(sample => Math.abs(sample.bottomZ - sample.fingertipZ))) : Infinity;
        return { onBelt, held: held.length, maxTipError };
      });
      rounds.push({ status: result.status, progress: result.progress, time: result.time, reason: result.reason,
        allInBox: result.allInBox, events: result.events, measurements });
      if (result.status !== 'complete') break;
    }
    return { first: first!, rounds };
  });
  expect(rounds).toHaveLength(10);
  for (const [round, result] of rounds.entries()) {
    expect(result, `round ${round + 1}`).toMatchObject({ status: 'complete', progress: 9, allInBox: true });
    expect(result.time).toBeLessThanOrEqual(50);
    const releases = result.events.filter(item => item.type === 'release');
    expect(releases).toHaveLength(9);
    expect(result.events.filter(item => item.type === 'grip')).toHaveLength(9);
    expect(result.events.filter(item => item.type === 'settled')).toHaveLength(9);
    for (const measurement of result.measurements) {
      expect(measurement.onBelt).toBe(true);
      expect(measurement.held).toBeGreaterThan(50);
      expect(measurement.maxTipError).toBeLessThan(.002);
    }
    for (let i = 0; i < 9; i++) {
      expect(Math.abs(releases[i].position![2] - config.placement.releaseHeight)).toBeLessThan(.002);
      const settled = result.events.find(item => item.type === 'settled' && item.part === i)!;
      expect(settled.time - releases[i].time).toBeGreaterThanOrEqual(config.placement.stableTime);
      expect(settled.time - releases[i].time).toBeLessThan(config.placement.timeout);
      if (i) expect(releases[i].time - releases[i - 1].time).toBeLessThanOrEqual(5);
    }
  }
  expect(first.wasmBytes - initial.wasmBytes).toBeLessThan(128 * 1024 * 1024);
  expect(first.clearanceFindings).toEqual([]);
  expect(first.minimumClearance).toBeGreaterThanOrEqual(config.placement.clearance - .000001);
  const grips = first.transitions.filter(item => item.phase === 'lift');
  expect(grips).toHaveLength(9);
  expect(grips.every(item => item.left && item.right)).toBe(true);
  for (let i = 0; i < 9; i++) {
    const samples = first.graspSamples.filter(sample => sample.part === i);
    const contact = samples.findIndex(sample => sample.phase === 'close' && sample.left && sample.right && sample.belt);
    expect(contact, `part ${i + 1}: bilateral belt contact`).toBeGreaterThanOrEqual(0);
    const start = samples[contact];
    const lifted = samples.slice(contact).find(sample => sample.phase === 'lift' && sample.left && sample.right && !sample.belt && sample.position[2] >= .057);
    expect(lifted, `part ${i + 1}: lift`).toBeDefined();
    const delay = lifted!.time - start.time;
    const slip = Math.hypot(lifted!.position[0] - start.position[0], lifted!.position[1] - start.position[1] + config.belt.speed * delay);
    expect(slip, `part ${i + 1}: displacement relative to belt`).toBeLessThan(.002);
    expect(delay).toBeLessThan(.4);
    for (let j = 1; j < samples.length; j++) {
      const dt = samples[j].time - samples[j - 1].time;
      expect(Math.abs(samples[j].jawCommand - samples[j - 1].jawCommand)).toBeLessThanOrEqual(config.gripper.speed * dt + 1e-8);
    }
    for (const sample of samples.filter(item => ['release', 'rise', 'exit'].includes(item.phase))) {
      expect(sample.jawCommand).toBeLessThanOrEqual(config.gripper.releaseOpening + 1e-8);
    }
    const held = samples.filter(sample => ['lift', 'carry', 'transfer'].includes(sample.phase) && sample.left && sample.right && !sample.belt);
    expect(held.length).toBeGreaterThan(50);
    expect(Math.max(...held.map(sample => Math.abs(sample.bottomZ - sample.fingertipZ)))).toBeLessThan(.002);
  }
  for (const [index, item] of first.segments.entries()) {
    const segment = new PackingSegment(item.start, item.end, item.duration);
    expect(Math.max(...packingSegmentRatios(segment)), `${item.phase} part ${item.part + 1}`).toBeLessThanOrEqual(1);
    expect(item.duration / config.step).toBeCloseTo(Math.round(item.duration / config.step), 7);
    if (index === 0) continue;
    const previous = first.segments[index - 1], gap = item.startTime - previous.startTime - previous.duration;
    expect(gap).toBeGreaterThanOrEqual(-1e-7);
    for (let axis = 0; axis < 3; axis++) {
      expect(item.start.velocity[axis]).toBeCloseTo(previous.end.velocity[axis], 7);
      expect(item.start.acceleration[axis]).toBeCloseTo(previous.end.acceleration[axis], 7);
      expect(item.start.position[axis]).toBeCloseTo(previous.end.position[axis] + previous.end.velocity[axis] * gap, 5);
    }
  }
  await expect(page.locator('#packing-count')).toHaveText('9 / 9');
  await expect(page.locator('#packing-progress')).toHaveAccessibleName('装箱进度');
  await expect(page.locator('#packing-elapsed')).toContainText('40.');
  await expect(page.locator('#packing-cycle')).toContainText('s');
  await page.locator('#packing-play').click();
  await expect(page.locator('#packing-count')).toHaveText('0 / 9');
  await expect(page.locator('#packing-stage')).toHaveAttribute('data-status', 'running');
  await page.locator('#packing-reset').click();
  await expect(page.locator('#packing-stage')).toHaveAttribute('data-status', 'paused');
  await expect(page.locator('#packing-stage')).toHaveAttribute('data-time', '0.00');
});

test('missed grip, dropped part, failed placement and collision stop with a reason', async ({ page }) => {
  test.setTimeout(180_000);
  await ready(page);
  await invoke(page, 'disablePads');
  expect(await run(page, 5)).toMatchObject({ status: 'error', reason: 'miss' });
  await expect(page.locator('#packing-error')).toContainText('抓取失败');

  await ready(page);
  expect(await advanceTo(page, 'phase', 'lift')).toMatchObject({ reached: true, status: 'paused' });
  await page.evaluate(() => (window as unknown as { __packingTest: PackingDebug }).__packingTest.moveBlock(0, [.4, .3, .055]));
  expect(await run(page, .1)).toMatchObject({ status: 'error', reason: 'drop' });
  await expect(page.locator('#packing-error')).toContainText('掉落');

  await ready(page);
  expect(await advanceTo(page, 'event', 'release')).toMatchObject({ reached: true, status: 'paused' });
  await page.evaluate(() => (window as unknown as { __packingTest: PackingDebug }).__packingTest.moveBlock(0, [-.5, -.5, .1]));
  expect(await run(page, 3)).toMatchObject({ status: 'error', reason: 'outside' });
  await expect(page.locator('#packing-error')).toContainText('箱内稳定');

  await ready(page);
  expect(await advanceTo(page, 'event', 'settled')).toMatchObject({ reached: true, status: 'paused' });
  await page.evaluate(() => (window as unknown as { __packingTest: PackingDebug }).__packingTest.moveBlock(0, [-.5, -.5, .1]));
  expect(await run(page, 3)).toMatchObject({ status: 'error', reason: 'outside' });

  await ready(page);
  await invoke(page, 'collide', 0);
  await expect(page.locator('#packing-stage')).toHaveAttribute('data-status', 'error');
  await expect(page.locator('#packing-error')).toContainText('碰撞');
  await expect(page.locator('#packing-error')).toContainText(/(?:连杆2-工件 1|工件 1-连杆2)/);
  expect(await invoke(page, 'highlighted')).toContain('arm:link2');
  await page.locator('#language').click();
  await expect(page.locator('#packing-error')).toContainText(/(?:Link 2-Part 1|Part 1-Link 2)/);
  await page.locator('#packing-reset').click();
  expect(await invoke(page, 'highlighted')).toEqual([]);
});

test('page navigation preserves robot and example state, including history and user pause', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#stage')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await selectRobot(page, 'xarm7');
  await expect(page.locator('#stage')).toHaveAttribute('data-robot', 'xarm7');
  await expect(page.locator('#stage')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await selectGripper(page, 'gripper-g2');
  await expect(page.locator('#stage')).toHaveAttribute('data-gripper', 'gripper-g2');
  await expect(page.locator('#stage')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await page.locator('#joint-tab').click();
  await jogJointTo(page, 0, 10);
  await page.locator('#page-examples').focus(); await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/example=packing-01/);
  await expect(page.locator('#packing-stage')).toHaveAttribute('data-status', 'running', { timeout: 60_000 });
  await expect.poll(() => debug(page)).toBe(true);
  await page.locator('#packing-play').click();
  expect(await advanceTo(page, 'event', 'settled')).toMatchObject({ reached: true });
  const pausedTime = await page.locator('#packing-stage').getAttribute('data-time');
  await page.goBack();
  await expect(page.locator('#stage-joint-0')).toHaveText('10.00');
  await expect(page.locator('#stage')).toHaveAttribute('data-robot', 'xarm7');
  await expect(page.locator('#stage')).toHaveAttribute('data-gripper', 'gripper-g2');
  await page.goForward();
  await expect(page.locator('#packing-stage')).toHaveAttribute('data-status', 'paused');
  await expect(page.locator('#packing-count')).toHaveText('1 / 9');
  await expect(page.locator('#packing-stage')).toHaveAttribute('data-time', pausedTime!);
  await page.locator('#packing-play').click();
  await expect(page.locator('#packing-stage')).toHaveAttribute('data-status', 'running');
  await page.locator('#page-robot').click();
  await page.locator('#page-examples').click();
  await expect(page.locator('#packing-stage')).toHaveAttribute('data-status', 'running');
});

test('model loading can be retried and the bilingual narrow layout remains usable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.route('**/optimized-models/models/gripper-g2/base.*.glb.gz.bin', route => route.abort());
  await page.goto('/?example=packing-01');
  await expect(page.locator('#packing-stage')).toHaveAttribute('data-status', 'error', { timeout: 60_000 });
  await expect(page.locator('#packing-error')).toContainText('加载失败');
  await page.unroute('**/optimized-models/models/gripper-g2/base.*.glb.gz.bin');
  await page.locator('#packing-play').click();
  await expect(page.locator('#packing-stage')).toHaveAttribute('data-status', 'running', { timeout: 60_000 });
  await expect(page.locator('#packing-canvas canvas')).toHaveCount(1);
  await expect(page.locator('.packing-mobile')).toBeVisible();
  await page.locator('#language').click();
  await expect(page.locator('.packing-panel h2')).toHaveText('Example 01: Packing');
  await expect(page.locator('.packing-mobile')).toContainText('desktop');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#packing-play').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#packing-stage')).toHaveAttribute('data-status', 'paused');
});

test('a failed example module offers a reload and can recover', async ({ page }) => {
  await page.route('**/src/packing.ts*', route => route.abort());
  await page.goto('/?example=packing-01');
  await expect(page.locator('.packing-module-failure [role="alert"]')).toContainText('示例加载失败');
  await page.unroute('**/src/packing.ts*');
  await page.locator('.packing-module-failure button').click();
  await expect(page.locator('#packing-stage')).toHaveAttribute('data-status', 'running', { timeout: 60_000 });
});
