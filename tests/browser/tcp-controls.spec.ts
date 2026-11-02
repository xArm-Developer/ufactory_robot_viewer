import { devices, expect, test, type Page } from '@playwright/test';
import { clearSavedScene, jogJointTo, selectRobot } from './selection-panels';

async function ready(page: Page, path?: string) {
  if (path) await page.goto(path);
  await expect(page.locator('#stage')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
}

async function jointAngles(page: Page, dof: number): Promise<number[]> {
  const values: number[] = [];
  for (let i = 0; i < dof; i++) {
    values.push(Number(await page.locator(`#stage-joint-${i}`).innerText()));
  }
  return values;
}

async function setSpeed(page: Page, percent: number) {
  const slider = page.locator('#jog-speed');
  await slider.fill(String(percent));
  await slider.dispatchEvent('input');
}

async function pressMouse(page: Page, selector: string) {
  const button = page.locator(selector);
  await button.scrollIntoViewIfNeeded();
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
}

async function holdUntilDone(page: Page, selector: string, timeout = 15_000) {
  await pressMouse(page, selector);
  try {
    await expect(page.locator(selector)).not.toHaveClass(/is-jogging/, { timeout });
  } finally {
    await page.mouse.up();
  }
}

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
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (a >= 200 && r > 150 && r - g > 65 && r - b > 65) crimsonPixels++;
    }
    return crimsonPixels;
  }, dataUrl);
}

