import { expect, test, type Page } from '@playwright/test';
import { clearSavedScene, jogJointTo, selectGripper, selectRobot } from './selection-panels';

async function ready(page: Page) {
  await expect(page.locator('#stage')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
}

async function setJointDeg(page: Page, index: number, deg: number) {
  return jogJointTo(page, index, deg);
}

async function setOpeningNumber(page: Page, value: number | string) {
  const input = page.locator('#opening-number');
  await input.fill(String(value));
  await input.dispatchEvent('change');
}

async function setRailNumber(page: Page, value: number | string) {
  const input = page.locator('#rail-number');
  await input.fill(String(value));
  await input.dispatchEvent('change');
}

/** Decode a Playwright PNG screenshot in the browser and count crimson-red highlight pixels vs neutral robot pixels. */
async function analyzeCanvasColors(page: Page, pngBuffer: Buffer) {
  const dataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;
  return page.evaluate(async url => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let crimsonPixels = 0;
    let brightNeutralPixels = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (a < 200) continue;
      if (r > 150 && r - g > 65 && r - b > 65) {
        crimsonPixels++;
      } else if (r > 195 && g > 195 && b > 195 && Math.abs(r - g) < 18 && Math.abs(g - b) < 18) {
        brightNeutralPixels++;
      }
    }
    return { crimsonPixels, brightNeutralPixels, width: canvas.width, height: canvas.height };
  }, dataUrl);
}

test('joint collision interception rolls back input, highlights only colliding links in red on WebGL canvas, and clears on valid motion', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));

  await page.goto('/');
  await ready(page);
  await page.locator('#joint-tab').click();

  // Move J2 to a safe 20.00 deg pose
  await setJointDeg(page, 1, 20);
  await expect(page.locator('#joint-angle-1')).toHaveText('20.00°');
  await expect(page.locator('#stage-joint-1')).toHaveText('20.00');
  await expect(page.locator('#collision-toast')).toBeHidden();
  await expect(page.locator('#solver-status')).not.toHaveClass(/has-message/);
  await page.waitForTimeout(80);

  const canvas = page.locator('#canvas-area canvas');
  const safeStats = await analyzeCanvasColors(page, await canvas.screenshot());
  expect(safeStats.crimsonPixels).toBeLessThan(120);
  expect(safeStats.brightNeutralPixels).toBeGreaterThan(1000);

  // Attempt to drive J2 to 40 deg (wrist/forearm collides with link1 & link_base)
  await setJointDeg(page, 1, 40);

  // Incremental checks stop at the last safe angle before contact.
  const stoppedAt = Number(await page.locator('#stage-joint-1').innerText());
  expect(stoppedAt).toBeGreaterThanOrEqual(20);
  expect(stoppedAt).toBeLessThan(40);
  await expect(page.locator('#joint-angle-1')).toHaveText(`${stoppedAt.toFixed(2)}°`);
  await expect(page.locator('#collision-toast')).toBeVisible();
  await expect(page.locator('#collision-toast-text')).toContainText('检测到碰撞，已阻止继续运动：');
  await expect(page.locator('#collision-toast-text')).toContainText('基座');
  await expect(page.locator('#collision-toast-text')).toContainText(/(?:基座|连杆\d+|末端法兰)-(?:基座|连杆\d+|末端法兰)/);
  // Control panel footer must remain empty on collisions
  await expect(page.locator('#solver-status')).not.toHaveClass(/has-message/);
  await expect(page.locator('#status-text')).toBeEmpty();
  await page.waitForTimeout(80);

  const collisionStats = await analyzeCanvasColors(page, await canvas.screenshot());
  // Colliding links turn crimson red while non-colliding upper-arm links remain neutral white
  expect(collisionStats.crimsonPixels).toBeGreaterThan(safeStats.crimsonPixels + 800);
  expect(collisionStats.brightNeutralPixels).toBeGreaterThan(500);

  // Bilingual live re-translation and top-center 3D stage popup geometry across 1440 / 800 / 320 px
  await page.locator('#language').click();
  await expect(page.locator('#collision-toast-text')).toContainText('Collision detected; motion blocked: ');
  await expect(page.locator('#collision-toast-text')).toContainText('Base');
  await expect(page.locator('#collision-toast-text')).toContainText(/(?:Base|Link \d+|End flange)-(?:Base|Link \d+|End flange)/);
  for (const width of [1440, 800, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const geometry = await page.evaluate(w => {
      const stage = document.querySelector<HTMLElement>('#stage')!.getBoundingClientRect();
      const toast = document.querySelector<HTMLElement>('#collision-toast')!.getBoundingClientRect();
      const models = document.querySelector<HTMLElement>('#robot-models')!.getBoundingClientRect();
      const telemetry = document.querySelector<HTMLElement>('#stage-telemetry')!.getBoundingClientRect();
      return {
        insideStage: toast.left >= stage.left && toast.right <= stage.right && toast.top >= stage.top,
        centerOffset: Math.abs((toast.left + toast.right) / 2 - (stage.left + stage.right) / 2),
        topOffset: toast.top - stage.top,
        clearOfModelSelect:
          toast.left >= models.right + 6 || toast.right <= models.left - 6 || toast.top >= models.bottom + 2,
        clearOfTelemetryAtDesktop: w < 1440 || toast.right <= telemetry.left - 6,
      };
    }, width);
    expect(geometry.insideStage).toBe(true);
    expect(geometry.centerOffset).toBeLessThanOrEqual(2);
    expect(geometry.topOffset).toBeLessThanOrEqual(75);
    expect(geometry.clearOfModelSelect).toBe(true);
    expect(geometry.clearOfTelemetryAtDesktop).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#language').click();
  await expect(page.locator('#collision-toast-text')).toContainText('检测到碰撞，已阻止继续运动：');

  // Collapsing Cartesian controls keeps the 3D stage collision toast visible
  await page.locator('#cartesian-tab').click();
  await page.locator('#motion-collapse').click();
  await expect(page.locator('#collision-toast')).toBeVisible();
  await page.locator('#motion-collapse').click();
  await page.locator('#joint-tab').click();

  // Next valid collision-free motion clears red highlight and 3D stage collision toast
  await setJointDeg(page, 1, 10);
  await expect(page.locator('#joint-angle-1')).toHaveText('10.00°');
  await expect(page.locator('#stage-joint-1')).toHaveText('10.00');
  await expect(page.locator('#collision-toast')).toBeHidden();
  await expect(page.locator('#collision-toast-text')).toBeEmpty();
  await expect(page.locator('#status-text')).toBeEmpty();
  await page.waitForTimeout(80);

  const clearedStats = await analyzeCanvasColors(page, await canvas.screenshot());
  expect(clearedStats.crimsonPixels).toBeLessThan(120);
  expect(errors).toEqual([]);
});

