import { devices, expect, test, type Page } from '@playwright/test';
import { jogJointTo, selectRail, selectRobot } from './selection-panels';

async function ready(page: Page) {
  await expect(page.locator('#stage')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
}

async function angle(page: Page, index = 0) {
  return Number(await page.locator(`#stage-joint-${index}`).innerText());
}

async function pressMouse(page: Page, selector: string) {
  const button = page.locator(selector);
  await button.scrollIntoViewIfNeeded();
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
}

const j1Plus = '.joint-jog-btn[data-joint-index="0"][data-joint-dir="1"]';
const j1Minus = '.joint-jog-btn[data-joint-index="0"][data-joint-dir="-1"]';

test('shared speed and both control panels preserve collapse state across tabs, languages and sizes', async ({ page }) => {
  await page.goto('/?model=xarm7&rail=al0700&railPos=350');
  await ready(page);
  await expect(page.locator('#robot-select option')).toHaveText(['xArm 5', 'xArm 6', 'xArm 7', '850', 'Lite 6']);
  await expect(page.locator('[data-standalone-view], #standalone-hint, #return-assembly')).toHaveCount(0);
  await expect(page.locator('#control-tabs [role="tab"]')).toHaveText(['笛卡尔控制', '关节控制']);
  await expect(page.locator('#cartesian-tab')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#joint-tab')).toHaveAttribute('aria-selected', 'false');
  await expect(page.locator('#joint-panel')).toBeHidden();
  await expect(page.locator('#motion-collapse')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#pose-panel')).toBeVisible();
  await expect(page.locator('#pose-actions')).toBeVisible();
  await expect(page.locator('#jog-speed')).toHaveValue('50');
  await page.locator('#jog-speed').fill('73');
  await expect(page.locator('#jog-speed-readout')).toHaveText('73%');
  await page.locator('#motion-collapse').click();
  await expect(page.locator('#motion-collapse')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#pose-panel')).toBeHidden();
  await expect(page.locator('#motion-speed')).toBeHidden();
  await expect(page.locator('#pose-actions')).toBeHidden();
  await expect(page.locator('#joint-tab')).toBeVisible();
  await expect(page.locator('#cartesian-tab')).toBeVisible();
  await page.locator('#joint-tab').click();
  await expect(page.locator('#joint-panel')).toBeVisible();
  await expect(page.locator('#joint-tab')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#cartesian-tab')).toHaveAttribute('aria-selected', 'false');
  await expect(page.locator('#joint-intro, .panel-description')).toHaveCount(0);
  await expect(page.locator('#motion-speed')).toBeVisible();
  await expect(page.locator('#pose-actions')).toBeVisible();
  await expect(page.locator('#jog-speed')).toHaveValue('73');
  await expect(page.locator('#motion-collapse')).toBeVisible();
  await expect(page.locator('#motion-collapse')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#motion-collapse')).toHaveAccessibleName('收起关节控制');
  await expect(page.locator('#motion-collapse')).toHaveAttribute('aria-controls', 'joint-panel motion-speed pose-actions');
  await page.locator('#motion-collapse').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#motion-collapse')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#motion-collapse')).toHaveAttribute('data-chevron', 'down');
  await expect(page.locator('#motion-collapse')).toHaveAccessibleName('展开关节控制');
  await expect(page.locator('#joint-panel')).toBeHidden();
  await expect(page.locator('#motion-speed')).toBeHidden();
  await expect(page.locator('#pose-actions')).toBeHidden();
  await expect(page.locator('#solver-status')).toHaveJSProperty('hidden', true);
  await page.locator('#cartesian-tab').click();
  await expect(page.locator('#motion-collapse')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#motion-collapse')).toHaveAttribute('aria-controls', 'pose-panel motion-speed pose-actions');
  await expect(page.locator('#pose-panel')).toBeHidden();
  await expect(page.locator('#pose-actions')).toBeHidden();
  await page.locator('#motion-collapse').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#pose-panel')).toBeVisible();
  await expect(page.locator('#pose-actions')).toBeVisible();
  await expect(page.locator('#jog-speed')).toHaveValue('73');
  await page.locator('#joint-tab').click();
  await expect(page.locator('#motion-collapse')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#joint-panel')).toBeHidden();
  await page.locator('#motion-collapse').click();
  await expect(page.locator('#joint-panel')).toBeVisible();
  await expect(page.locator('#motion-speed')).toBeVisible();
  await expect(page.locator('#pose-actions')).toBeVisible();
  await expect(page.locator('#solver-status')).toBeHidden();
  await expect(page.locator('#jog-speed')).toHaveValue('73');
  await page.locator('#cartesian-tab').click();
  await expect(page.locator('#pose-panel')).toBeVisible();

  for (const language of ['zh', 'en']) {
    if (language === 'en') await page.locator('#language').click();
    await expect(page.locator('#jog-speed')).toHaveAccessibleName(language === 'zh' ? '速度' : 'Speed');
    await expect(page.locator('#motion-collapse')).toHaveAccessibleName(language === 'zh' ? '收起笛卡尔控制' : 'Collapse Cartesian controls');
    for (const width of [1440, 800, 601, 600, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      const select = (await page.locator('#robot-select').boundingBox())!;
      const stage = (await page.locator('#stage').boundingBox())!;
      const telemetry = (await page.locator('#stage-telemetry').boundingBox())!;
      const cartesianTab = (await page.locator('#cartesian-tab').boundingBox())!;
      const jointTab = (await page.locator('#joint-tab').boundingBox())!;
      expect(cartesianTab.x + cartesianTab.width).toBeLessThanOrEqual(jointTab.x);
      expect(select.x).toBeGreaterThan(stage.x);
      expect(select.y).toBeGreaterThan(stage.y);
      expect(select.y).toBeLessThan(stage.y + 60);
      expect(select.x + select.width).toBeLessThan(telemetry.x);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.locator('#joint-tab').click();
      const collapse = page.locator('#motion-collapse');
      await expect(collapse).toBeVisible();
      await expect(collapse).toHaveAccessibleName(language === 'zh' ? '收起关节控制' : 'Collapse joint controls');
      const collapseBox = (await collapse.boundingBox())!;
      const cardBox = (await page.locator('#control-card').boundingBox())!;
      expect(collapseBox.x).toBeGreaterThanOrEqual(jointTab.x + jointTab.width);
      expect(collapseBox.x + collapseBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
      await expect(page.locator('.joint-row')).toHaveCount(7);
      await expect(page.locator('#joint-list [role="progressbar"]')).toHaveCount(7);
      await expect(page.locator('#joint-progress-0')).toHaveAccessibleName(language === 'zh' ? '关节 1 位置' : 'Joint 1 position');
      await expect(page.locator('#joint-progress-3')).toHaveAttribute('aria-valuemin', '-11');
      await expect(page.locator('#joint-progress-3')).toHaveAttribute('aria-valuemax', '225');
      expect(await page.locator('.joint-row').evaluateAll(rows => rows.every(row => row.scrollWidth <= row.clientWidth))).toBe(true);
      await expect(page.locator(j1Plus)).toHaveAccessibleName(language === 'zh' ? '关节 1 增加' : 'Joint 1 increase');
      await collapse.click();
      await expect(collapse).toHaveAccessibleName(language === 'zh' ? '展开关节控制' : 'Expand joint controls');
      await expect(page.locator('#joint-panel')).toBeHidden();
      await collapse.click();
      await page.locator('#cartesian-tab').click();
    }
  }
  const stageSize = await page.locator('#stage').evaluate(el => [el.clientWidth, el.clientHeight]);
  await page.locator('#motion-collapse').click();
  expect(await page.locator('#stage').evaluate(el => [el.clientWidth, el.clientHeight])).toEqual(stageSize);
  await selectRail(page, '');
  await ready(page);
  await expect(page.locator('#motion-collapse')).toHaveAttribute('aria-expanded', 'false');
});

test('collapsing joint controls stops held joint and preset motion', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.locator('#joint-tab').click();
  await page.locator('#jog-speed').fill('100');

  await pressMouse(page, j1Plus);
  await expect.poll(() => angle(page), { timeout: 8_000 }).toBeGreaterThan(20);
  await expect(page.locator(j1Plus)).toHaveClass(/is-jogging/);
  await page.locator('#motion-collapse').evaluate(el => (el as HTMLButtonElement).click());
  await expect(page.locator(j1Plus)).not.toHaveClass(/is-jogging/);
  const jointStopped = await angle(page);
  await page.waitForTimeout(400);
  expect(await angle(page)).toBe(jointStopped);
  await page.mouse.up();
  await page.locator('#motion-collapse').click();
  await expect(page.locator('#jog-speed')).toHaveValue('100');

  await pressMouse(page, '#pose-home');
  await expect.poll(() => angle(page), { timeout: 8_000 }).toBeLessThan(jointStopped - 2);
  await expect(page.locator('#pose-home')).toHaveClass(/is-jogging/);
  await page.locator('#motion-collapse').evaluate(el => (el as HTMLButtonElement).click());
  await expect(page.locator('#pose-home')).not.toHaveClass(/is-jogging/);
  const presetStopped = await angle(page);
  await page.waitForTimeout(400);
  expect(await angle(page)).toBe(presetStopped);
  await page.mouse.up();
});

test('shared speed persists across reloads and browser tabs', async ({ page }) => {
  await page.goto('/?rail=al0700&railPos=350');
  await ready(page);
  const speed = page.locator('#jog-speed');
  await expect(speed).toHaveValue('50');
  await expect(page.locator('#jog-speed-readout')).toHaveText('50%');

  await speed.fill('73');
  await page.reload();
  await ready(page);
  await expect(speed).toHaveValue('73');
  await expect(page.locator('#jog-speed-readout')).toHaveText('73%');

  await page.locator('#joint-tab').click();
  await expect(speed).toHaveValue('73');
  await speed.fill('35');
  await page.reload();
  await ready(page);
  await expect(speed).toHaveValue('35');
  await expect(page.locator('#jog-speed-readout')).toHaveText('35%');

  const secondPage = await page.context().newPage();
  await secondPage.goto('/');
  await ready(secondPage);
  await expect(secondPage.locator('#jog-speed')).toHaveValue('35');
  await expect(secondPage.locator('#jog-speed-readout')).toHaveText('35%');

  for (const boundary of ['1', '100']) {
    await speed.fill(boundary);
    await page.reload();
    await ready(page);
    await expect(speed).toHaveValue(boundary);
    await expect(page.locator('#jog-speed-readout')).toHaveText(`${boundary}%`);
  }
});

test('invalid saved speeds fall back to the default', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  for (const invalid of ['', '0', '101', '12.5', 'invalid']) {
    await page.evaluate(value => localStorage.setItem('uf-robots:jog-speed', value), invalid);
    await page.reload();
    await ready(page);
    await expect(page.locator('#jog-speed')).toHaveValue('50');
    await expect(page.locator('#jog-speed-readout')).toHaveText('50%');
  }
});

test('speed control remains usable when browser storage is unavailable', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() { throw new DOMException('Storage is unavailable', 'SecurityError'); },
    });
  });
  await page.goto('/');
  await ready(page);
  await expect(page.locator('#jog-speed')).toHaveValue('50');
  await page.locator('#jog-speed').fill('85');
  await expect(page.locator('#jog-speed-readout')).toHaveText('85%');
  await page.reload();
  await ready(page);
  await expect(page.locator('#jog-speed')).toHaveValue('50');
  expect(errors).toEqual([]);
});

test('joint buttons step once for mouse and keyboard and stop when cancelled or blurred', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.locator('#joint-tab').click();
  await expect(page.locator('#joint-list input')).toHaveCount(0);
  await expect(page.locator('#joint-intro')).toHaveCount(0);
  await expect(page.locator('#joint-panel')).not.toContainText('实时更新 3D 模型');
  await expect(page.locator('#joint-progress-0')).toHaveAttribute('aria-valuenow', '0.00');
  // Clicking the read-only progress bar must not alter the joint angle
  await page.locator('#joint-progress-0').click({ force: true, position: { x: 8, y: 2 } });
  await expect(page.locator('#joint-angle-0')).toHaveText('0.00°');
  await page.locator(j1Plus).click();
  await expect(page.locator('#joint-angle-0')).toHaveText('1.00°');
  await expect(page.locator('#joint-progress-0')).toHaveAttribute('aria-valuenow', '1.00');
  await expect(page.locator('#joint-progress-0')).toHaveAttribute('aria-valuetext', '1.00°');
  const posBar = await page.evaluate(() => ({
    fillLeft: parseFloat((document.querySelector('#joint-fill-0') as HTMLElement).style.left),
    fillWidth: parseFloat((document.querySelector('#joint-fill-0') as HTMLElement).style.width),
    markerLeft: parseFloat((document.querySelector('#joint-marker-0') as HTMLElement).style.left),
  }));
  expect(posBar.fillLeft).toBeCloseTo(50, 2);
  expect(posBar.fillWidth).toBeGreaterThan(0.1);
  expect(posBar.markerLeft).toBeGreaterThan(50.1);
  await page.locator(j1Minus).click();
  await page.locator(j1Minus).click();
  await expect(page.locator('#joint-angle-0')).toHaveText('-1.00°');
  const negBar = await page.evaluate(() => ({
    fillLeft: parseFloat((document.querySelector('#joint-fill-0') as HTMLElement).style.left),
    fillWidth: parseFloat((document.querySelector('#joint-fill-0') as HTMLElement).style.width),
    markerLeft: parseFloat((document.querySelector('#joint-marker-0') as HTMLElement).style.left),
  }));
  expect(negBar.markerLeft).toBeLessThan(49.9);
  expect(negBar.fillLeft).toBeCloseTo(negBar.markerLeft, 2);
  expect(negBar.fillWidth).toBeGreaterThan(0.1);
  // Shared Initial position button works directly from the Joint tab
  await page.locator('#pose-home').click();
  await expect(page.locator('#joint-angle-0')).toHaveText('0.00°');
  await expect(page.locator('#joint-progress-0')).toHaveAttribute('aria-valuenow', '0.00');
  await page.locator(j1Plus).click();
  await expect(page.locator('#joint-angle-0')).toHaveText('1.00°');
  await page.locator(j1Minus).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#joint-angle-0')).toHaveText('0.00°');
  await page.locator(j1Plus).focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#joint-angle-0')).toHaveText('1.00°');
  await page.locator(j1Plus).evaluate(el => (el as HTMLButtonElement).click());
  await expect(page.locator('#joint-angle-0')).toHaveText('2.00°');
  await page.locator(j1Minus).click();

  await page.locator(j1Plus).dispatchEvent('pointerdown', { pointerId: 7, pointerType: 'touch', button: 0 });
  await page.waitForTimeout(100);
  await page.locator(j1Plus).dispatchEvent('pointercancel', { pointerId: 7, pointerType: 'touch' });
  await page.waitForTimeout(250);
  expect(await angle(page)).toBe(1);
  await page.locator(j1Plus).dispatchEvent('pointerdown', { pointerId: 8, pointerType: 'touch', button: 0 });
  await page.locator(j1Plus).dispatchEvent('lostpointercapture', { pointerId: 8, pointerType: 'touch' });
  await page.waitForTimeout(250);
  expect(await angle(page)).toBe(1);

  await page.locator('#jog-speed').fill('100');
  await pressMouse(page, j1Plus);
  await expect.poll(() => angle(page), { timeout: 8_000 }).toBeGreaterThan(4);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const stopped = await angle(page);
  await page.waitForTimeout(350);
  expect(await angle(page)).toBe(stopped);
  await page.mouse.up();

  await pressMouse(page, j1Plus);
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Reflect.deleteProperty(document, 'hidden');
  });
  const hidden = await angle(page);
  await page.waitForTimeout(350);
  expect(await angle(page)).toBe(hidden);
  await page.mouse.up();

  await pressMouse(page, j1Plus);
  await page.waitForTimeout(400);
  await page.locator('#cartesian-tab').evaluate(el => (el as HTMLButtonElement).click());
  const switched = await angle(page);
  await page.waitForTimeout(350);
  expect(await angle(page)).toBe(switched);
  await page.mouse.up();

  await page.locator('#joint-tab').click();
  await pressMouse(page, j1Plus);
  await page.waitForTimeout(400);
  await page.locator('#robot-select').selectOption('xarm7');
  await page.mouse.up();
  await ready(page);
  await expect(page.locator('#stage-joint-0')).toHaveText('0.00');
  await page.waitForTimeout(350);
  await expect(page.locator('#stage-joint-0')).toHaveText('0.00');
});