test('distinct Base/TCP 3-axis icons, polyline chevron collapse states, bilingual labels, single-step click/keyboard, and 320px layout', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));

  await ready(page, '/');

  // Verify Base and TCP frame buttons have distinct 3-axis SVGs with base vs flange markers
  const baseSvg = page.locator('#toggle-base-frame svg.axes-icon-base');
  const tcpSvg = page.locator('#toggle-tcp-frame svg.axes-icon-tcp');
  await expect(baseSvg).toBeVisible();
  await expect(tcpSvg).toBeVisible();
  await expect(baseSvg.locator('[data-marker="base"]')).toHaveCount(1);
  await expect(baseSvg.locator('[data-marker="flange"]')).toHaveCount(0);
  await expect(tcpSvg.locator('[data-marker="flange"]')).toHaveCount(1);
  await expect(tcpSvg.locator('[data-marker="base"]')).toHaveCount(0);
  for (const icon of [baseSvg, tcpSvg]) {
    await expect(icon.locator('.axis-x')).toHaveCount(1);
    await expect(icon.locator('.axis-y')).toHaveCount(1);
    await expect(icon.locator('.axis-z')).toHaveCount(1);
  }
  const iconGeometry = await page.evaluate(() => ({
    baseHtml: document.querySelector('#toggle-base-frame svg')!.innerHTML,
    tcpHtml: document.querySelector('#toggle-tcp-frame svg')!.innerHTML,
  }));
  expect(iconGeometry.baseHtml).not.toBe(iconGeometry.tcpHtml);

  // Verify 3D coordinate frames still render in the WebGL scene when toggled
  const canvas = page.locator('#canvas-area canvas');
  await page.waitForTimeout(120);
  const beforeFrames = await canvas.screenshot();
  await page.locator('#toggle-base-frame').click();
  await expect(page.locator('#toggle-base-frame')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(120);
  const withBase = await canvas.screenshot();
  expect(withBase.equals(beforeFrames)).toBe(false);
  await page.locator('#toggle-tcp-frame').click();
  await expect(page.locator('#toggle-tcp-frame')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(120);
  const withBoth = await canvas.screenshot();
  expect(withBoth.equals(withBase)).toBe(false);
  await page.locator('#toggle-base-frame').click();
  await page.locator('#toggle-tcp-frame').click();

  // Verify polyline chevron collapse button: upward '^' when expanded, downward arrow when collapsed
  const collapse = page.locator('#motion-collapse');
  const chevron = page.locator('#motion-collapse-chevron');
  await expect(collapse).toHaveText('');
  await expect(collapse).toHaveAttribute('aria-expanded', 'true');
  await expect(collapse).toHaveAttribute('data-chevron', 'up');
  await expect(collapse).toHaveAccessibleName('收起笛卡尔控制');
  const upPoints = (await chevron.getAttribute('points'))!.trim().split(/\s+/).map(Number);
  // [x1, y1, xMid, yMid, x2, y2]: upward '^' has apex yMid < y1 and yMid < y2
  expect(upPoints).toHaveLength(6);
  expect(upPoints[3]).toBeLessThan(upPoints[1]);
  expect(upPoints[3]).toBeLessThan(upPoints[5]);

  await collapse.focus();
  await page.keyboard.press('Space');
  await expect(collapse).toHaveAttribute('aria-expanded', 'false');
  await expect(collapse).toHaveAttribute('data-chevron', 'down');
  await expect(collapse).toHaveAccessibleName('展开笛卡尔控制');
  await expect(page.locator('#pose-panel')).toBeHidden();
  const downPoints = (await chevron.getAttribute('points'))!.trim().split(/\s+/).map(Number);
  expect(downPoints[3]).toBeGreaterThan(downPoints[1]);
  expect(downPoints[3]).toBeGreaterThan(downPoints[5]);

  await page.keyboard.press('Enter');
  await expect(collapse).toHaveAttribute('aria-expanded', 'true');
  await expect(collapse).toHaveAttribute('data-chevron', 'up');
  await expect(page.locator('#pose-panel')).toBeVisible();

  // Verify bilingual copy & responsive layout across 1440px, 800px, and 320px without horizontal overflow or button clipping
  for (const lang of ['zh', 'en'] as const) {
    if (lang === 'en') await page.locator('#language').click();
    await expect(page.locator('#pose-home')).toHaveText(lang === 'zh' ? '初始位置' : 'Initial position');
    await expect(page.locator('#pose-level')).toHaveText(lang === 'zh' ? '末端调平' : 'Level flange');
    await expect(collapse).toHaveAccessibleName(lang === 'zh' ? '收起笛卡尔控制' : 'Collapse Cartesian controls');

    for (const width of [1440, 800, 320]) {
      await page.setViewportSize({ width, height: 960 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const fit = await page.evaluate(() => {
        const panel = document.querySelector<HTMLElement>('#control-card')!.getBoundingClientRect();
        const speed = document.querySelector<HTMLElement>('#motion-speed')!.getBoundingClientRect();
        const posePanel = document.querySelector<HTMLElement>('#pose-panel')!.getBoundingClientRect();
        const home = document.querySelector<HTMLButtonElement>('#pose-home')!;
        const level = document.querySelector<HTMLButtonElement>('#pose-level')!;
        const homeRect = home.getBoundingClientRect();
        const levelRect = level.getBoundingClientRect();
        return {
          homeFits: home.scrollWidth <= home.clientWidth + 1 && homeRect.left >= panel.left && homeRect.right <= panel.right,
          levelFits: level.scrollWidth <= level.clientWidth + 1 && levelRect.left >= panel.left && levelRect.right <= panel.right,
          sideBySide: Math.abs(homeRect.top - levelRect.top) < 2 && levelRect.left >= homeRect.right,
          belowSpeedAbovePanel: homeRect.top >= speed.bottom && posePanel.top >= homeRect.bottom,
        };
      });
      expect(fit).toEqual({ homeFits: true, levelFits: true, sideBySide: true, belowSpeedAbovePanel: true });
    }
  }

  // Verify single-step click, keyboard Enter/Space, and programmatic click (1° max joint step, then stop)
  await page.setViewportSize({ width: 1280, height: 900 });
  await setSpeed(page, 100);
  await page.locator('#joint-tab').click();
  await jogJointTo(page, 0, 12);
  await jogJointTo(page, 4, 5);

  // Short click on #pose-level steps J5 by 1° (5.00° -> 4.00°) while keeping J1 at 12.00°
  await page.locator('#pose-level').click();
  await expect(page.locator('#stage-joint-4')).toHaveText('4.00');
  await expect(page.locator('#stage-joint-0')).toHaveText('12.00');
  await page.waitForTimeout(300);
  await expect(page.locator('#stage-joint-4')).toHaveText('4.00');

  // Keyboard Enter and programmatic .click() each step J5 by 1°
  await page.locator('#pose-level').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#stage-joint-4')).toHaveText('3.00');
  await page.locator('#pose-level').evaluate(el => (el as HTMLButtonElement).click());
  await expect(page.locator('#stage-joint-4')).toHaveText('2.00');
  await expect(page.locator('#stage-joint-0')).toHaveText('12.00');

  // Two more clicks reach the leveled cone boundary (0.10°) without overshoot
  await page.locator('#pose-level').click();
  await expect(page.locator('#stage-joint-4')).toHaveText('1.00');
  await page.locator('#pose-level').click();
  expect(Math.abs(Number(await page.locator('#stage-joint-4').innerText()))).toBeLessThanOrEqual(0.11);

  // On Cartesian tab, short click and Space on #pose-home step 1° on the largest-delta joint (J1: 12° -> 11° -> 10°)
  await page.locator('#cartesian-tab').click();
  await page.locator('#pose-home').click();
  await expect(page.locator('#stage-joint-0')).toHaveText('11.00');
  await page.locator('#pose-home').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#stage-joint-0')).toHaveText('10.00');
  await page.waitForTimeout(300);
  await expect(page.locator('#stage-joint-0')).toHaveText('10.00');

  // Long-press #pose-home smoothly returns all joints to 0.00°
  await holdUntilDone(page, '#pose-home');
  await expect(page.locator('#stage-joint-0')).toHaveText('0.00');
  await expect(page.locator('#stage-joint-4')).toHaveText('0.00');
  expect(errors).toEqual([]);
});

test('all 5 arms step and long-press level only the last three joints, return to 0° home, handle already-level poses, and preserve unreachable Lite 6 pose', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));

  await ready(page, '/');
  await setSpeed(page, 100);

  const cases: Array<{ id: string; dof: number; setup: Array<[number, number]> }> = [
    { id: 'xarm6', dof: 6, setup: [[0, 16], [1, -15], [2, -15], [3, 25], [4, 42], [5, -18]] },
    { id: 'xarm5', dof: 5, setup: [[0, 15], [1, -18], [2, -12], [3, 45], [4, 20]] },
    { id: 'xarm7', dof: 7, setup: [[0, 14], [1, -16], [2, 18], [3, 22], [4, -24], [5, 38], [6, 15]] },
    { id: 'uf850', dof: 6, setup: [[0, -16], [1, -14], [2, -18], [3, 22], [4, 36], [5, 19]] },
    { id: 'lite6', dof: 6, setup: [[0, 18], [1, 14], [2, 24], [3, -25], [4, 35], [5, -15]] },
  ];

  for (const { id, dof, setup } of cases) {
    if ((await page.locator('#stage').getAttribute('data-robot')) !== id) {
      await selectRobot(page, id);
      await expect(page.locator('#stage')).toHaveAttribute('data-robot', id);
      await ready(page);
      await setSpeed(page, 100);
    }

    await page.locator('#joint-tab').click();
    for (const [jointIdx, deg] of setup) {
      await jogJointTo(page, jointIdx, deg);
    }
    const beforeLevel = await jointAngles(page, dof);
    const beforeRoll = Math.abs(Number(await page.locator('#fk-3').innerText()));
    const beforePitch = Math.abs(Number(await page.locator('#fk-4').innerText()));
    expect(Math.hypot(180 - beforeRoll, beforePitch)).toBeGreaterThan(5);

    await page.locator('#cartesian-tab').click();

    // 1. Short click on #pose-level steps once by 1° max wrist delta and stops
    await page.locator('#pose-level').click();
    const afterOneLevelStep = await jointAngles(page, dof);
    const levelStepMax = Math.max(...afterOneLevelStep.map((v, i) => Math.abs(v - beforeLevel[i])));
    expect(levelStepMax).toBeGreaterThanOrEqual(0.98);
    expect(levelStepMax).toBeLessThanOrEqual(1.02);
    for (let i = 0; i < dof - 3; i++) {
      expect(afterOneLevelStep[i]).toBe(beforeLevel[i]);
    }
    expect(afterOneLevelStep[dof - 1]).toBe(beforeLevel[dof - 1]);

    // 2. Long-press #pose-level aligns flange +Z with base -Z (Roll ≈ ±180°, Pitch ≈ 0° within 0.1°)
    await holdUntilDone(page, '#pose-level');
    const roll = Math.abs(Number(await page.locator('#fk-3').innerText()));
    const pitch = Math.abs(Number(await page.locator('#fk-4').innerText()));
    expect(Math.max(Math.abs(180 - roll), pitch)).toBeLessThanOrEqual(0.12);

    // Prefix joints and final flange-spin joint must remain unchanged
    const afterLevel = await jointAngles(page, dof);
    for (let i = 0; i < dof - 3; i++) {
      expect(afterLevel[i]).toBe(beforeLevel[i]);
    }
    expect(afterLevel[dof - 1]).toBe(beforeLevel[dof - 1]);

    // Clicking or holding Level flange again on an already-level pose keeps all joints identical
    await page.locator('#pose-level').click();
    expect(await jointAngles(page, dof)).toEqual(afterLevel);
    await holdUntilDone(page, '#pose-level');
    expect(await jointAngles(page, dof)).toEqual(afterLevel);

    // 3. Short click on #pose-home steps once by 1° max joint delta towards 0° and stops
    await page.locator('#pose-home').click();
    const afterOneHomeStep = await jointAngles(page, dof);
    const homeStepMax = Math.max(...afterOneHomeStep.map((v, i) => Math.abs(v - afterLevel[i])));
    expect(homeStepMax).toBeGreaterThanOrEqual(0.98);
    expect(homeStepMax).toBeLessThanOrEqual(1.02);

    // 4. Long-press #pose-home returns all joints smoothly to 0.00° and synchronizes joint panel readouts
    await holdUntilDone(page, '#pose-home');
    expect((await jointAngles(page, dof)).every(v => v === 0)).toBe(true);
    for (let i = 0; i < dof; i++) {
      await expect(page.locator(`#joint-angle-${i}`)).toHaveText('0.00°');
    }
  }

  // Unreachable leveling pose on Lite 6 (J3 = 150° tilts forearm beyond J5's ±124° range):
  // verify both short click and long press preserve current pose and display bilingual error.
  await page.locator('#joint-tab').click();
  await jogJointTo(page, 0, 15);
  await jogJointTo(page, 2, 150);
  await jogJointTo(page, 4, 20);
  const unreachableOrigin = await jointAngles(page, 6);
  expect(unreachableOrigin).toEqual([15, 0, 150, 0, 20, 0]);

  await page.locator('#cartesian-tab').click();
  await page.locator('#pose-level').click();
  await expect(page.locator('#solver-status')).toHaveClass(/error/);
  await expect(page.locator('#collision-toast')).toBeHidden();
  await expect(page.locator('#status-text')).toHaveText('无法在关节限位内调平末端；已保留当前姿态。');
  expect(await jointAngles(page, 6)).toEqual(unreachableOrigin);

  await page.locator('#motion-collapse').click();
  await expect(page.locator('#solver-status')).toBeVisible();
  await page.locator('#motion-collapse').click();
  const noticePosition = await page.evaluate(() => {
    const stage = document.querySelector('#stage')!.getBoundingClientRect();
    const notice = document.querySelector('#solver-status')!.getBoundingClientRect();
    return { center: Math.abs((notice.left + notice.right - stage.left - stage.right) / 2), top: notice.top - stage.top };
  });
  expect(noticePosition.center).toBeLessThanOrEqual(2);
  expect(noticePosition.top).toBeGreaterThanOrEqual(0);
  expect(noticePosition.top).toBeLessThanOrEqual(75);

  await holdUntilDone(page, '#pose-level');
  await expect(page.locator('#solver-status')).toHaveClass(/error/);
  expect(await jointAngles(page, 6)).toEqual(unreachableOrigin);

  await page.locator('#language').click();
  await expect(page.locator('#status-text')).toHaveText(
    'Could not level the flange within joint limits; the current pose is preserved.',
  );
  expect(await jointAngles(page, 6)).toEqual(unreachableOrigin);
  expect(errors).toEqual([]);
});