test('Cartesian continuous jog stops at linear rail contact without target windup and reverses immediately on Z+', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));

  await page.goto('/?model=xarm6&rail=al0700&railPos=350&gripper=gripper-g2');
  await ready(page);

  // Lift elbow slightly (-35 deg J3, +35 deg J5) and rotate J1=+90 deg so Gripper G2 hovers ~70 mm above rail:fixed
  await page.locator('#joint-tab').click();
  await setJointDeg(page, 2, -35);
  await setJointDeg(page, 4, 35);
  await setJointDeg(page, 0, 90);
  await expect(page.locator('#collision-toast')).toBeHidden();

  await page.locator('#cartesian-tab').click();
  await page.locator('#jog-speed').fill('100');
  await page.locator('#jog-speed').dispatchEvent('input');

  const zStart = Number(await page.locator('#fk-2').innerText());
  const zMinus = page.locator('[data-jog-axis="z"][data-jog-dir="-1"]');

  // Long-press Z- to jog downward into rail:fixed
  await zMinus.dispatchEvent('pointerdown', { button: 0, pointerId: 1, pointerType: 'mouse' });
  await expect(page.locator('#collision-toast')).toBeVisible({ timeout: 6_000 });
  // Hold an extra 400 ms after contact to verify jog.position does NOT accumulate inside the rail
  await page.waitForTimeout(400);
  await zMinus.dispatchEvent('pointerup', { button: 0, pointerId: 1, pointerType: 'mouse' });

  await expect(page.locator('#collision-toast-text')).toContainText('直线滑轨');
  await expect(page.locator('#status-text')).toBeEmpty();
  const zStopped = Number(await page.locator('#fk-2').innerText());
  expect(zStopped).toBeLessThan(zStart - 10);

  // Single-step Z+ (DEFAULT_LINEAR_STEP_MM = 1 mm) must immediately lift TCP upward by 1.0 mm with zero windup
  await page.locator('[data-jog-axis="z"][data-jog-dir="1"]').click();
  await expect(page.locator('#collision-toast')).toBeHidden();
  await expect(page.locator('#collision-toast-text')).toBeEmpty();
  await expect(page.locator('#status-text')).toBeEmpty();
  const zLifted = Number(await page.locator('#fk-2').innerText());
  expect(zLifted).toBeCloseTo(zStopped + 1.0, 1);
  expect(errors).toEqual([]);
});