test('Cartesian yaw hold follows the 40 degrees per second maximum', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.locator('#jog-speed').fill('100');
  await pressMouse(page, '[data-jog-axis="yaw"][data-jog-dir="1"]');
  await page.waitForTimeout(350);

  const sample = () => page.evaluate(() => ({
    time: performance.now(),
    yaw: Number(document.querySelector('#fk-5')!.textContent),
  }));
  const start = await sample();
  await page.waitForTimeout(700);
  const end = await sample();
  await page.mouse.up();

  const speed = (end.yaw - start.yaw) / ((end.time - start.time) / 1000);
  expect(speed).toBeGreaterThan(20);
  expect(speed).toBeLessThan(55);
  const stopped = Number(await page.locator('#fk-5').innerText());
  await page.waitForTimeout(250);
  expect(Number(await page.locator('#fk-5').innerText())).toBe(stopped);
});

test('joint hold speed follows the shared slider and stops at limits', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.locator('#joint-tab').click();
  await page.locator('#jog-speed').fill('1');
  await pressMouse(page, j1Plus);
  await page.waitForTimeout(100);
  expect(await angle(page)).toBe(0);
  await page.waitForTimeout(700);
  await page.mouse.up();
  const slow = await angle(page);
  expect(slow).toBeGreaterThan(0.15);
  expect(slow).toBeLessThan(1.5);
  await page.locator('#jog-speed').fill('100');
  const beforeFast = await angle(page);
  await pressMouse(page, j1Plus);
  await page.waitForTimeout(800);
  await page.mouse.up();
  const fast = (await angle(page)) - beforeFast;
  expect(fast).toBeGreaterThan(8);
  expect(fast).toBeGreaterThan(slow * 10);

  await page.reload();
  await ready(page);
  await page.locator('#joint-tab').click();
  await jogJointTo(page, 0, 359);
  const upper = j1Plus;
  await page.locator('#jog-speed').fill('100');
  await pressMouse(page, upper);
  await expect.poll(() => angle(page), { timeout: 8_000 }).toBeCloseTo(6.2832 * 180 / Math.PI, 2);
  const atLimit = await angle(page);
  await page.waitForTimeout(350);
  expect(await angle(page)).toBe(atLimit);
  await page.mouse.up();
});

