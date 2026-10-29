import { test, expect, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';

const fixtures = JSON.parse(readFileSync('tests/mujoco-fk.json', 'utf8')) as { samples: { joints: number[]; position: number[] }[] };
const zeroSample = fixtures.samples[1];

const ready = async (page: import('@playwright/test').Page) => {
  await page.goto('/');
  await expect(page.locator('#stage')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
};

test('desktop all-zero initial pose, 3D stage live telemetry, RGB coordinate frames, and Cartesian jog controls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const meshes: string[] = [];
  const errors: string[] = [];
  page.on('response', response => { if (response.url().endsWith('.glb') && response.ok()) meshes.push(response.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await ready(page);
  expect(meshes).toHaveLength(7);
  await expect(page.locator('h1')).toHaveText('xArm 6');
  await expect(page.locator('#control-card')).toBeVisible();
  await expect(page.locator('#control-expand')).toBeHidden();
  await expect(page.locator('#pose-panel')).toBeVisible();
  await expect(page.locator('#joint-panel')).toBeHidden();

  // Verify Target End Pose section and 3D drag gizmo buttons are completely removed
  await expect(page.locator('#position-fields')).toHaveCount(0);
  await expect(page.locator('#rotation-fields')).toHaveCount(0);
  await expect(page.locator('#apply-target')).toHaveCount(0);
  await expect(page.locator('#use-current')).toHaveCount(0);
  await expect(page.locator('[data-mode]')).toHaveCount(0);

  // Verify live pose & joint telemetry is overlaid on the 3D stage layer and starts at all-zero joints
  await expect(page.locator('#stage #stage-telemetry')).toBeVisible();
  expect(await page.locator('#stage-telemetry').evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none');
  for (let i = 0; i < 6; i++) {
    await expect(page.locator(`#stage-joint-${i}`)).toHaveText('0.00');
  }
  expect(Number(await page.locator('#fk-0').innerText())).toBeCloseTo(zeroSample.position[0] * 1000, 1);
  await expect(page.locator('#fk-1')).toHaveText('0.00');
  expect(Number(await page.locator('#fk-2').innerText())).toBeCloseTo(zeroSample.position[2] * 1000, 1);
  expect(Math.abs(Number(await page.locator('#fk-3').innerText()))).toBeCloseTo(180, 1);
  await expect(page.locator('#fk-4')).toHaveText('0.00');
  await expect(page.locator('#fk-5')).toHaveText('0.00');

  // Switch language to English
  await page.locator('#language').click();
  await expect(page.locator('#cartesian-tab')).toContainText('Cartesian control');
  await expect(page.locator('#toggle-base-frame')).toContainText('Base frame');
  await expect(page.locator('#toggle-tcp-frame')).toContainText('TCP frame');

  // Verify Base & TCP RGB coordinate frame buttons default to hidden and render on toggle
  const canvas = page.locator('#canvas-area canvas');
  await expect(page.locator('#toggle-base-frame')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#toggle-tcp-frame')).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(150);
  const noFramesShot = await canvas.screenshot();

  await page.locator('#toggle-base-frame').click();
  await expect(page.locator('#toggle-base-frame')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(150);
  const baseFrameShot = await canvas.screenshot();
  expect(baseFrameShot.equals(noFramesShot)).toBe(false);

  await page.locator('#toggle-tcp-frame').click();
  await expect(page.locator('#toggle-tcp-frame')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(150);
  const bothFramesShot = await canvas.screenshot();
  expect(bothFramesShot.equals(baseFrameShot)).toBe(false);

  // Toggle both off again
  await page.locator('#toggle-base-frame').click();
  await page.locator('#toggle-tcp-frame').click();
  await expect(page.locator('#toggle-base-frame')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#toggle-tcp-frame')).toHaveAttribute('aria-pressed', 'false');

  // Switch to Joint control tab and verify 3D stage telemetry updates both J1 and FK live
  await page.locator('#joint-tab').click();
  await expect(page.locator('#joint-panel')).toBeVisible();
  await expect(page.locator('#pose-panel')).toBeHidden();
  for (let i = 0; i < 6; i++) {
    await expect(page.locator(`#joint-number-${i}`)).toHaveValue('0.00');
  }
  await page.locator('#joint-number-0').fill('20');
  await page.locator('#joint-number-0').dispatchEvent('change');
  await expect(page.locator('#joint-number-0')).toHaveValue('20.00');
  await expect(page.locator('#stage-joint-0')).toHaveText('20.00');
  expect(Math.abs(Number(await page.locator('#fk-1').innerText()))).toBeGreaterThan(10);

  await page.locator('#reset-pose').click();
  await expect(page.locator('#stage-joint-0')).toHaveText('0.00');
  await expect(page.locator('#fk-1')).toHaveText('0.00');

  await page.locator('#cartesian-tab').click();
  await expect(page.locator('#pose-panel')).toBeVisible();

  // Verify UFACTORY Studio Cartesian jog defaults, step tap, speed percentage, and continuous hold from all-zero pose
  await expect(page.locator('#pos-step')).toHaveValue('1');
  await expect(page.locator('#rot-step')).toHaveValue('1');
  await expect(page.locator('#jog-speed')).toHaveValue('20');
  await expect(page.locator('#jog-speed-readout')).toHaveText('20% · 50.0 mm/s · 20 °/s');

  const homeX = Number(await page.locator('#fk-0').innerText());
  const homeY = Number(await page.locator('#fk-1').innerText());
  const homeZ = Number(await page.locator('#fk-2').innerText());
  const homeYaw = Number(await page.locator('#fk-5').innerText());

  await page.locator('[data-jog-axis="x"][data-jog-dir="1"]').click();
  await expect(page.locator('#status-text')).toHaveText('Target solved');
  expect(Number(await page.locator('#fk-0').innerText()) - homeX).toBeCloseTo(1, 1);

  await page.locator('[data-jog-axis="yaw"][data-jog-dir="1"]').click();
  expect(Number(await page.locator('#fk-5').innerText()) - homeYaw).toBeCloseTo(1, 1);

  await page.locator('#pos-step').fill('5');
  await page.locator('[data-jog-axis="y"][data-jog-dir="1"]').click();
  expect(Number(await page.locator('#fk-1').innerText()) - homeY).toBeCloseTo(5, 1);
  expect(Math.abs(Number(await page.locator('#stage-joint-0').innerText()))).toBeGreaterThan(0.5);

  // Invalid step input reports clear validation status without changing pose
  const yBeforeInvalid = await page.locator('#fk-1').innerText();
  await page.locator('#pos-step').fill('0');
  await page.locator('[data-jog-axis="y"][data-jog-dir="1"]').click();
  await expect(page.locator('#status-text')).toContainText('valid value');
  await expect(page.locator('#fk-1')).toHaveText(yBeforeInvalid);
  await page.locator('#pos-step').fill('1');

  // Verify speed slider 1% (2.5 mm/s) and 100% (250 mm/s)
  await page.locator('#jog-speed').fill('1');
  await page.locator('#jog-speed').dispatchEvent('input');
  await expect(page.locator('#jog-speed-readout')).toHaveText('1% · 2.5 mm/s · 1 °/s');
  await page.locator('#jog-speed').fill('100');
  await page.locator('#jog-speed').dispatchEvent('input');
  await expect(page.locator('#jog-speed-readout')).toHaveText('100% · 250.0 mm/s · 100 °/s');

  // Long-press continuous motion on Z+ at 40% (100 mm/s) starting from reset all-zero pose
  await page.locator('#reset-pose').click();
  await page.locator('#jog-speed').fill('40');
  await page.locator('#jog-speed').dispatchEvent('input');
  const zPlus = page.locator('[data-jog-axis="z"][data-jog-dir="1"]');
  await zPlus.scrollIntoViewIfNeeded();
  const zBox = (await zPlus.boundingBox())!;
  await page.mouse.move(zBox.x + zBox.width / 2, zBox.y + zBox.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(950);
  await page.mouse.up();
  const zAfterHold = Number(await page.locator('#fk-2').innerText());
  expect(zAfterHold - homeZ).toBeGreaterThan(20);
  await page.waitForTimeout(350);
  expect(Number(await page.locator('#fk-2').innerText())).toBeCloseTo(zAfterHold, 2);

  // Collapse unified panel into vertical control button and expand back
  const expandedStageWidth = (await page.locator('#stage').boundingBox())!.width;
  await page.locator('#control-toggle').click();
  await expect(page.locator('#control-card')).toBeHidden();
  await expect(page.locator('#control-expand')).toBeVisible();
  const expandButtonBox = (await page.locator('#control-expand').boundingBox())!;
  expect(expandButtonBox.height).toBeGreaterThan(expandButtonBox.width);
  const collapsedStageWidth = (await page.locator('#stage').boundingBox())!.width;
  expect(collapsedStageWidth).toBeGreaterThan(expandedStageWidth + 300);

  await page.locator('#control-expand').click();
  await expect(page.locator('#control-card')).toBeVisible();
  await expect(page.locator('#control-expand')).toBeHidden();
  expect(errors).toEqual([]);
});

test('desktop orbit, zoom, pan and view reset', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await ready(page);
  await page.locator('#stage').scrollIntoViewIfNeeded();
  const canvas = page.locator('#canvas-area canvas');
  const box = (await canvas.boundingBox())!;
  const cx = box.x + box.width * 0.40, cy = box.y + box.height * 0.42;
  const initial = await canvas.screenshot();
  await page.mouse.move(cx, cy); await page.mouse.down();
  await page.mouse.move(cx + 90, cy + 30, { steps: 4 }); await page.mouse.up();
  await page.waitForTimeout(800);
  const rotated = await canvas.screenshot();
  expect(rotated.equals(initial)).toBe(false);
  await page.mouse.move(cx, cy); await page.mouse.wheel(0, -250);
  await page.waitForTimeout(800);
  const zoomed = await canvas.screenshot();
  expect(zoomed.equals(rotated)).toBe(false);
  await page.mouse.move(cx, cy); await page.mouse.down({ button: 'right' });
  await page.mouse.move(cx + 50, cy + 25, { steps: 4 }); await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(800);
  const panned = await canvas.screenshot();
  expect(panned.equals(zoomed)).toBe(false);
  await page.locator('#view-reset').click();
  await page.waitForTimeout(800);
  const restored = await canvas.screenshot();
  // Rasterization may differ by a few pixels; compare the image rather than PNG bytes.
  const changedFraction = await page.evaluate(async ([first, second]) => {
    const load = async (data: string) => {
      const image = new Image(); image.src = `data:image/png;base64,${data}`;
      await image.decode(); return image;
    };
    const [a, b] = await Promise.all([load(first), load(second)]);
    const canvas = document.createElement('canvas'); canvas.width = a.width; canvas.height = a.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(a, 0, 0); const initialPixels = context.getImageData(0, 0, a.width, a.height).data;
    context.clearRect(0, 0, a.width, a.height); context.drawImage(b, 0, 0);
    const restoredPixels = context.getImageData(0, 0, a.width, a.height).data;
    let changed = 0;
    for (let i = 0; i < initialPixels.length; i += 4) {
      if (Math.max(...[0, 1, 2].map(channel => Math.abs(initialPixels[i + channel] - restoredPixels[i + channel]))) > 5) changed++;
    }
    return changed / (a.width * a.height);
  }, [initial.toString('base64'), restored.toString('base64')]);
  expect(changedFraction).toBeLessThan(0.005);
});

test('touch-size layout loads with stage telemetry, coordinate frame toggles, and joint/jog input', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  await ready(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('#stage-joint-0')).toHaveText('0.00');
  await expect(page.locator('#toggle-base-frame')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#toggle-base-frame').click();
  await expect(page.locator('#toggle-base-frame')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#toggle-tcp-frame').click();
  await expect(page.locator('#toggle-tcp-frame')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('#joint-tab').click();
  await page.locator('#joint-number-0').fill('15');
  await page.locator('#joint-number-0').dispatchEvent('change');
  await expect(page.locator('#joint-number-0')).toHaveValue('15.00');
  await expect(page.locator('#stage-joint-0')).toHaveText('15.00');
  await page.locator('#reset-pose').click();
  await expect(page.locator('#stage-joint-0')).toHaveText('0.00');

  await page.locator('#cartesian-tab').click();
  const beforeZ = Number(await page.locator('#fk-2').innerText());
  await page.locator('[data-jog-axis="z"][data-jog-dir="1"]').click();
  await expect(page.locator('#status-text')).toHaveText('目标已求解');
  expect(Number(await page.locator('#fk-2').innerText()) - beforeZ).toBeCloseTo(1, 1);

  await page.locator('#view-reset').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await context.close();
});

test('shows a clear model error if an asset is unavailable', async ({ page }) => {
  await page.route('**/models/xarm6/xarm6.urdf', route => route.abort());
  await page.goto('/');
  await expect(page.locator('#load-message')).toContainText('模型加载失败');
  await expect(page.locator('#retry')).toBeVisible();
});

test('shows a clear WebGL error if graphics initialization fails', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      if (type.startsWith('webgl')) return null;
      return Reflect.apply(original, this, [type, ...args]);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto('/');
  await expect(page.locator('#load-message')).toContainText('无法启动 3D 视图');
});
