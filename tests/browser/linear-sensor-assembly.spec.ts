import { devices, expect, test, type Page } from '@playwright/test';
import { returnToAssembly, selectRail, selectRobot, viewStandalone } from './selection-panels';

const URLS = {
  xarm6: 'https://www.shop.ufactory.cc/products/xarm-6',
  xarm7: 'https://www.shop.ufactory.cc/products/xarm-7',
  uf850: 'https://www.shop.ufactory.cc/products/850',
  lite6: 'https://www.shop.ufactory.cc/products/lite-6',
  rail: 'https://www.shop.ufactory.cc/products/direct-drive-linear-motor',
  sensor: 'https://www.shop.ufactory.cc/products/6-axis-ft-sensor',
  g2: 'https://www.shop.ufactory.cc/products/gripper-g2',
  bio: 'https://www.shop.ufactory.cc/products/bio-gripper-g2',
};

async function ready(page: Page) {
  await expect(page.locator('#stage')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
}

async function setRailNumber(page: Page, value: string) {
  await page.locator('#rail-number').fill(value);
  await page.locator('#rail-number').dispatchEvent('change');
}

test('4-way assembly stacks F/T sensor + single gripper + linear motor with live travel and IK jogging', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.goto('/');
  await ready(page);

  await expect(page.locator('.selection-bar')).toHaveCount(0);
  for (const id of ['#rail-selector', '#tool-menu']) {
    await expect(page.locator(id)).toBeVisible();
  }
  await expect(page.locator('#rail-panel')).toBeHidden();
  const stageBox = (await page.locator('#stage').boundingBox())!;
  const robotBox = (await page.locator('#motion-panel').boundingBox())!;
  const railBox = (await page.locator('#rail-selector').boundingBox())!;
  const toolBox = (await page.locator('#tool-dropdown').boundingBox())!;
  expect(robotBox.x).toBeGreaterThan(stageBox.x + stageBox.width);
  expect(toolBox.y).toBeGreaterThan(robotBox.y + robotBox.height);
  expect(railBox.y).toBeGreaterThan(toolBox.y + toolBox.height);
  await expect(page.locator('#robot-select option:not([value="standalone"])')).toHaveCount(5);
  await expect(page.locator('#robot-select')).toHaveValue('xarm6');
  await expect(page.locator('#robot-models')).toBeVisible();
  await expect(page.getByRole('switch', { name: '直线滑轨', exact: true })).not.toBeChecked();
  await expect(page.locator('#rail-selector')).not.toContainText('调整滑块沿直线滑轨的行程位置');

  await expect(page.locator('#rail-selector')).toBeVisible();
  await expect(page.locator('#stage-rail-telemetry')).toBeHidden();
  const bareZ = Number(await page.locator('#fk-2').innerText());
  expect(bareZ).toBeCloseTo(112.0, 1);

  // 1. Enable 6-Axis F/T Sensor (+58.6 mm flange +Z => -58.6 mm base Z)
  await expect(page.locator('#tool-menu')).toBeVisible();
  await page.locator('#tool-sensor-check').check();
  await ready(page);
  await expect(page.locator('#tool-summary')).toHaveText('六维力矩传感器');
  await expect(page.locator('#stage')).toHaveAttribute('data-sensor', 'ai1500');
  expect(Number(await page.locator('#fk-2').innerText())).toBeCloseTo(bareZ - 58.6, 1);
  await expect(page.locator('#assets a')).toHaveCount(2);

  // 2. Stack Gripper G2 while keeping F/T Sensor checked; then switch to BIO Gripper G2 (radio mutual exclusion)
  await page.locator('#tool-gripper-gripper-g2').check();
  await ready(page);
  await expect(page.locator('#tool-sensor-check')).toBeChecked();
  await expect(page.locator('#tool-summary')).toHaveText('六维力矩传感器 + Gripper G2');
  await expect(page.locator('#stage')).toHaveAttribute('data-sensor', 'ai1500');
  await expect(page.locator('#stage')).toHaveAttribute('data-gripper', 'gripper-g2');
  expect(Number(await page.locator('#fk-2').innerText())).toBeCloseTo(bareZ - 58.6 - 173.5, 1);

  await page.locator('#tool-gripper-bio-gripper-g2').check();
  await ready(page);
  await expect(page.locator('#tool-sensor-check')).toBeChecked();
  await expect(page.locator('#tool-gripper-gripper-g2')).not.toBeChecked();
  await expect(page.locator('#tool-summary')).toHaveText('六维力矩传感器 + BIO Gripper G2');

  // Switch back to Gripper G2.
  await page.locator('#tool-gripper-gripper-g2').check();
  await ready(page);
  await expect(page.locator('#tool-menu')).toBeVisible();

  // 3. Mount Direct-Drive Linear Motor (AL0700) to complete the 4-way assembly
  const railSwitch = page.getByRole('switch', { name: '直线滑轨', exact: true });
  await railSwitch.focus();
  await page.keyboard.press('Space');
  await ready(page);
  await expect(page.locator('#rail-toggle')).toBeChecked();
  await expect(page.locator('#stage')).toHaveAttribute('data-rail', 'al0700');
  await expect(page.locator('#rail-selector')).toBeVisible();
  await expect(page.locator('#stage-rail-telemetry')).toBeVisible();
  await expect(page.locator('#stage-rail-pos')).toHaveText('0.0');
  await expect(page.locator('#assets a')).toHaveCount(4);

  const expectedHrefs = [URLS.xarm6, URLS.rail, URLS.sensor, URLS.g2];
  for (let i = 0; i < expectedHrefs.length; i++) {
    await expect(page.locator('#assets a').nth(i)).toHaveAttribute('href', expectedHrefs[i]);
  }

  // 4. Move carriage 0 -> 350 -> 700 mm in the rail panel
  await expect(page.locator('#rail-panel')).toBeVisible();
  await expect(page.locator('#rail-number')).toHaveValue('0.0');

  await page.locator('#assets li').first().evaluate(el => { (el as HTMLElement).dataset.preserved = 'yes'; });
  const fkAtZeroRail = await page.locator('#fk-fields').innerText();
  const canvas = page.locator('#canvas-area canvas');
  const shotAtZero = await canvas.screenshot();

  await setRailNumber(page, '350');
  await expect(page.locator('#rail-number')).toHaveValue('350.0');
  await expect(page.locator('#stage-rail-pos')).toHaveText('350.0');
  await expect(page.locator('#assets li').first()).toHaveAttribute('data-preserved', 'yes');
  expect(await page.locator('#fk-fields').innerText()).toBe(fkAtZeroRail);
  expect(page.url()).toContain('rail=al0700');
  expect(page.url()).toContain('railPos=350.0');
  await page.waitForTimeout(100);
  expect((await canvas.screenshot()).equals(shotAtZero)).toBe(false);

  // Validate out-of-range and off-grid inputs preserve 350.0 mm
  for (const invalid of ['-0.1', '700.1', '12.05', '']) {
    await setRailNumber(page, invalid);
    await expect(page.locator('#rail-number')).toHaveValue('350.0');
    await expect(page.locator('#status-text')).toContainText('有效');
  }

  await page.locator('#rail-range').fill('700');
  await page.locator('#rail-range').dispatchEvent('input');
  await expect(page.locator('#rail-number')).toHaveValue('700.0');
  await expect(page.locator('#stage-rail-pos')).toHaveText('700.0');

  await setRailNumber(page, '350');

  // 5. Verify Cartesian IK jogging works identically while mounted on the moving rail carriage at 350 mm
  await page.locator('#cartesian-tab').click();
  const xBefore = Number(await page.locator('#fk-0').innerText());
  const zBefore = Number(await page.locator('#fk-2').innerText());
  await page.locator('[data-jog-axis="x"][data-jog-dir="1"]').click();
  await expect(page.locator('#status-text')).toHaveText('目标已求解');
  expect(Number(await page.locator('#fk-0').innerText()) - xBefore).toBeCloseTo(1, 1);

  await page.locator('[data-jog-axis="z"][data-jog-dir="1"]').click();
  await expect(page.locator('#status-text')).toHaveText('目标已求解');
  expect(Number(await page.locator('#fk-2').innerText()) - zBefore).toBeCloseTo(1, 1);

  // 6. Rail and arm joints can be adjusted independently.
  const joggedJoints = await page.locator('#stage-joint-fields output').allTextContents();
  await setRailNumber(page, '0');
  await expect(page.locator('#stage-rail-pos')).toHaveText('0.0');
  await expect(page.locator('#rail-number')).toHaveValue('0.0');
  expect(await page.locator('#stage-joint-fields output').allTextContents()).toEqual(joggedJoints);
  expect(page.url()).toContain('railPos=0.0');
  await setRailNumber(page, '350');
  await page.locator('#joint-tab').click();
  for (let i = 0; i < 6; i++) {
    await page.locator(`#joint-number-${i}`).fill('0');
    await page.locator(`#joint-number-${i}`).dispatchEvent('change');
    await expect(page.locator(`#stage-joint-${i}`)).toHaveText('0.00');
  }
  await expect(page.locator('#stage-rail-pos')).toHaveText('350.0');
  await page.locator('#cartesian-tab').click();

  // Removing the rail retains its selector while hiding travel controls
  await expect(page.locator('#rail-panel')).toBeVisible();
  await railSwitch.focus();
  await page.keyboard.press('Space');
  await ready(page);
  await expect(page.locator('#rail-selector')).toBeVisible();
  await expect(page.locator('#rail-toggle')).not.toBeChecked();
  await expect(page.locator('#rail-panel')).toBeHidden();
  await expect(page.locator('#pose-panel')).toBeVisible();
  await expect(page.locator('#stage-rail-telemetry')).toBeHidden();
  expect(page.url()).not.toContain('rail=');
  expect(errors).toEqual([]);
});