test('touch long press moves continuously and release stops motion', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 320, height: 700 } });
  const page = await context.newPage();
  await page.goto('/');
  await ready(page);
  await page.locator('#joint-tab').click();
  await page.locator('#jog-speed').fill('100');
  const button = page.locator(j1Plus);
  await button.scrollIntoViewIfNeeded();
  const box = (await button.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('#joint-angle-0')).toHaveText('1.00°');
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
  await page.waitForTimeout(700);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const stopped = await angle(page);
  expect(stopped).toBeGreaterThan(5);
  await page.waitForTimeout(350);
  expect(await angle(page)).toBe(stopped);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await context.close();
});

test('continuous joint motion stops at collision and can reverse', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.locator('#joint-tab').click();
  await page.locator('#jog-speed').fill('100');
  const j2Plus = '.joint-jog-btn[data-joint-index="1"][data-joint-dir="1"]';
  await pressMouse(page, j2Plus);
  await expect(page.locator('#collision-toast')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#solver-status')).not.toHaveClass(/has-message/);
  await expect(page.locator('#status-text')).toBeEmpty();
  const stopped = await angle(page, 1);
  await page.waitForTimeout(500);
  expect(await angle(page, 1)).toBe(stopped);
  await page.mouse.up();
  await page.locator('.joint-jog-btn[data-joint-index="1"][data-joint-dir="-1"]').click();
  await expect(page.locator('#collision-toast')).toBeHidden();
  expect(await angle(page, 1)).toBeLessThan(stopped);
});