test('gripper opening and linear rail travel controls intercept collisions and roll back cleanly', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));

  // Part A: BIO Gripper G2 opening collision (safe closed at 71 mm, collides with forearm when opened to 150 mm)
  await page.goto('/?model=xarm6&gripper=bio-gripper-g2');
  await ready(page);
  await setOpeningNumber(page, 71);
  await expect(page.locator('#opening-number')).toHaveValue('71.0');

  await page.locator('#joint-tab').click();
  const openingTestPose = [-32, -15, -91, 65, 133, 154];
  for (let i = 0; i < openingTestPose.length; i++) {
    await setJointDeg(page, i, openingTestPose[i]);
  }
  await expect(page.locator('#collision-toast')).toBeHidden();

  const beforeBlockedOpening = await page.evaluate(() => localStorage.getItem('uf-robots:scene'));
  await setOpeningNumber(page, 150);
  await expect(page.locator('#opening-number')).toHaveValue('71.0');
  await expect(page.locator('#collision-toast')).toBeVisible();
  await expect(page.locator('#collision-toast-text')).toContainText('BIO Gripper G2');
  await expect(page.locator('#status-text')).toBeEmpty();
  expect(await page.evaluate(() => localStorage.getItem('uf-robots:scene'))).toBe(beforeBlockedOpening);

  // Part B: AL0700 rail travel collision:
  // At railPos=700 mm with J1=+90 deg, Gripper G2 hangs at world X=+0.907 m (past the +0.8635 m end of rail:fixed) at Z=+0.0455 m.
  // Sliding carriage back to 350 mm moves Gripper G2 to world X=+0.557 m, Z=+0.0455 m directly inside rail:fixed!
  await clearSavedScene(page);
  await page.goto('/?model=xarm6&rail=al0700&railPos=700&gripper=gripper-g2');
  await ready(page);
  await page.locator('#joint-tab').click();
  await setJointDeg(page, 0, 90);
  await expect(page.locator('#joint-angle-0')).toHaveText('90.00°');
  await expect(page.locator('#collision-toast')).toBeHidden();

  const beforeBlockedRail = await page.evaluate(() => localStorage.getItem('uf-robots:scene'));
  await setRailNumber(page, 350);
  await expect(page.locator('#rail-number')).toHaveValue('700.0');
  await expect(page.locator('#stage-rail-pos')).toHaveText('700.0');
  await expect(page.locator('#collision-toast')).toBeVisible();
  await expect(page.locator('#collision-toast-text')).toContainText('直线滑轨导轨');
  await expect(page.locator('#status-text')).toBeEmpty();
  expect(await page.evaluate(() => localStorage.getItem('uf-robots:scene'))).toBe(beforeBlockedRail);
  expect(errors).toEqual([]);
});