test('long-press motion respects shared speed, stops on release, preserves rail and end-effector state, and stops with rollback on mid-trajectory collisions', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));

  await ready(page, '/?model=xarm6&rail=al0700&railPos=420&sensor=ai1500&gripper=gripper-g2&opening=52');

  // 1. Speed scaling during long-press hold (and immediate stop upon mouse release)
  const measureHoldRate = async (percent: number) => {
    await page.locator('#joint-tab').click();
    await jogJointTo(page, 0, -80);
    await page.locator('#cartesian-tab').click();
    await setSpeed(page, percent);
    const startDeg = Number(await page.locator('#stage-joint-0').innerText());
    await pressMouse(page, '#pose-home');
    // Wait past 220ms long-press threshold, then measure continuous angular travel
    await page.waitForTimeout(260);
    const midStart = await page.evaluate(() => ({
      t0: performance.now(),
      deg: Number(document.querySelector('#stage-joint-0')!.textContent),
    }));
    await page.waitForTimeout(650);
    await page.mouse.up();
    const afterRelease = await page.evaluate(() => ({
      dtSec: (performance.now() - performance.timeOrigin) / 1000,
      now: performance.now(),
      deg: Number(document.querySelector('#stage-joint-0')!.textContent),
    }));
    // Releasing must stop motion immediately
    await page.waitForTimeout(300);
    expect(Number(await page.locator('#stage-joint-0').innerText())).toBe(afterRelease.deg);
    const totalMoved = Math.abs(afterRelease.deg - startDeg);
    const continuousMoved = Math.abs(afterRelease.deg - midStart.deg);
    const elapsedSec = (afterRelease.now - midStart.t0) / 1000;
    return { totalMoved, rateDegPerSec: continuousMoved / elapsedSec };
  };

  const slowRun = await measureHoldRate(1);
  expect(slowRun.totalMoved).toBeGreaterThan(0.15);
  expect(slowRun.rateDegPerSec).toBeLessThan(2.5);

  const fastRun = await measureHoldRate(100);
  expect(fastRun.totalMoved).toBeGreaterThan(10);
  expect(fastRun.rateDegPerSec).toBeGreaterThan(slowRun.rateDegPerSec * 10);

  // Hold #pose-level and #pose-home to completion and verify rail (420.0 mm), sensor, and Gripper G2 opening (52.0 mm) are preserved
  await page.locator('#joint-tab').click();
  await jogJointTo(page, 4, 30);
  await page.locator('#cartesian-tab').click();
  await holdUntilDone(page, '#pose-level');
  expect(Math.abs(Number(await page.locator('#stage-joint-4').innerText()))).toBeLessThanOrEqual(0.11);
  await holdUntilDone(page, '#pose-home');
  await expect(page.locator('#stage-joint-0')).toHaveText('0.00');
  await expect(page.locator('#stage-rail-pos')).toHaveText('420.0');
  await expect(page.locator('#rail-number')).toHaveValue('420.0');
  await expect(page.locator('#tool-sensor-check')).toBeChecked();
  await expect(page.locator('#tool-gripper-select')).toHaveValue('gripper-g2');
  await expect(page.locator('#opening-number')).toHaveValue('52.0');
  const paramsAfterHome = new URL(page.url()).searchParams;
  expect(Number(paramsAfterHome.get('railPos'))).toBe(420);
  expect(paramsAfterHome.get('sensor')).toBe('ai1500');
  expect(paramsAfterHome.get('gripper')).toBe('gripper-g2');
  expect(Number(paramsAfterHome.get('opening'))).toBe(52);

  // 2. Mid-trajectory collision during held Initial position (#pose-home):
  // Switch to bare xArm 6 and arrange [0, 25, -25, 355, -95, 0] (safe to jog to,
  // while linear return to [0..0] sweeps through J4 ≈ 180°, J5 ≈ -48° folding the wrist into the arm).
  await clearSavedScene(page);
  await ready(page, '/?model=xarm6');
  await page.locator('#joint-tab').click();
  await jogJointTo(page, 1, 25);
  await jogJointTo(page, 2, -25);
  await jogJointTo(page, 3, 355);
  await jogJointTo(page, 4, -95);
  await expect(page.locator('#collision-toast')).toBeHidden();

  const canvas = page.locator('#canvas-area canvas');
  await page.waitForTimeout(80);
  const safeCrimson = await analyzeCanvasColors(page, await canvas.screenshot());
  expect(safeCrimson).toBeLessThan(120);

  await page.locator('#cartesian-tab').click();
  await setSpeed(page, 100);
  await holdUntilDone(page, '#pose-home', 18_000);
  await expect(page.locator('#collision-toast')).toBeVisible();
  await expect(page.locator('#collision-toast-text')).toContainText('检测到碰撞，已阻止继续运动：');

  const stoppedJ4 = Number(await page.locator('#stage-joint-3').innerText());
  expect(stoppedJ4).toBeLessThan(355);
  expect(stoppedJ4).toBeGreaterThan(100);
  await expect(page.locator('#joint-angle-3')).toHaveText(`${stoppedJ4.toFixed(2)}°`);
  await page.waitForTimeout(80);
  const hitCrimson = await analyzeCanvasColors(page, await canvas.screenshot());
  expect(hitCrimson).toBeGreaterThan(safeCrimson + 500);

  // Bilingual collision prompt re-translates live
  await page.locator('#language').click();
  await expect(page.locator('#collision-toast-text')).toContainText('Collision detected; motion blocked: ');
  await page.locator('#language').click();

  // 3. Mid-trajectory collision during held Level flange (#pose-level):
  // Arrange [0, 0, -3, 120, -60, 0] (safe while J5 = -60° tilts link6 clear of link2;
  // leveling drives J5 toward 0° and collides link5/link6 against link2 mid-way).
  await clearSavedScene(page);
  await ready(page, '/?model=xarm6');
  await page.locator('#joint-tab').click();
  await jogJointTo(page, 2, -25);
  await jogJointTo(page, 3, 120);
  await jogJointTo(page, 4, -60);
  await jogJointTo(page, 2, -3);
  await expect(page.locator('#collision-toast')).toBeHidden();

  await page.locator('#cartesian-tab').click();
  await setSpeed(page, 100);
  await holdUntilDone(page, '#pose-level', 12_000);
  await expect(page.locator('#collision-toast')).toBeVisible();
  await expect(page.locator('#collision-toast-text')).toContainText('检测到碰撞，已阻止继续运动：');
  const stoppedJ5 = Number(await page.locator('#stage-joint-4').innerText());
  expect(stoppedJ5).toBeGreaterThan(-60);
  expect(stoppedJ5).toBeLessThan(-1);
  expect(errors).toEqual([]);
});