test('collapsing Cartesian controls stops a held jog and feedback remains translated', async ({ page }) => {
  await page.goto('/?gripper=gripper-g2');
  await ready(page);
  await page.locator('#jog-speed').fill('40');
  const zPlus = '[data-jog-axis="z"][data-jog-dir="1"]';
  await pressMouse(page, zPlus);
  await page.waitForTimeout(600);
  await page.locator('#motion-collapse').evaluate(el => (el as HTMLButtonElement).click());
  const stopped = await page.locator('#stage-joint-fields output').allTextContents();
  await page.waitForTimeout(400);
  expect(await page.locator('#stage-joint-fields output').allTextContents()).toEqual(stopped);
  await page.mouse.up();
  await page.locator('#motion-collapse').click();
  await expect(page.locator('#jog-speed')).toHaveValue('40');
  await page.locator('#opening-number').fill('100');
  await page.locator('#opening-number').dispatchEvent('change');
  await expect(page.locator('#opening-error')).toBeVisible();
  await expect(page.locator('#opening-error-text')).toHaveText('请输入有效且在范围内的数值。');
  await expect(page.locator('#status-text')).toBeEmpty();
  await page.locator('#language').click();
  await expect(page.locator('#opening-error-text')).toHaveText('Enter a valid value within the allowed range.');
  await expect(page.locator('#status-text')).toBeEmpty();
  await selectRobot(page, 'lite6');
  await ready(page);
  await expect(page.locator('#opening-error')).toBeHidden();
  await expect(page.locator('#status-text')).toBeEmpty();
});