test('compatibility transitions across xArm 7, 850, and Lite 6 enforce rail and end-effector constraints', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/?model=xarm6&rail=al0700&railPos=350.0&sensor=ai1500&gripper=gripper-g2&opening=42.0');
  await ready(page);
  await expect(page.locator('#assets a')).toHaveCount(4);

  // Switching to xArm 7 preserves all 4 components and rail travel
  await selectRobot(page, 'xarm7');
  await ready(page);
  await expect(page.locator('#rail-toggle')).toBeChecked();
  await expect(page.locator('#rail-panel')).toBeVisible();
  await expect(page.locator('#stage-rail-pos')).toHaveText('350.0');
  await expect(page.locator('#tool-summary')).toHaveText('六维力矩传感器 + Gripper G2');
  await expect(page.locator('#opening-number')).toHaveValue('42.0');
  await expect(page.locator('#assets a')).toHaveCount(4);

  // Switching to 850 hides and removes the linear motor, but preserves F/T Sensor + Gripper G2
  await selectRobot(page, 'uf850');
  await ready(page);
  await expect(page.locator('#rail-toggle')).toBeDisabled();
  await expect(page.locator('#rail-toggle')).not.toBeChecked();
  await expect(page.locator('#rail-selector')).toBeHidden();
  await expect(page.locator('#rail-panel')).toBeHidden();
  await expect(page.getByRole('switch', { name: '直线滑轨', exact: true })).toHaveCount(0);
  await expect(page.locator('#stage-rail-telemetry')).toBeHidden();
  await expect(page.locator('#stage')).not.toHaveAttribute('data-rail');
  await expect(page.locator('#stage')).toHaveAttribute('data-sensor', 'ai1500');
  await expect(page.locator('#stage')).toHaveAttribute('data-gripper', 'gripper-g2');
  await expect(page.locator('#tool-summary')).toHaveText('六维力矩传感器 + Gripper G2');
  await expect(page.locator('#assets a')).toHaveCount(3);
  expect(page.url()).not.toContain('rail=');
  expect(page.url()).not.toContain('railPos=');
  expect(page.url()).toContain('sensor=ai1500');
  expect(page.url()).toContain('gripper=gripper-g2');

  // Switching to Lite 6 hides the rail and clears incompatible accessories
  await selectRobot(page, 'lite6');
  await ready(page);
  await expect(page.locator('#rail-toggle')).toBeDisabled();
  await expect(page.locator('#rail-selector')).toBeHidden();
  await expect(page.locator('#tool-dropdown')).toBeVisible();
  await expect(page.getByRole('switch', { name: '直线滑轨', exact: true })).toHaveCount(0);
  await expect(page.locator('#tool-sensor-check')).toBeDisabled();
  await expect(page.locator('#tool-sensor-group')).toBeHidden();
  await expect(page.locator('#tool-gripper-gripper-g2')).toBeDisabled();
  await expect(page.locator('[data-standalone-view="ai1500"]')).toBeHidden();
  await expect(page.locator('#tool-summary')).toHaveText('无');
  await expect(page.locator('#stage')).not.toHaveAttribute('data-rail');
  await expect(page.locator('#stage')).not.toHaveAttribute('data-sensor');
  await expect(page.locator('#stage')).not.toHaveAttribute('data-gripper');
  await expect(page.locator('#assets a')).toHaveCount(1);
  expect(page.url()).not.toContain('sensor=');
  expect(page.url()).not.toContain('gripper=');

  // Compatible models show the switch again, without restoring the removed rail.
  for (const id of ['xarm5', 'xarm6', 'xarm7']) {
    await selectRobot(page, id);
    await ready(page);
    await expect(page.locator('#rail-selector')).toBeVisible();
    await expect(page.locator('#rail-toggle')).toBeEnabled();
    await expect(page.locator('#rail-toggle')).not.toBeChecked();
  }
});