test('touch tap/long-press and hold interruption on cancel, blur, tab switch, panel collapse, accessory/rail edit, and page/model switch', async ({
  browser,
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));

  await ready(page, '/?model=xarm6&rail=al0700&railPos=200&gripper=gripper-g2&opening=80');

  const arrangeJ1 = async (deg = -80) => {
    if (await page.locator('#joint-panel').isHidden()) {
      await page.locator('#joint-tab').click();
    }
    await jogJointTo(page, 0, deg);
    await page.locator('#cartesian-tab').click();
    if (await page.locator('#pose-panel').isHidden()) {
      await page.locator('#motion-collapse').click();
    }
  };

  // 1. pointercancel and lostpointercapture before 220ms neither step nor start continuous motion
  await arrangeJ1(-20);
  await page.locator('#pose-home').dispatchEvent('pointerdown', { pointerId: 11, pointerType: 'touch', button: 0 });
  await page.waitForTimeout(100);
  await page.locator('#pose-home').dispatchEvent('pointercancel', { pointerId: 11, pointerType: 'touch' });
  await page.waitForTimeout(260);
  expect(Number(await page.locator('#stage-joint-0').innerText())).toBe(-20);

  await page.locator('#pose-home').dispatchEvent('pointerdown', { pointerId: 12, pointerType: 'touch', button: 0 });
  await page.locator('#pose-home').dispatchEvent('lostpointercapture', { pointerId: 12, pointerType: 'touch' });
  await page.waitForTimeout(260);
  expect(Number(await page.locator('#stage-joint-0').innerText())).toBe(-20);

  // 2. Stops held motion on window blur and document visibilitychange
  await arrangeJ1(-80);
  await setSpeed(page, 60);
  await pressMouse(page, '#pose-home');
  await expect.poll(async () => Number(await page.locator('#stage-joint-0').innerText())).toBeGreaterThan(-76);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const afterBlur = Number(await page.locator('#stage-joint-0').innerText());
  expect(afterBlur).toBeLessThan(-10);
  await page.waitForTimeout(350);
  expect(Number(await page.locator('#stage-joint-0').innerText())).toBe(afterBlur);
  await page.mouse.up();

  await arrangeJ1(-80);
  await pressMouse(page, '#pose-home');
  await expect.poll(async () => Number(await page.locator('#stage-joint-0').innerText())).toBeGreaterThan(-76);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Reflect.deleteProperty(document, 'hidden');
  });
  const afterHidden = Number(await page.locator('#stage-joint-0').innerText());
  expect(afterHidden).toBeLessThan(-10);
  await page.waitForTimeout(350);
  expect(Number(await page.locator('#stage-joint-0').innerText())).toBe(afterHidden);
  await page.mouse.up();

  // 3. Stops held motion when switching control tabs or collapsing the Cartesian panel (consistent with joint & Cartesian jog buttons)
  await arrangeJ1(-80);
  await pressMouse(page, '#pose-home');
  await expect.poll(async () => Number(await page.locator('#stage-joint-0').innerText())).toBeGreaterThan(-76);
  await page.locator('#joint-tab').evaluate(el => (el as HTMLButtonElement).click());
  const afterTabSwitch = Number(await page.locator('#stage-joint-0').innerText());
  expect(afterTabSwitch).toBeLessThan(-10);
  await page.waitForTimeout(350);
  expect(Number(await page.locator('#stage-joint-0').innerText())).toBe(afterTabSwitch);
  await page.mouse.up();

  await arrangeJ1(-80);
  await pressMouse(page, '#pose-home');
  await expect.poll(async () => Number(await page.locator('#stage-joint-0').innerText())).toBeGreaterThan(-76);
  await page.locator('#motion-collapse').evaluate(el => (el as HTMLButtonElement).click());
  const afterCollapse = Number(await page.locator('#stage-joint-0').innerText());
  expect(afterCollapse).toBeLessThan(-10);
  await page.waitForTimeout(350);
  expect(Number(await page.locator('#stage-joint-0').innerText())).toBe(afterCollapse);
  await page.mouse.up();
  await page.locator('#motion-collapse').click();

  // 4. Stops held motion on rail edit, opening edit, accessory toggle, page switch, and model switch
  await arrangeJ1(-80);
  await pressMouse(page, '#pose-home');
  await expect.poll(async () => Number(await page.locator('#stage-joint-0').innerText())).toBeGreaterThan(-76);
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('#rail-number')!;
    input.value = '260';
    input.dispatchEvent(new Event('change'));
  });
  const afterRail = Number(await page.locator('#stage-joint-0').innerText());
  expect(afterRail).toBeLessThan(-10);
  await page.waitForTimeout(350);
  expect(Number(await page.locator('#stage-joint-0').innerText())).toBe(afterRail);
  await page.mouse.up();

  await arrangeJ1(-80);
  await pressMouse(page, '#pose-home');
  await expect.poll(async () => Number(await page.locator('#stage-joint-0').innerText())).toBeGreaterThan(-76);
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('#opening-number')!;
    input.value = '60';
    input.dispatchEvent(new Event('change'));
  });
  const afterOpening = Number(await page.locator('#stage-joint-0').innerText());
  expect(afterOpening).toBeLessThan(-10);
  await page.waitForTimeout(350);
  expect(Number(await page.locator('#stage-joint-0').innerText())).toBe(afterOpening);
  await page.mouse.up();

  await arrangeJ1(-80);
  await pressMouse(page, '#pose-home');
  await expect.poll(async () => Number(await page.locator('#stage-joint-0').innerText())).toBeGreaterThan(-76);
  await page.locator('#tool-sensor-check').evaluate(el => (el as HTMLInputElement).click());
  await page.mouse.up();
  await ready(page);
  const afterSensor = Number(await page.locator('#stage-joint-0').innerText());
  expect(afterSensor).toBeLessThan(-10);
  await page.waitForTimeout(350);
  expect(Number(await page.locator('#stage-joint-0').innerText())).toBe(afterSensor);

  await arrangeJ1(-80);
  await pressMouse(page, '#pose-home');
  await expect.poll(async () => Number(await page.locator('#stage-joint-0').innerText())).toBeGreaterThan(-76);
  await page.locator('#page-examples').evaluate(el => (el as HTMLAnchorElement).click());
  await page.mouse.up();
  await expect(page.locator('#packing-page')).toBeVisible();
  const afterPageSwitch = Number(await page.locator('#stage-joint-0').innerText());
  expect(afterPageSwitch).toBeLessThan(-10);
  await page.waitForTimeout(350);
  await page.locator('#page-robot').click();
  expect(Number(await page.locator('#stage-joint-0').innerText())).toBe(afterPageSwitch);

  await arrangeJ1(-80);
  await pressMouse(page, '#pose-home');
  await expect.poll(async () => Number(await page.locator('#stage-joint-0').innerText())).toBeGreaterThan(-76);
  await page.evaluate(() => {
    const select = document.querySelector<HTMLSelectElement>('#robot-select')!;
    select.value = 'xarm7';
    select.dispatchEvent(new Event('change'));
  });
  await page.mouse.up();
  await ready(page);
  await expect(page.locator('#stage-joint-0')).toHaveText('0.00');
  await page.waitForTimeout(350);
  await expect(page.locator('#stage-joint-0')).toHaveText('0.00');
  expect(errors).toEqual([]);

  // 5. Touch tap (1° step) and touch long-press (continuous motion, stops on release) on 320px mobile viewport
  const touchContext = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 320, height: 700 } });
  const touchPage = await touchContext.newPage();
  await ready(touchPage, '/');
  await setSpeed(touchPage, 50);
  await touchPage.locator('#joint-tab').click();
  await jogJointTo(touchPage, 4, 60);

  const levelBtn = touchPage.locator('#pose-level');
  await levelBtn.scrollIntoViewIfNeeded();
  const levelBox = (await levelBtn.boundingBox())!;
  await touchPage.touchscreen.tap(levelBox.x + levelBox.width / 2, levelBox.y + levelBox.height / 2);
  await expect(touchPage.locator('#stage-joint-4')).toHaveText('59.00');

  const cdp = await touchContext.newCDPSession(touchPage);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: levelBox.x + levelBox.width / 2, y: levelBox.y + levelBox.height / 2 }],
  });
  await touchPage.waitForTimeout(650);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const stoppedLevel = Number(await touchPage.locator('#stage-joint-4').innerText());
  expect(stoppedLevel).toBeLessThan(56);
  expect(stoppedLevel).toBeGreaterThan(5);
  await touchPage.waitForTimeout(300);
  expect(Number(await touchPage.locator('#stage-joint-4').innerText())).toBe(stoppedLevel);
  await touchContext.close();
});