test('folded-pose accessory attachment rolls back without deadlock and browser detect() averages <0.5 ms', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));

  await page.goto('/');
  await ready(page);
  await page.locator('#joint-tab').click();

  // Fold bare xArm 6 into a pose with +38 mm bare clearance where attaching BIO Gripper G2 penetrates link_base
  const foldedBarePose = [70, 2, -13, -4, 104, -44];
  for (let i = 0; i < foldedBarePose.length; i++) {
    await setJointDeg(page, i, foldedBarePose[i]);
  }
  await expect(page.locator('#collision-toast')).toBeHidden();
  await expect(page.locator('#tool-gripper-select')).toHaveValue('');

  // Attempt to attach BIO Gripper G2 at the folded pose -> must roll back to bare arm without deadlock
  await selectGripper(page, 'bio-gripper-g2');
  await ready(page);
  await expect(page.locator('#tool-gripper-select')).toHaveValue('');
  await expect(page.locator('#stage')).not.toHaveAttribute('data-gripper');
  expect(new URL(page.url()).searchParams.has('gripper')).toBe(false);
  await expect(page.locator('#collision-toast')).toBeVisible();
  await expect(page.locator('#collision-toast-text')).toContainText('当前姿态下装配该配件会发生碰撞，已恢复上一配置：');
  await expect(page.locator('#status-text')).toBeEmpty();

  // Verify no deadlock: unfolding J5 back to 0 deg succeeds immediately and allows attaching BIO Gripper G2
  await setJointDeg(page, 4, 0);
  await expect(page.locator('#collision-toast')).toBeHidden();
  await selectGripper(page, 'bio-gripper-g2');
  await ready(page);
  await expect(page.locator('#tool-gripper-select')).toHaveValue('bio-gripper-g2');
  await expect(page.locator('#stage')).toHaveAttribute('data-gripper', 'bio-gripper-g2');
  await expect(page.locator('#collision-toast')).toBeHidden();

  // Switch to full 4-way assembly (xArm 7 + AL0700 + AI1500 + Gripper G2) and benchmark 200 detect() iterations in browser
  await selectRobot(page, 'xarm7');
  await ready(page);

  const avgMs = await page.evaluate(async () => {
    const collisionUrl = '/src/collision.ts';
    const threeUrl = '/node_modules/three/build/three.module.js';
    const [{ CollisionDetector }, { Group }] = await Promise.all([
      import(collisionUrl) as Promise<typeof import('../../src/collision')>,
      import(threeUrl) as Promise<typeof import('three')>,
    ]);
    const [armMan, railMan, sensorMan, g2Man] = await Promise.all([
      fetch('/models/xarm7/collision.json').then(r => r.json()),
      fetch('/models/al0700/collision.json').then(r => r.json()),
      fetch('/models/ai1500/collision.json').then(r => r.json()),
      fetch('/models/gripper-g2/collision.json').then(r => r.json()),
    ]);

    const root = new Group();
    const fixedRail = new Group();
    const carriage = new Group();
    carriage.position.set(0.35, 0, 0.107);
    root.add(fixedRail, carriage);

    // Build realistic 7-DoF kinematic chain for xArm 7 (53 convex shapes across 14 bodies)
    const links: Record<string, InstanceType<typeof Group>> = {};
    const offsets: [number, number, number][] = [
      [0, 0, 0],
      [0, 0, 0.267],
      [0, 0, 0],
      [0, -0.293, 0],
      [0.0525, 0, 0],
      [0.0775, -0.3425, 0],
      [0, 0, 0],
      [0.076, 0.097, 0],
    ];
    const names = ['link_base', 'link1', 'link2', 'link3', 'link4', 'link5', 'link6', 'link7'];
    let parent: InstanceType<typeof Group> = carriage;
    for (let i = 0; i < names.length; i++) {
      const link = new Group();
      link.position.set(...offsets[i]);
      parent.add(link);
      links[names[i]] = link;
      parent = link;
    }

    const sensorMount = new Group();
    sensorMount.position.set(0, 0, 0.0586);
    links['link7'].add(sensorMount);

    const g2Parts: Record<string, InstanceType<typeof Group>> = {};
    for (const key of [
      'base',
      'left_outer_knuckle',
      'right_outer_knuckle',
      'left_inner_knuckle',
      'right_inner_knuckle',
      'left_finger',
      'right_finger',
    ]) {
      const g = new Group();
      g.position.set(0, 0, 0.06);
      sensorMount.add(g);
      g2Parts[key] = g;
    }

    const detector = new CollisionDetector();
    detector.registerArmManifest(armMan, links, 7);
    detector.registerRailManifest(railMan, fixedRail, carriage, 350);
    detector.registerSensorManifest(sensorMan, sensorMount);
    detector.registerGripperManifest(g2Man, g2Parts);
    detector.setExclusionOptions({ armDof: 7, hasSensor: true });

    for (let i = 0; i < 20; i++) {
      links['link4'].rotation.y = (i % 10) * 0.2;
      root.updateMatrixWorld(true);
      detector.detect();
    }

    const t0 = performance.now();
    const iterations = 200;
    for (let i = 0; i < iterations; i++) {
      const phase = (i / iterations) * Math.PI;
      links['link1'].rotation.z = Math.sin(phase);
      links['link2'].rotation.y = 0.4 * Math.cos(phase);
      links['link4'].rotation.y = 1.2 * Math.sin(phase);
      links['link6'].rotation.y = 0.8 * Math.sin(2 * phase);
      detector.setRailPosition((i * 3.5) % 700);
      root.updateMatrixWorld(true);
      detector.detect();
    }
    return (performance.now() - t0) / iterations;
  });

  expect(avgMs).toBeLessThan(0.5);
  expect(errors).toEqual([]);
});
