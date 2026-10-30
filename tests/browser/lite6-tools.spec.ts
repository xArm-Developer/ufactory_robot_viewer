import { devices, expect, test, type Page } from '@playwright/test';
import fixtures from '../mujoco-lite6-tool-fk.json' with { type: 'json' };
import { returnToAssembly, selectRobot, viewStandalone } from './selection-panels';

const gripper = 'lite6-gripper';
const vacuum = 'lite6-vacuum-gripper';

async function ready(page: Page) {
  await expect(page.locator('#stage')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
}

async function selectTool(page: Page, id: string) {
  await page.locator(`#tool-gripper-${id}`).check();
  await ready(page);
}

test('Lite 6 shows its two tools, mounts them at the reference TCP, and clears incompatible selections', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?model=lite6');
  await ready(page);
  for (const id of [gripper, vacuum]) await expect(page.locator(`#tool-gripper-${id}`)).toBeVisible();
  for (const id of ['gripper-g2', 'bio-gripper-g2']) await expect(page.locator(`#tool-gripper-${id}`)).toBeHidden();
  await expect(page.locator('#tool-sensor-check')).toBeDisabled();
  await expect(page.locator('#tool-sensor-group')).toBeHidden();
  await expect(page.locator('[data-standalone-view="ai1500"]')).toBeHidden();

  await selectTool(page, gripper);
  await expect(page.locator('#stage')).toHaveAttribute('data-gripper', gripper);
  await expect(page.locator('#tool-summary')).toHaveText('Gripper Lite');
  const toggle = page.getByRole('switch', { name: '夹爪开合' });
  await expect(toggle).toBeChecked();
  await expect(page.locator('#opening-switch-state')).toHaveText('张开');
  await expect(page.locator('#opening-number')).toBeHidden();
  await expect(page.locator('#opening-range')).toBeHidden();
  await expect(page.locator('#gripper-intro')).toContainText('气动');
  await expect(page.locator('#assets a')).toHaveCount(2);
  await expect(page.locator('#assets a').nth(1)).toHaveAttribute('href', /5\.End-Effector\.html#_5-1-gripper-lite/);
  for (let i = 0; i < 3; i++) {
    expect(Number(await page.locator(`#fk-${i}`).innerText())).toBeCloseTo(fixtures.tools.gripper[0].position[i] * 1000, 1);
  }
  const tcp = await page.locator('#fk-fields').innerText();
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).not.toBeChecked();
  await expect(toggle).toHaveAccessibleDescription('闭合');
  await expect(page.locator('#opening-switch-state')).toHaveText('闭合');
  expect(await page.locator('#fk-fields').innerText()).toBe(tcp);
  expect(new URL(page.url()).searchParams.get('opening')).toBe('0.0');
  await page.reload();
  await ready(page);
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(page.locator('#opening-switch-state')).toHaveText('张开');
  expect(new URL(page.url()).searchParams.get('opening')).toBe('100.0');
  expect(await page.locator('#fk-fields').innerText()).toBe(tcp);
  await page.locator('#joint-tab').click();
  await page.locator('#joint-number-0').fill('20');
  await page.locator('#joint-number-0').dispatchEvent('change');

  await selectTool(page, vacuum);
  await expect(page.locator('#stage')).toHaveAttribute('data-gripper', vacuum);
  await expect(page.locator('#stage-joint-0')).toHaveText('20.00');
  await expect(page.locator('#gripper-control')).toBeHidden();
  await expect(page.locator('#assets a').nth(1)).toHaveAttribute('href', /#_5-2-vacuum-gripper-lite/);
  expect(new URL(page.url()).searchParams.has('opening')).toBe(false);
  await page.reload();
  await ready(page);
  for (let i = 0; i < 3; i++) {
    expect(Number(await page.locator(`#fk-${i}`).innerText())).toBeCloseTo(fixtures.tools.vacuum[0].position[i] * 1000, 1);
  }
  await selectRobot(page, 'xarm6');
  await ready(page);
  await expect(page.locator('#stage')).not.toHaveAttribute('data-gripper');
  await expect(page.locator(`#tool-gripper-${vacuum}`)).toBeHidden();
  await expect(page.locator('#tool-gripper-gripper-g2')).toBeVisible();
  expect(new URL(page.url()).searchParams.has('gripper')).toBe(false);
  await selectTool(page, 'gripper-g2');
  await expect(page.locator('#opening-number')).toBeVisible();
  await expect(page.locator('#opening-number')).toHaveValue('84.0');
  await expect(page.locator('#opening-switch')).toBeHidden();
  expect(errors).toEqual([]);
});

test('standalone views preserve the Lite 6 assembly and direct links validate tool compatibility', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/?model=lite6&gripper=lite6-gripper&opening=0');
  await ready(page);
  await viewStandalone(page, gripper);
  await ready(page);
  await expect(page.locator('#opening-switch')).not.toBeChecked();
  await page.locator('#opening-switch').check();
  await viewStandalone(page, vacuum);
  await ready(page);
  await expect(page.locator('#gripper-control')).toBeHidden();
  expect(new URL(page.url()).searchParams.has('opening')).toBe(false);
  await returnToAssembly(page);
  await ready(page);
  await expect(page.locator('#stage')).toHaveAttribute('data-gripper', gripper);
  await expect(page.locator('#opening-switch')).not.toBeChecked();
  expect(new URL(page.url()).searchParams.get('opening')).toBe('0.0');

  for (const url of [
    '/?model=lite6&gripper=lite6-gripper&opening=50',
    '/?model=lite6-gripper&opening=30',
  ]) {
    await page.goto(url);
    await ready(page);
    await expect(page.locator('#opening-switch')).toBeChecked();
    expect(new URL(page.url()).searchParams.get('opening')).toBe('100.0');
  }
  await page.goto('/?model=lite6-gripper&opening=0');
  await ready(page);
  await expect(page.locator('#opening-switch')).not.toBeChecked();
  await page.reload();
  await ready(page);
  await expect(page.locator('#opening-switch')).not.toBeChecked();

  for (const url of [
    '/?model=lite6&gripper=gripper-g2&opening=42',
    '/?model=xarm6&gripper=lite6-gripper&opening=42',
  ]) {
    await page.goto(url);
    await ready(page);
    expect(new URL(page.url()).searchParams.has('gripper')).toBe(false);
    expect(new URL(page.url()).searchParams.has('opening')).toBe(false);
  }
  await page.goto('/?model=lite6&gripper=lite6-vacuum-gripper&opening=42');
  await ready(page);
  expect(new URL(page.url()).searchParams.get('gripper')).toBe(vacuum);
  expect(new URL(page.url()).searchParams.has('opening')).toBe(false);
  await expect(page.locator('#gripper-control')).toBeHidden();

  for (const id of [gripper, vacuum]) {
    await page.goto(`/?model=${id}`);
    await ready(page);
    await expect(page.locator('#stage')).toHaveAttribute('data-mode', 'gripper');
    await expect(page.locator('#stage')).toHaveAttribute('data-gripper', id);
    if (id === gripper) await expect(page.locator('#opening-switch')).toBeChecked();
    else await expect(page.locator('#gripper-control')).toBeHidden();
    await returnToAssembly(page);
    await ready(page);
    await expect(page.locator('#stage')).toHaveAttribute('data-robot', 'xarm6');
  }
});

