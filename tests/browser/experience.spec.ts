import { test, expect, devices } from '@playwright/test';

const ready = async (page: import('@playwright/test').Page) => {
  await page.goto('/');
  await expect(page.locator('#stage')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
};

test('desktop model, bilingual controls, numeric IK, and target dragging', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const meshes: string[] = [];
  const errors: string[] = [];
  page.on('response', response => { if (response.url().endsWith('.glb') && response.ok()) meshes.push(response.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await ready(page);
  expect(meshes).toHaveLength(7);
  await page.locator('#language').click();
  await expect(page.locator('h1')).toContainText('Make ideas');
  await page.locator('#joint-number-0').fill('20');
  await page.locator('#joint-number-0').dispatchEvent('change');
  await expect(page.locator('#joint-number-0')).toHaveValue('20.00');
  await page.locator('#reset-pose').click();
  await expect(page.locator('#joint-number-0')).toHaveValue('0.00');
  await page.locator('#pose-tab').click();
  const originalX = Number(await page.locator('#pose-0').inputValue());
  await page.locator('#pose-0').fill(String(originalX + 10));
  await page.locator('#pose-0').dispatchEvent('change');
  await expect(page.locator('#status-text')).toHaveText('Target solved');
  const beforeFailure = await page.locator('#joint-number-1').inputValue();
  await page.locator('#pose-0').fill('10000');
  await page.locator('#pose-0').dispatchEvent('change');
  await expect(page.locator('#status-text')).toContainText('Could not reach');
  expect(await page.locator('#joint-number-1').inputValue()).toBe(beforeFailure);
  await page.locator('#pose-0').fill('');
  await page.locator('#pose-0').dispatchEvent('change');
  await expect(page.locator('#status-text')).toContainText('valid value');
  await page.locator('#reset-pose').click();
  await page.locator('[data-mode=translate]').click();
  await page.locator('#stage').scrollIntoViewIfNeeded();
  const stage = (await page.locator('#stage').boundingBox())!;
  const x = stage.x + stage.width * 0.655;
  const y = stage.y + stage.height * 0.744;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 24, y + 8, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('#status-text')).toHaveText('Target solved');
  expect(Number(await page.locator('#pose-0').inputValue())).toBeGreaterThan(originalX + 5);
  await page.locator('#reset-pose').click();
  await page.locator('[data-mode=rotate]').click();
  await expect(page.locator('[data-mode=rotate]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#stage').scrollIntoViewIfNeeded();
  const rotationStage = (await page.locator('#stage').boundingBox())!;
  const rx = rotationStage.x + rotationStage.width / 2 + 114;
  const ry = rotationStage.y + rotationStage.height * 0.776;
  const beforeYaw = Number(await page.locator('#pose-5').inputValue());
  await page.mouse.move(rx, ry); await page.mouse.down();
  await page.mouse.move(rx + 20, ry + 6, { steps: 4 }); await page.mouse.up();
  await expect(page.locator('#status-text')).toHaveText('Target solved');
  expect(Math.abs(Number(await page.locator('#pose-5').inputValue()) - beforeYaw)).toBeGreaterThan(1);
  await page.locator('#view-reset').click();
  await page.locator('#panel-toggle').click();
  await expect(page.locator('#panel-content')).toBeHidden();
  expect(errors).toEqual([]);
});

test('touch-size layout loads and accepts joint input', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  await ready(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#joint-number-0').fill('15');
  await page.locator('#joint-number-0').dispatchEvent('change');
  await expect(page.locator('#joint-number-0')).toHaveValue('15.00');
  await page.locator('#reset-pose').click();
  await page.locator('#pose-tab').click();
  await page.locator('[data-mode=translate]').click();
  await expect(page.locator('[data-mode=translate]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#stage').scrollIntoViewIfNeeded();
  let stage = (await page.locator('#stage').boundingBox())!;
  const initialX = Number(await page.locator('#pose-0').inputValue());
  const client = await context.newCDPSession(page);
  let x = stage.x + stage.width * 0.80, y = stage.y + stage.height * 0.744;
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 18, y: y + 6 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('#status-text')).toHaveText('目标已求解');
  expect(Number(await page.locator('#pose-0').inputValue())).toBeGreaterThan(initialX + 5);
  await page.locator('#reset-pose').click();
  await page.locator('[data-mode=rotate]').click();
  await expect(page.locator('[data-mode=rotate]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#stage').scrollIntoViewIfNeeded();
  stage = (await page.locator('#stage').boundingBox())!;
  x = stage.x + stage.width / 2 + 85; y = stage.y + stage.height * 0.776;
  const yaw = Number(await page.locator('#pose-5').inputValue());
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 15, y: y + 5 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('#status-text')).toHaveText('目标已求解');
  expect(Math.abs(Number(await page.locator('#pose-5').inputValue()) - yaw)).toBeGreaterThan(1);
  await page.locator('#view-reset').click();
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
