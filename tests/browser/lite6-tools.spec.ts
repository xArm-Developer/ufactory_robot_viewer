import { devices, expect, test, type Page } from '@playwright/test';
import fixtures from '../mujoco-lite6-tool-fk.json' with { type: 'json' };
import { clearSavedScene, jogJointTo, selectGripper, selectRobot } from './selection-panels';

const gripper = 'lite6-gripper';
const vacuum = 'lite6-vacuum-gripper';

async function ready(page: Page) {
  await expect(page.locator('#stage')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
}

async function selectTool(page: Page, id: string) {
  await selectGripper(page, id);
  await ready(page);
}

test('Lite 6 shows its two tools, mounts them at the reference TCP, and clears incompatible selections', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?model=lite6');
  await ready(page);
  await expect(page.locator('#tool-gripper-select option')).toHaveText(['无夹爪', 'Gripper Lite', 'Vacuum Gripper Lite']);
  await expect(page.locator('#tool-sensor-check')).toBeDisabled();
  await expect(page.locator('#tool-sensor-group')).toBeHidden();
  await expect(page.locator('[data-standalone-view]')).toHaveCount(0);

  await selectTool(page, gripper);
  await expect(page.locator('#stage')).toHaveAttribute('data-gripper', gripper);
  await expect(page.locator('#tool-gripper-select')).toHaveValue(gripper);
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
  await jogJointTo(page, 0, 20);

  await selectTool(page, vacuum);
  await expect(page.locator('#stage')).toHaveAttribute('data-gripper', vacuum);
  await expect(page.locator('#stage-joint-0')).toHaveText('20.00');
  await expect(page.locator('#gripper-control')).toBeHidden();
  await expect(page.locator('#assets a').nth(1)).toHaveAttribute('href', /#_5-2-vacuum-gripper-lite/);
  expect(new URL(page.url()).searchParams.has('opening')).toBe(false);
  const vacuumTcp = await page.locator('#fk-fields').innerText();
  await page.reload();
  await ready(page);
  expect(await page.locator('#fk-fields').innerText()).toBe(vacuumTcp);
  await expect(page.locator('#stage-joint-0')).toHaveText('20.00');
  await selectRobot(page, 'xarm6');
  await ready(page);
  await expect(page.locator('#stage')).not.toHaveAttribute('data-gripper');
  await expect(page.locator('#tool-gripper-select option')).toHaveText(['无夹爪', 'Gripper G2', 'BIO Gripper G2']);
  await expect(page.locator('#tool-gripper-select')).toHaveValue('');
  expect(new URL(page.url()).searchParams.has('gripper')).toBe(false);
  await selectTool(page, 'gripper-g2');
  await expect(page.locator('#opening-number')).toBeVisible();
  await expect(page.locator('#opening-number')).toHaveValue('84.0');
  await expect(page.locator('#opening-switch')).toBeHidden();
  expect(errors).toEqual([]);
});

test('legacy Lite tool links convert to assemblies and validate openings', async ({ page }) => {
  for (const [id, opening, expected] of [
    [gripper, '0', '0.0'], [gripper, '30', '100.0'], [vacuum, '42', null],
  ] as const) {
    await clearSavedScene(page);
    await page.goto(`/?model=${id}&opening=${opening}&rail=al0700&railPos=300&sensor=ai1500&gripper=gripper-g2#controls`);
    await ready(page);
    await expect(page.locator('#stage')).toHaveAttribute('data-robot', 'lite6');
    await expect(page.locator('#stage')).toHaveAttribute('data-gripper', id);
    const url = new URL(page.url());
    expect(url.searchParams.get('model')).toBe('lite6');
    expect(url.searchParams.get('gripper')).toBe(id);
    expect(url.searchParams.get('opening')).toBe(expected);
    expect(url.searchParams.has('rail')).toBe(false);
    expect(url.searchParams.has('railPos')).toBe(false);
    expect(url.searchParams.has('sensor')).toBe(false);
    expect(url.hash).toBe('#controls');
    if (id === gripper) await expect(page.locator('#opening-switch')).toHaveJSProperty('checked', expected === '100.0');
    else await expect(page.locator('#gripper-control')).toBeHidden();
    await page.reload();
    await ready(page);
    await expect(page.locator('#stage')).toHaveAttribute('data-gripper', id);
  }
  await clearSavedScene(page);
  await page.goto('/?model=lite6&gripper=gripper-g2&opening=42');
  await ready(page);
  expect(new URL(page.url()).searchParams.has('gripper')).toBe(false);
  expect(new URL(page.url()).searchParams.has('opening')).toBe(false);
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
  await selectGripper(page, gripper);
  await intercepted;
  await expect(page.locator('#tool-gripper-select')).toHaveValue(gripper);
  await expect(page.locator('#tool-gripper-select')).toBeEnabled();
  await expect(page.locator('#opening-switch')).toBeDisabled();
  await selectTool(page, vacuum);
  release();
  await abortedRequest;
  await page.waitForTimeout(200);
  await expect(page.locator('#stage')).toHaveAttribute('data-gripper', vacuum);
  await expect(page.locator('#tool-gripper-select')).toHaveValue(vacuum);
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
  await expect(page.getByRole('combobox', { name: 'End effector' })).toHaveValue(gripper);
  await expect(page.locator('#tool-gripper-select option')).toHaveText(['No gripper', 'Gripper Lite', 'Vacuum Gripper Lite']);
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

test('sensor options follow arm compatibility through links and arm changes', async ({ page }) => {
  await page.goto('/?model=lite6&sensor=ai1500');
  await ready(page);
  await expect(page.locator('#tool-sensor-group')).toBeHidden();
  await expect(page.locator('[data-standalone-view]')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has('sensor')).toBe(false);
  for (const id of ['xarm5', 'xarm6', 'xarm7', 'uf850']) {
    await selectRobot(page, id);
    await ready(page);
    await expect(page.locator('#tool-sensor-group')).toBeVisible();
    await expect(page.locator('#tool-sensor-check')).toBeEnabled();
  }
  await page.locator('#tool-sensor-check').check();
  await ready(page);
  await expect(page.locator('#stage')).toHaveAttribute('data-sensor', 'ai1500');
  await selectRobot(page, 'lite6');
  await ready(page);
  await expect(page.locator('#tool-sensor-group')).toBeHidden();
  await expect(page.locator('#stage')).not.toHaveAttribute('data-sensor');
  await selectRobot(page, 'xarm6');
  await ready(page);
  await expect(page.locator('#tool-sensor-check')).not.toBeChecked();
});