test('switching tools discards an unfinished Lite finger load', async ({ page }) => {
  test.setTimeout(120_000);
  let release!: () => void;
  let requested!: () => void;
  let aborted!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const intercepted = new Promise<void>(resolve => { requested = resolve; });
  const abortedRequest = new Promise<void>(resolve => { aborted = resolve; });
  await page.route('**/models/lite6-gripper/finger1.stl', async route => {
    requested();
    await gate;
    await route.abort();
    aborted();
  });
  await page.goto('/?model=lite6');
  await ready(page);
  await page.locator(`#tool-gripper-${gripper}`).check();
  await intercepted;
  await expect(page.locator('#opening-switch')).toBeDisabled();
  await selectTool(page, vacuum);
  release();
  await abortedRequest;
  await page.waitForTimeout(200);
  await expect(page.locator('#stage')).toHaveAttribute('data-gripper', vacuum);
  await expect(page.locator('#load-message')).toBeHidden();
  await expect(page.locator('#assets a')).toHaveCount(2);
});

test('Lite finger loading failure is retryable and mobile English controls remain usable', async ({ browser }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 320, height: 700 } });
  const page = await context.newPage();
  let attempts = 0;
  await page.route('**/models/lite6-gripper/finger1.stl', route => ++attempts === 1 ? route.abort() : route.continue());
  await page.goto('/?model=lite6&gripper=lite6-gripper');
  await expect(page.locator('#load-message')).toContainText('模型加载失败', { timeout: 60_000 });
  await page.locator('#retry').click();
  await ready(page);
  expect(attempts).toBe(2);
  await page.locator('#language').click();
  const toggle = page.getByRole('switch', { name: 'Gripper opening' });
  await expect(toggle).toBeChecked();
  await expect(page.locator('#opening-switch-state')).toHaveText('Open');
  await expect(page.locator('#gripper-intro')).toContainText('pneumatic');
  await toggle.uncheck();
  await expect(page.locator('#opening-switch-state')).toHaveText('Closed');
  await expect(toggle).toHaveAccessibleDescription('Closed');
  await expect(page.getByRole('checkbox', { name: '6-Axis F/T Sensor' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '6-Axis F/T Sensor' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await selectTool(page, vacuum);
  await expect(page.locator('#gripper-control')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await context.close();
});

test('sensor options follow arm compatibility through links, standalone views, and arm changes', async ({ page }) => {
  test.setTimeout(180_000);
  const sensorGroup = page.locator('#tool-sensor-group');
  const sensorCheck = page.locator('#tool-sensor-check');
  const sensorView = page.locator('[data-standalone-view="ai1500"]');

  await page.goto('/?model=lite6&sensor=ai1500');
  await ready(page);
  await expect(sensorGroup).toBeHidden();
  await expect(sensorView).toBeHidden();
  await expect(page.getByRole('checkbox', { name: '六维力矩传感器' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '六维力矩传感器' })).toHaveCount(0);
  await expect(page.locator('#tool-menu .tool-group').nth(1)).toHaveCSS('border-top-width', '0px');
  expect(new URL(page.url()).searchParams.has('sensor')).toBe(false);

  await viewStandalone(page, gripper);
  await ready(page);
  await expect(sensorGroup).toBeHidden();
  await expect(sensorView).toBeHidden();
  await expect(page.locator('#tool-dropdown')).toHaveAccessibleDescription(/独立查看/);
  await returnToAssembly(page);
  await ready(page);
  await expect(sensorGroup).toBeHidden();

  for (const id of ['xarm5', 'xarm6', 'xarm7', 'uf850']) {
    await selectRobot(page, id);
    await ready(page);
    await expect(sensorGroup).toBeVisible();
    await expect(sensorCheck).toBeEnabled();
    await expect(sensorView).toBeVisible();
  }
  await sensorCheck.check();
  await ready(page);
  await expect(page.locator('#stage')).toHaveAttribute('data-sensor', 'ai1500');
  await selectRobot(page, 'lite6');
  await ready(page);
  await expect(sensorGroup).toBeHidden();
  await expect(sensorView).toBeHidden();
  await expect(page.locator('#stage')).not.toHaveAttribute('data-sensor');
  expect(new URL(page.url()).searchParams.has('sensor')).toBe(false);
  await selectRobot(page, 'xarm6');
  await ready(page);
  await expect(sensorGroup).toBeVisible();
  await expect(sensorCheck).not.toBeChecked();
  await expect(sensorView).toBeVisible();
});
