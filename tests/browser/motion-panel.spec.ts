import { expect, test, type Page } from '@playwright/test';
import { selectRail, selectRobot, viewStandalone } from './selection-panels';

async function ready(page: Page) {
  await expect(page.locator('#stage')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
}

async function stageSize(page: Page) {
  return page.locator('#stage').evaluate(el => ({ width: el.clientWidth, height: el.clientHeight }));
}

async function expectModelRow(page: Page, standalone: boolean) {
  const brand = (await page.locator('.site-header .brand').boundingBox())!;
  const language = (await page.locator('#language').boundingBox())!;
  const select = (await page.locator('#robot-select').boundingBox())!;
  expect(select.x).toBeGreaterThanOrEqual(brand.x + brand.width);
  expect(select.x + select.width).toBeLessThanOrEqual(language.x);
  expect(Math.abs(brand.y + brand.height / 2 - (select.y + select.height / 2))).toBeLessThan(2);
  expect(Math.abs(language.y + language.height / 2 - (select.y + select.height / 2))).toBeLessThan(2);
  await expect(page.locator('.site-header #robot-select')).toHaveCount(1);
  if (page.viewportSize()!.width > 600) {
    const label = (await page.locator('.robot-models-label').boundingBox())!;
    expect(select.x).toBeGreaterThanOrEqual(label.x + label.width);
    expect(Math.abs(label.y + label.height / 2 - (select.y + select.height / 2))).toBeLessThan(2);
  }
  if (standalone) {
    const hint = (await page.locator('#standalone-hint').boundingBox())!;
    expect(hint.y).toBeGreaterThanOrEqual(select.y + select.height);
  } else {
    await expect(page.locator('#standalone-hint')).toBeHidden();
  }
}

async function expectStageOverlays(page: Page, standalone: boolean) {
  const stage = (await page.locator('#stage').boundingBox())!;
  const actions = (await page.locator('.stage-actions').boundingBox())!;
  expect(actions.x + actions.width).toBeLessThanOrEqual(stage.x + stage.width);
  expect(actions.x + actions.width).toBeGreaterThan(stage.x + stage.width / 2);
  expect(actions.y).toBeGreaterThan(stage.y + stage.height / 2);
  expect(actions.y + actions.height).toBeLessThanOrEqual(stage.y + stage.height);
  await expect(page.locator('#view-reset')).toBeVisible();
  if (!standalone) {
    const telemetry = (await page.locator('#stage-telemetry').boundingBox())!;
    expect(telemetry.x + telemetry.width).toBeLessThanOrEqual(stage.x + stage.width);
    expect(telemetry.x + telemetry.width).toBeGreaterThan(stage.x + stage.width / 2);
    expect(telemetry.y).toBeLessThan(stage.y + stage.height / 2);
    expect(telemetry.y).toBeGreaterThanOrEqual(stage.y);
    for (const selector of ['#toggle-base-frame', '#toggle-tcp-frame']) {
      await expect(page.locator(selector)).toBeVisible();
    }
    expect(await page.locator('#stage-telemetry output').evaluateAll(outputs =>
      outputs.every(output => output.scrollWidth <= output.clientWidth))).toBe(true);
  } else {
    await expect(page.locator('#stage-telemetry')).toBeHidden();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('header selector and stage overlays fit across desktop, tablet and mobile widths', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/?model=xarm7&rail=al0700&railPos=350');
  await ready(page);
  await expect(page.getByRole('heading', { level: 1, name: 'xArm 7' })).toHaveCount(1);
  await expect(page.locator('#stage-heading')).toHaveCSS('clip-path', 'inset(50%)');
  await expect(page.locator('.stage-title, .stage-help, #stage-product-links, .control-head, #reset-pose')).toHaveCount(0);
  await expect(page.locator('#status-text')).toBeEmpty();
  await expect(page.locator('#solver-status')).not.toHaveClass(/has-message/);
  await expect(page.locator('.jog-speed-box')).toHaveText('20%');
  await expect(page.getByRole('slider', { name: '速度', exact: true })).toHaveValue('20');
  await expect(page.locator('#jog-speed')).toHaveAttribute('min', '1');
  await expect(page.locator('#jog-speed')).toHaveAttribute('max', '100');

  for (const language of ['zh', 'en'] as const) {
    if (language === 'en') await page.locator('#language').click();
    await expect(page.locator('#robot-select')).toHaveAccessibleName(language === 'zh' ? '机械臂' : 'Robot arm');
    await expect(page.locator('#jog-speed')).toHaveAccessibleName(language === 'zh' ? '速度' : 'Speed');
    for (const width of [1440, 800, 601, 600, 521, 375, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await expectModelRow(page, false);
      await expectStageOverlays(page, false);
    }
  }

  await viewStandalone(page, 'gripper-g2');
  await ready(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Gripper G2' })).toHaveCount(1);
  for (const language of ['en', 'zh'] as const) {
    if (language === 'zh') await page.locator('#language').click();
    await expect(page.locator('#robot-select')).toHaveAccessibleDescription(language === 'zh' ? /独立查看/ : /Viewing an end effector/);
    for (const width of [1440, 800, 601, 600, 521, 375, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await expectModelRow(page, true);
      await expectStageOverlays(page, true);
    }
  }
});

test('solver and input feedback remains visible and translated without a ready message', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await expect(page.locator('#status-text')).toBeEmpty();
  await page.locator('#joint-tab').click();
  await page.locator('#joint-number-0').fill('-360');
  await page.locator('#joint-number-0').dispatchEvent('change');
  await expect(page.locator('#stage-joint-0')).toHaveText('-360.00');
  await page.locator('#cartesian-tab').click();
  const before = await page.locator('#stage-joint-fields output').allTextContents();
  await page.locator('[data-jog-axis="roll"][data-jog-dir="-1"]').click();
  await expect(page.locator('#solver-status')).toBeVisible();
  await expect(page.locator('#status-text')).toHaveText('无法收敛到目标；已保留上一次有效姿态。');
  expect(await page.locator('#stage-joint-fields output').allTextContents()).toEqual(before);
  await page.locator('#language').click();
  await expect(page.locator('#status-text')).toHaveText('Could not reach the target; the last valid pose is preserved.');

  await page.locator('#joint-tab').click();
  await page.locator('#joint-number-0').fill('0');
  await page.locator('#joint-number-0').dispatchEvent('change');
  await expect(page.locator('#status-text')).toBeEmpty();
  await page.locator('#cartesian-tab').click();
  await page.locator('[data-jog-axis="z"][data-jog-dir="1"]').click();
  await expect(page.locator('#status-text')).toHaveText('Target solved');
  await page.locator('#language').click();
  await expect(page.locator('#status-text')).toHaveText('目标已求解');

  await viewStandalone(page, 'gripper-g2');
  await ready(page);
  await expect(page.locator('#status-text')).toBeEmpty();
  await page.locator('#opening-number').fill('999');
  await page.locator('#opening-number').dispatchEvent('change');
  await expect(page.locator('#solver-status')).toBeVisible();
  await expect(page.locator('#status-text')).toHaveText('请输入有效且在范围内的数值。');
  await page.locator('#language').click();
  await expect(page.locator('#status-text')).toHaveText('Enter a valid value within the allowed range.');
  await page.locator('#opening-number').fill('42');
  await page.locator('#opening-number').dispatchEvent('change');
  await expect(page.locator('#status-text')).toBeEmpty();
});

test('fixed stage puts motion first and the rail switch last', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await ready(page);
  await expect(page.locator('#control-toggle, #control-expand, #rail-tab, #tool-trigger')).toHaveCount(0);
  await expect(page.locator('#robot-select')).toHaveValue('xarm6');
  await expect(page.locator('#robot-select option:not([value="standalone"])')).toHaveText(['xArm 5', 'xArm 6', 'xArm 7', '850', 'Lite 6']);
  for (const selector of ['#control-card', '#rail-selector', '#tool-menu']) {
    await expect(page.locator(selector)).toBeVisible();
  }
  await expect(page.locator('#rail-panel')).toBeHidden();

  for (const width of [1440, 800, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const original = await stageSize(page);
    const motion = (await page.locator('#motion-panel').boundingBox())!;
    const rail = (await page.locator('#rail-selector').boundingBox())!;
    const tool = (await page.locator('#tool-dropdown').boundingBox())!;
    expect(tool.y).toBeGreaterThanOrEqual(motion.y + motion.height);
    expect(rail.y).toBeGreaterThanOrEqual(tool.y + tool.height);
    if (width <= 900) {
      const stage = (await page.locator('#stage').boundingBox())!;
      expect(motion.y).toBeGreaterThanOrEqual(stage.y + stage.height);
    } else {
      await page.evaluate(() => window.scrollTo({ top: 160, behavior: 'instant' }));
      await expect.poll(async () => (await page.locator('#stage').boundingBox())!.y).toBeCloseTo(16, 0);
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#joint-tab').click();
    expect(await stageSize(page)).toEqual(original);
    await page.locator('#cartesian-tab').click();
    await selectRobot(page, 'xarm5');
    await ready(page);
    expect(await stageSize(page)).toEqual(original);
    await selectRobot(page, 'xarm6');
    await ready(page);
    expect(await stageSize(page)).toEqual(original);
  }

  const original = await stageSize(page);
  await selectRail(page, 'al0700');
  await ready(page);
  expect(await stageSize(page)).toEqual(original);
  await page.locator('#tool-sensor-check').check();
  await ready(page);
  expect(await stageSize(page)).toEqual(original);
  await viewStandalone(page, 'ai1500');
  await ready(page);
  expect(await stageSize(page)).toEqual(original);
  await selectRobot(page, 'xarm6');
  await ready(page);
  expect(await stageSize(page)).toEqual(original);
  await expect(page.locator('#rail-panel')).toBeVisible();
  await expect(page.locator('#tool-menu')).toBeVisible();
});

test('model dropdown works with keyboard and exposes standalone state in both languages', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const select = page.getByRole('combobox', { name: '机械臂', exact: true });
  await expect(select).toHaveValue('xarm6');
  await select.focus();
  await page.keyboard.press('ArrowDown');
  await ready(page);
  await expect(select).toHaveValue('xarm7');
  await expect(page.locator('#stage')).toHaveAttribute('data-robot', 'xarm7');
  expect(new URL(page.url()).searchParams.get('model')).toBe('xarm7');

  await viewStandalone(page, 'gripper-g2');
  await ready(page);
  await expect(select).toHaveValue('standalone');
  await expect(select).toHaveAccessibleDescription(/独立查看/);
  await page.locator('#language').click();
  const englishSelect = page.getByRole('combobox', { name: 'Robot arm', exact: true });
  await expect(englishSelect).toHaveValue('standalone');
  await expect(englishSelect).toHaveAccessibleDescription(/Viewing an end effector/);
  await expect(page.locator('#control-card')).toHaveAccessibleName('Motion controls');
  await englishSelect.selectOption('xarm7');
  await ready(page);
  await expect(englishSelect).toHaveValue('xarm7');
  await expect(page.locator('#stage')).toHaveAttribute('data-robot', 'xarm7');
  await expect(page.locator('#control-card')).toHaveAccessibleName('Motion controls');
});

test('dropdown selection restores standalone assembly and filters incompatible accessories', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/?model=xarm7&rail=al0700&railPos=280.5&sensor=ai1500&gripper=bio-gripper-g2&opening=110.0#controls');
  await ready(page);
  await viewStandalone(page, 'bio-gripper-g2');
  await ready(page);
  await expect(page.locator('#robot-select')).toHaveValue('standalone');
  await expect(page.locator('#robot-select')).toHaveAccessibleDescription(/独立查看/);
  await page.locator('#opening-number').fill('130');
  await page.locator('#opening-number').dispatchEvent('change');
  await selectRobot(page, 'xarm7');
  await ready(page);
  await expect(page.locator('#control-card')).toBeVisible();
  await expect(page.locator('#tool-menu')).toBeVisible();
  await expect(page.locator('#stage')).toHaveAttribute('data-robot', 'xarm7');
  await expect(page.locator('#stage')).toHaveAttribute('data-rail', 'al0700');
  await expect(page.locator('#stage')).toHaveAttribute('data-sensor', 'ai1500');
  await expect(page.locator('#stage')).toHaveAttribute('data-gripper', 'bio-gripper-g2');
  await expect(page.locator('#stage-rail-pos')).toHaveText('280.5');
  await expect(page.locator('#opening-number')).toHaveValue('110.0');
  let url = new URL(page.url());
  expect(url.hash).toBe('#controls');
  expect(url.searchParams.get('model')).toBe('xarm7');
  expect(url.searchParams.get('railPos')).toBe('280.5');
  expect(url.searchParams.get('opening')).toBe('110.0');

  await selectRobot(page, 'uf850');
  await ready(page);
  await expect(page.locator('#stage')).not.toHaveAttribute('data-rail');
  await expect(page.locator('#stage')).toHaveAttribute('data-sensor', 'ai1500');
  await expect(page.locator('#stage')).toHaveAttribute('data-gripper', 'bio-gripper-g2');
  await expect(page.locator('#rail-toggle')).toBeDisabled();
  await expect(page.locator('#rail-selector')).toBeHidden();
  url = new URL(page.url());
  expect(url.searchParams.has('rail')).toBe(false);
  expect(url.searchParams.get('sensor')).toBe('ai1500');
  expect(url.searchParams.get('gripper')).toBe('bio-gripper-g2');

  await selectRobot(page, 'lite6');
  await ready(page);
  await expect(page.locator('#stage')).not.toHaveAttribute('data-sensor');
  await expect(page.locator('#stage')).not.toHaveAttribute('data-gripper');
  await expect(page.locator('#rail-toggle')).toBeDisabled();
  await expect(page.locator('#rail-selector')).toBeHidden();
  await expect(page.locator('#tool-sensor-check')).toBeDisabled();
  await expect(page.locator('#tool-sensor-group')).toBeHidden();
  await expect(page.locator('[data-standalone-view="ai1500"]')).toBeHidden();
  await expect(page.locator('#tool-gripper-bio-gripper-g2')).toBeDisabled();
  url = new URL(page.url());
  expect(url.searchParams.get('model')).toBe('lite6');
  expect(url.searchParams.has('sensor')).toBe(false);
  expect(url.searchParams.has('gripper')).toBe(false);
  expect(url.searchParams.has('opening')).toBe(false);
  expect(url.hash).toBe('#controls');
});