test('incompatible direct links keep the rail panel hidden in standalone and mobile views', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 320, height: 800 });

  for (const id of ['uf850', 'lite6']) {
    await page.goto(`/?model=${id}&rail=al0700&railPos=200`);
    await ready(page);
    await expect(page.locator('#stage')).toHaveAttribute('data-robot', id);
    await expect(page.locator('#rail-selector')).toBeHidden();
    await expect(page.locator('#stage')).not.toHaveAttribute('data-rail');
    expect(new URL(page.url()).searchParams.has('rail')).toBe(false);
    expect(new URL(page.url()).searchParams.has('railPos')).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await page.locator('#language').click();
    await expect(page.getByRole('switch', { name: 'Linear motor', exact: true })).toHaveCount(0);
    await viewStandalone(page, id === 'lite6' ? 'lite6-gripper' : 'ai1500');
    await ready(page);
    await expect(page.locator('#rail-selector')).toBeHidden();
    await returnToAssembly(page);
    await ready(page);
    await expect(page.locator('#stage')).toHaveAttribute('data-robot', id);
    await expect(page.locator('#rail-selector')).toBeHidden();
  }
});

test('standalone F/T sensor view, full 4-way deep-link reload, bilingual labels, and mobile zero-overflow', async ({ browser }) => {
  test.setTimeout(240_000);
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();

  // 1. Load full 4-way deep link and verify reload fidelity
  await page.goto('/?model=xarm7&rail=al0700&railPos=280.5&sensor=ai1500&gripper=bio-gripper-g2&opening=110.0');
  await ready(page);
  await expect(page.locator('#stage')).toHaveAttribute('data-robot', 'xarm7');
  await expect(page.locator('#stage')).toHaveAttribute('data-rail', 'al0700');
  await expect(page.locator('#stage')).toHaveAttribute('data-sensor', 'ai1500');
  await expect(page.locator('#stage')).toHaveAttribute('data-gripper', 'bio-gripper-g2');
  await expect(page.locator('#stage-rail-pos')).toHaveText('280.5');
  await expect(page.locator('#rail-toggle')).toBeChecked();
  await expect(page.locator('#rail-panel')).toBeVisible();
  await expect(page.locator('#opening-number')).toHaveValue('110.0');
  await expect(page.locator('#tool-summary')).toHaveText('六维力矩传感器 + BIO Gripper G2');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  // 2. Enter standalone 6-Axis F/T Sensor view and verify saved 4-way assembly returns intact
  await viewStandalone(page, 'ai1500');
  await ready(page);
  await expect(page.locator('#stage')).toHaveAttribute('data-mode', 'sensor');
  await expect(page.locator('#stage')).toHaveAttribute('data-sensor', 'ai1500');
  await expect(page.locator('#stage-heading')).toHaveText('六维力矩传感器');
  await expect(page.locator('#gripper-control')).toBeHidden();
  await expect(page.locator('#arm-controls')).toBeHidden();
  await expect(page.locator('#rail-toggle')).not.toBeChecked();
  await expect(page.locator('#rail-panel')).toBeHidden();
  await expect(page.locator('#assets a')).toHaveCount(1);
  await expect(page.locator('#assets a')).toHaveAttribute('href', URLS.sensor);
  expect(page.url()).toContain('model=ai1500');
  expect(page.url()).not.toContain('rail=');

  await selectRail(page, 'al0700');
  await ready(page);
  await expect(page.locator('#stage')).toHaveAttribute('data-robot', 'xarm7');
  await expect(page.locator('#stage')).toHaveAttribute('data-rail', 'al0700');
  await expect(page.locator('#stage-rail-pos')).toHaveText('280.5');
  await expect(page.locator('#tool-summary')).toHaveText('六维力矩传感器 + BIO Gripper G2');
  await expect(page.locator('#opening-number')).toHaveValue('110.0');
  await expect(page.locator('#assets a')).toHaveCount(4);

  await viewStandalone(page, 'ai1500');
  await ready(page);
  await returnToAssembly(page);
  await ready(page);
  await expect(page.locator('#rail-toggle')).toBeChecked();
  await expect(page.locator('#stage-rail-pos')).toHaveText('280.5');

  // 3. Switch to English and check narrow 320px viewport layout
  await page.locator('#language').click();
  await expect(page.locator('#rail-selector')).toContainText('Linear motor');
  await expect(page.getByRole('switch', { name: 'Linear motor', exact: true })).toBeChecked();
  await expect(page.locator('#rail-selector')).not.toContainText('Adjust carriage travel');
  await expect(page.locator('#tool-summary')).toHaveText('6-Axis F/T Sensor + BIO Gripper G2');
  await expect(page.locator('#assets')).toContainText('Direct-Drive Linear Motor');
  await expect(page.locator('#assets')).toContainText('6-Axis F/T Sensor');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  // 4. Direct standalone sensor link and incompatible query sanitization
  await page.goto('/?model=ai1500');
  await ready(page);
  await expect(page.locator('#stage')).toHaveAttribute('data-mode', 'sensor');
  await returnToAssembly(page);
  await ready(page);
  await expect(page.locator('#robot-select')).toHaveValue('xarm6');
  await expect(page.locator('#rail-toggle')).not.toBeChecked();

  await page.goto('/?model=uf850&rail=al0700&railPos=200&sensor=ai1500');
  await ready(page);
  await expect(page.locator('#stage')).toHaveAttribute('data-robot', 'uf850');
  await expect(page.locator('#stage')).not.toHaveAttribute('data-rail');
  await expect(page.locator('#rail-selector')).toBeHidden();
  await expect(page.locator('#stage')).toHaveAttribute('data-sensor', 'ai1500');
  expect(page.url()).not.toContain('rail=');
  expect(page.url()).toContain('sensor=ai1500');

  await context.close();
});
