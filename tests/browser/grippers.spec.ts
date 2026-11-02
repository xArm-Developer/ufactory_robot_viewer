import { devices, expect, test, type Page } from '@playwright/test';
import { clearSavedScene, jogJointTo, selectGripper, selectRobot } from './selection-panels';

const g2 = { id: 'gripper-g2', name: 'Gripper G2', min: 0, max: 84, url: 'https://www.shop.ufactory.cc/products/gripper-g2' };
const bio = { id: 'bio-gripper-g2', name: 'BIO Gripper G2', min: 71, max: 150, url: 'https://www.shop.ufactory.cc/products/bio-gripper-g2' };

async function ready(page: Page) {
  await expect(page.locator('#stage')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
}

async function setOpening(page: Page, value: string) {
  await page.locator('#opening-number').fill(value);
  await page.locator('#opening-number').dispatchEvent('change');
}

test('assembled grippers load on demand, open and close, and retain valid direct-link state', async ({ page }) => {
  test.setTimeout(180_000);
  const loaded: string[] = [];
  page.on('response', response => { if (response.url().endsWith('.glb') && response.ok()) loaded.push(response.url()); });
  await page.goto('/');
  await ready(page);
  expect(loaded.every(url => !url.includes('gripper'))).toBe(true);
  await expect(page.getByRole('combobox', { name: '末端执行器' })).toHaveValue('');
  await expect(page.locator('#tool-dropdown .selector-heading')).toHaveText('末端工具');
  await expect(page.locator('#tool-gripper-select option')).toHaveText(['无夹爪', 'Gripper G2', 'BIO Gripper G2']);
  const gripperLabelBox = (await page.locator('label[for="tool-gripper-select"]').boundingBox())!;
  const gripperSelectBox = (await page.locator('#tool-gripper-select').boundingBox())!;
  expect(gripperSelectBox.x).toBeGreaterThanOrEqual(gripperLabelBox.x + gripperLabelBox.width + 8);
  expect(gripperSelectBox.width).toBeLessThanOrEqual(180);
  expect(Math.abs((gripperSelectBox.y + gripperSelectBox.height / 2) - (gripperLabelBox.y + gripperLabelBox.height / 2))).toBeLessThanOrEqual(2);

  for (const spec of [g2, bio]) {
    await selectGripper(page, spec.id);
    await ready(page);
    await expect(page.locator('#stage')).not.toHaveAttribute('data-mode');
    await expect(page.locator('#stage-heading')).toHaveText('xArm 6');
    await expect(page.locator('#stage-telemetry')).toBeVisible();
    await expect(page.locator('#arm-controls')).toBeVisible();
    await expect(page.locator('#robot-select')).toHaveValue('xarm6');
    await expect(page.locator('#tool-dropdown .selector-heading')).toHaveText('末端工具');
    await expect(page.locator('#tool-gripper-select')).toHaveValue(spec.id);
    await expect(page.locator('#toggle-tcp-frame')).toBeVisible();
    await expect(page.getByRole('spinbutton', { name: '开口间距' })).toHaveValue(`${spec.max}.0`);
    await expect(page.getByRole('slider', { name: '开口间距' })).toBeVisible();
    const sliderBox = (await page.locator('#opening-range').boundingBox())!;
    const numberBox = (await page.locator('#opening-number').boundingBox())!;
    expect(numberBox.x).toBeGreaterThan(sliderBox.x + sliderBox.width);
    expect(Math.abs(numberBox.y - sliderBox.y)).toBeLessThan(18);
    await expect(page.locator('#opening-range')).toHaveAttribute('min', String(spec.min));
    await expect(page.locator('#opening-range')).toHaveAttribute('max', String(spec.max));
    await expect(page.locator('#opening-continuous .range-labels')).toHaveCount(0);
    await expect(page.locator('#gripper-intro')).toBeHidden();
    await expect(page.locator('#gripper-name, .gripper-heading')).toHaveCount(0);
    await expect(page.locator('#assets a')).toHaveCount(2);
    await expect(page.locator('#assets a').nth(1)).toHaveAttribute('href', spec.url);
    // Changing the opening should not recreate or repeatedly announce the unchanged inventory.
    await page.locator('#assets li').first().evaluate(element => { (element as HTMLElement).dataset.preserved = 'yes'; });
    const canvas = page.locator('#canvas-area canvas');
    const openImage = await canvas.screenshot();
    await setOpening(page, String(spec.min));
    await expect(page.locator('#opening-number')).toHaveValue(`${spec.min}.0`);
    await expect(page.locator('#assets li').first()).toHaveAttribute('data-preserved', 'yes');
    await page.waitForTimeout(100);
    expect((await canvas.screenshot()).equals(openImage)).toBe(false);
    expect(page.url()).toContain(`opening=${spec.min}.0`);
    await setOpening(page, String(spec.min - 0.1));
    await expect(page.locator('#opening-number')).toHaveValue(`${spec.min}.0`);
    await expect(page.locator('#opening-number')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#opening-error')).toBeVisible();
    await expect(page.locator('#opening-error-text')).toHaveText('请输入有效且在范围内的数值。');
    await expect(page.locator('#status-text')).toBeEmpty();
    const openingPosition = await page.evaluate(() => {
      const stage = document.querySelector('#stage')!.getBoundingClientRect();
      const error = document.querySelector('#opening-error')!.getBoundingClientRect();
      return { center: Math.abs((error.left + error.right - stage.left - stage.right) / 2), top: error.top - stage.top };
    });
    expect(openingPosition.center).toBeLessThanOrEqual(2);
    expect(openingPosition.top).toBeGreaterThanOrEqual(0);
    expect(openingPosition.top).toBeLessThanOrEqual(75);
    await setOpening(page, '');
    await expect(page.locator('#opening-number')).toHaveValue(`${spec.min}.0`);
    await expect(page.locator('#opening-error')).toBeVisible();
    await setOpening(page, String(spec.min + 0.05));
    await expect(page.locator('#opening-number')).toHaveValue(`${spec.min}.0`);
    await expect(page.locator('#opening-error')).toBeVisible();
    const middleValue = (spec.min + spec.max) / 2;
    const middle = middleValue.toFixed(1);
    await page.locator('#opening-range').fill(String(middleValue));
    await expect(page.locator('#opening-number')).toHaveValue(middle);
    await expect(page.locator('#opening-error')).toBeHidden();
    await expect(page.locator('#opening-number')).not.toHaveAttribute('aria-invalid');
    expect(page.url()).toContain(`opening=${middle}`);
    await setOpening(page, String(spec.min));
    await page.reload();
    await ready(page);
    await expect(page.locator('#opening-number')).toHaveValue(`${spec.min}.0`);
  }
});

test('all eight assemblies retain opening and pose, show fixed TCP and official assets', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/');
  await ready(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.locator('#joint-tab').click();
  await jogJointTo(page, 0, 20);

  for (const id of ['xarm5', 'xarm6', 'xarm7', 'uf850']) {
    if (id !== 'xarm5') {
      // A compatible arm switch preserves the installed gripper and its opening.
      await selectRobot(page, id);
      await ready(page);
      await expect(page.locator('#tool-gripper-select')).toHaveValue(bio.id);
      await expect(page.locator('#opening-number')).toHaveValue('110.0');
    } else {
      await selectRobot(page, id);
      await ready(page);
    }
    await expect(page.locator('#tool-gripper-select option')).toHaveText(['无夹爪', 'Gripper G2', 'BIO Gripper G2']);
    await jogJointTo(page, 0, 20);
    for (const spec of [g2, bio] as const) {
      await selectGripper(page, spec.id);
      await ready(page);
      await expect(page.locator('#stage')).toHaveAttribute('data-gripper', spec.id);
      await expect(page.locator('#stage-joint-0')).toHaveText('20.00');
      await expect(page.locator('#assets a')).toHaveCount(2);
      await expect(page.locator('#assets a').nth(1)).toHaveAttribute('href', spec.url);
      const fixedTcp = await page.locator('#fk-fields').innerText();
      await setOpening(page, spec.id === bio.id ? '110' : '42');
      expect(await page.locator('#fk-fields').innerText()).toBe(fixedTcp);
      await expect(page.locator('#stage-joint-0')).toHaveText('20.00');
      await page.locator('#cartesian-tab').click();
      const z = Number(await page.locator('#fk-2').innerText());
      await page.locator('[data-jog-axis="z"][data-jog-dir="1"]').click();
      await expect(page.locator('#status-text')).toBeEmpty();
      expect(Number(await page.locator('#fk-2').innerText()) - z).toBeCloseTo(1, 1);
      await page.locator('#joint-tab').click();
      // Reload preserves the Cartesian result and recalculated TCP.
      const poseBeforeReload = await page.locator('#fk-fields').innerText();
      await page.reload();
      await ready(page);
      expect(await page.locator('#fk-fields').innerText()).toBe(poseBeforeReload);
      await page.locator('#joint-tab').click();
      await jogJointTo(page, 0, 20);
    }
  }
  const attachedTcp = await page.locator('#fk-fields').innerText();
  await selectGripper(page, '');
  await ready(page);
  await expect(page.locator('#stage')).not.toHaveAttribute('data-gripper');
  await expect(page.locator('#assets a')).toHaveCount(1);
  expect(await page.locator('#fk-fields').innerText()).not.toBe(attachedTcp);
  await selectGripper(page, 'bio-gripper-g2');
  await ready(page);
  await selectRobot(page, 'lite6');
  await ready(page);
  await expect(page.locator('#tool-gripper-select')).toHaveValue('');
  await expect(page.locator('#tool-dropdown')).toBeVisible();
  await expect(page.locator('#tool-sensor-group')).toBeHidden();
  await expect(page.locator('[data-standalone-view]')).toHaveCount(0);
  await expect(page.locator('#gripper-control')).toBeHidden();
  await expect(page.locator('#assets a')).toHaveCount(1);
  expect(page.url()).not.toContain('gripper=');
  expect(errors).toEqual([]);
});

test('legacy sensor and G2 links become assemblies and discard old assembly parameters', async ({ page }) => {
  for (const [id, opening] of [['ai1500', null], [g2.id, '42'], [bio.id, '110.1']] as const) {
    await clearSavedScene(page);
    await page.goto(`/?model=${id}&rail=al0700&railPos=250&sensor=other&gripper=lite6-gripper&opening=${opening ?? '23'}&extra=kept#controls`);
    await ready(page);
    await expect(page.locator('#stage')).not.toHaveAttribute('data-mode');
    await expect(page.locator('#stage')).toHaveAttribute('data-robot', 'xarm6');
    await expect(page.locator('#stage-telemetry')).toBeVisible();
    await expect(page.locator('#assets a')).toHaveCount(2);
    const url = new URL(page.url());
    expect(url.hash).toBe('#controls');
    expect(url.searchParams.get('extra')).toBe('kept');
    expect(url.searchParams.has('rail')).toBe(false);
    expect(url.searchParams.has('railPos')).toBe(false);
    if (id === 'ai1500') {
      expect(url.searchParams.get('sensor')).toBe('ai1500');
      expect(url.searchParams.has('gripper')).toBe(false);
      expect(url.searchParams.has('opening')).toBe(false);
    } else {
      expect(url.searchParams.has('sensor')).toBe(false);
      expect(url.searchParams.get('gripper')).toBe(id);
      expect(url.searchParams.get('opening')).toBe(Number(opening).toFixed(1));
      await expect(page.locator('#opening-number')).toHaveValue(Number(opening).toFixed(1));
    }
    await page.reload();
    await ready(page);
    await expect(page.locator('#stage')).toHaveAttribute('data-robot', 'xarm6');
  }
});

test('direct links, incompatible parameters, localization and mobile layout', async ({ browser }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  await page.goto('/?model=xarm7&gripper=bio-gripper-g2&opening=110.1');
  await ready(page);
  await expect(page.locator('#opening-number')).toHaveValue('110.1');
  await expect(page.locator('#assets a')).toHaveCount(2);
  await page.locator('#language').click();
  await expect(page.getByRole('combobox', { name: 'End effector' })).toHaveValue(bio.id);
  await expect(page.getByRole('spinbutton', { name: 'Opening' })).toHaveValue('110.1');
  await expect(page.getByRole('slider', { name: 'Opening' })).toBeVisible();
  await expect(page.locator('#opening-continuous label')).toHaveClass('visually-hidden');
  await expect(page.locator('#gripper-intro')).toBeHidden();
  await expect(page.locator('#gripper-name, .gripper-heading')).toHaveCount(0);
  await expect(page.locator('#assets')).toContainText('Accessory');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await clearSavedScene(page);
  await page.goto('/?model=lite6&gripper=gripper-g2&opening=42');
  await ready(page);
  await expect(page.locator('#tool-gripper-select')).toHaveValue('');
  await expect(page.locator('#assets a')).toHaveCount(1);
  expect(page.url()).not.toContain('gripper=');
  await clearSavedScene(page);
  await page.goto('/?model=xarm6&gripper=unknown&opening=42');
  await ready(page);
  await expect(page.locator('#tool-gripper-select')).toHaveValue('');
  expect(page.url()).not.toContain('gripper=');
  await clearSavedScene(page);
  await page.goto('/?model=bio-gripper-g2&opening=999');
  await ready(page);
  await expect(page.locator('#opening-number')).toHaveValue('150.0');
  await page.locator('#language').click();
  await expect(page.locator('#robot-select')).toHaveValue('xarm6');
  await expect(page.locator('#tool-gripper-select')).toHaveValue(bio.id);
  await expect(page.locator('#tool-dropdown .selector-heading')).toHaveText('End effector');
  await expect(page.locator('[data-standalone-view]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const mobileLabelBox = (await page.locator('label[for="tool-gripper-select"]').boundingBox())!;
  const mobileSelectBox = (await page.locator('#tool-gripper-select').boundingBox())!;
  expect(mobileSelectBox.x).toBeGreaterThanOrEqual(mobileLabelBox.x + mobileLabelBox.width + 8);
  expect(Math.abs((mobileSelectBox.y + mobileSelectBox.height / 2) - (mobileLabelBox.y + mobileLabelBox.height / 2))).toBeLessThanOrEqual(2);
  await selectGripper(page, 'gripper-g2');
  await ready(page);
  await expect(page.getByRole('combobox', { name: 'End effector' })).toHaveValue('gripper-g2');
  await page.getByRole('spinbutton', { name: 'Opening' }).fill('42');
  await page.getByRole('spinbutton', { name: 'Opening' }).dispatchEvent('change');
  await expect(page.getByRole('slider', { name: 'Opening' })).toHaveValue('42');
  await selectGripper(page, '');
  await ready(page);
  await expect(page.locator('#tool-gripper-select')).toHaveValue('');
  await expect(page.locator('#tool-dropdown .selector-heading')).toHaveText('End effector');
  await expect(page.locator('#gripper-control')).toBeHidden();
  const armSelect = (await page.locator('#robot-models').boundingBox())!;
  const toolSelect = (await page.locator('#tool-dropdown').boundingBox())!;
  expect(toolSelect.y).toBeGreaterThan(armSelect.y + armSelect.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await context.close();
});

test('superseded gripper loads and failed resources are handled with retry', async ({ page }) => {
  test.setTimeout(180_000);
  let release!: () => void;
  let requested!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const intercepted = new Promise<void>(resolve => { requested = resolve; });
  await page.route('**/optimized-models/models/gripper-g2/base.*.glb.gz.bin', async route => { requested(); await gate; await route.abort(); });
  await page.goto('/');
  await ready(page);
  await selectGripper(page, 'gripper-g2');
  await intercepted;
  await expect(page.locator('#tool-gripper-select')).toHaveValue(g2.id);
  await expect(page.locator('#tool-gripper-select')).toBeEnabled();
  await expect(page.locator('#assets a')).toHaveCount(0);
  await selectGripper(page, 'bio-gripper-g2');
  await ready(page);
  release();
  await page.waitForTimeout(500);
  await expect(page.locator('#stage')).toHaveAttribute('data-gripper', bio.id);
  await expect(page.locator('#tool-gripper-select')).toHaveValue(bio.id);
  await expect(page.locator('#assets a')).toHaveCount(2);
  await expect(page.locator('#load-message')).toBeHidden();
  await selectGripper(page, '');
  await ready(page);
  await page.unroute('**/optimized-models/models/gripper-g2/base.*.glb.gz.bin');
  let attempts = 0;
  await page.route('**/optimized-models/models/gripper-g2/base.*.glb.gz.bin', route => {
    attempts++;
    return attempts === 1 ? route.abort() : route.continue();
  });
  await selectGripper(page, 'gripper-g2');
  await expect(page.locator('#load-message')).toContainText('模型加载失败');
  await expect(page.locator('#assets a')).toHaveCount(0);
  await page.locator('#retry').click();
  await ready(page);
  await expect(page.locator('#assets a')).toHaveCount(2);
  expect(attempts).toBe(2);
});

test('keyboard selection and legacy-link retry retain the mounted opening', async ({ page }) => {
  let attempts = 0;
  await page.route('**/optimized-models/models/gripper-g2/base.*.glb.gz.bin', route => ++attempts === 1 ? route.abort() : route.continue());
  await page.goto('/?model=gripper-g2&opening=42');
  await expect(page.locator('#load-message')).toContainText('模型加载失败');
  await page.locator('#retry').focus();
  await page.keyboard.press('Enter');
  await ready(page);
  await expect(page.locator('#opening-number')).toHaveValue('42.0');
  expect(new URL(page.url()).searchParams.get('gripper')).toBe(g2.id);
  expect(attempts).toBe(2);
  await page.locator('#language').click();
  await expect(page.getByRole('combobox', { name: 'Robot arm' })).toHaveValue('xarm6');
  await page.getByRole('combobox', { name: 'End effector' }).focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await ready(page);
  await expect(page.locator('#tool-gripper-select')).toHaveValue(bio.id);
});

test('BIO visual pad faces match the commanded gap and remain symmetric', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/?model=bio-gripper-g2');
  await ready(page);
  const measurements = await page.evaluate(async () => {
    const loadModule = (path: string) => import(/* @vite-ignore */ path);
    const [{ GLTFLoader }, { DRACOLoader }, { createGripperModel }, { getGripper }] = await Promise.all([
      loadModule('/node_modules/three/examples/jsm/loaders/GLTFLoader.js'),
      loadModule('/node_modules/three/examples/jsm/loaders/DRACOLoader.js'),
      loadModule('/src/gripper-model.ts'), loadModule('/src/grippers.ts'),
    ]);
    const decoder = new DRACOLoader().setDecoderPath('/draco/');
    const loader = new GLTFLoader().setDRACOLoader(decoder);
    const names = ['bio_gripper_g2_base', 'bio_gripper_g2_left_finger', 'bio_gripper_g2_right_finger'];
    const scenes = await Promise.all(names.map(name => loader.loadAsync(`/models/bio-gripper-g2/${name}.glb`)));
    const parts = Object.fromEntries(names.map((name, index) => [name, scenes[index].scene]));
    const model = createGripperModel(getGripper('bio-gripper-g2'), parts);
    return [71, 110, 150].map(opening => {
      model.setOpening(opening);
      model.root.updateMatrixWorld(true);
      const inner = (part: any, left: boolean) => {
        let limit = left ? -Infinity : Infinity;
        part.traverse((mesh: any) => {
          if (!mesh.isMesh) return;
          const positions = mesh.geometry.getAttribute('position');
          const point = model.root.position.clone();
          for (let i = 0; i < positions.count; i++) {
            point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
            model.root.worldToLocal(point);
            // The reference URDF identifies the gripping surface at X > 31 mm in the finger frame.
            if (point.x > 0.059 + 0.031) limit = left ? Math.max(limit, point.y) : Math.min(limit, point.y);
          }
        });
        return limit * 1000;
      };
      const left = inner(parts.bio_gripper_g2_left_finger, true);
      const right = inner(parts.bio_gripper_g2_right_finger, false);
      return { opening, left, right, gap: right - left };
    });
  });
  for (const { opening, left, right, gap } of measurements) {
    expect(Math.abs(gap - opening)).toBeLessThan(0.02);
    expect(Math.abs(left + right)).toBeLessThan(0.02);
  }
});
