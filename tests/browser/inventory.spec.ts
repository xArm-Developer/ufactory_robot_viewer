import { expect, test, devices, type Page } from '@playwright/test';
import { selectRobot } from './selection-panels';

const products = [
  { id: 'xarm5', name: 'xArm 5', url: 'https://www.shop.ufactory.cc/products/xarm-5' },
  { id: 'xarm6', name: 'xArm 6', url: 'https://www.shop.ufactory.cc/products/xarm-6' },
  { id: 'xarm7', name: 'xArm 7', url: 'https://www.shop.ufactory.cc/products/xarm-7' },
  { id: 'uf850', name: '850', url: 'https://www.shop.ufactory.cc/products/850' },
  { id: 'lite6', name: 'Lite 6', url: 'https://www.shop.ufactory.cc/products/lite-6' },
] as const;

async function expectReady(page: Page, id: string) {
  await expect(page.locator('#stage')).toHaveAttribute('data-robot', id);
  await expect(page.locator('#stage')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
}

async function expectProduct(page: Page, product: typeof products[number]) {
  const inventory = page.locator('#assets');
  await expect(inventory.locator('a')).toHaveCount(1);
  await expect(inventory).toContainText(product.name);
  await expect(inventory.locator('a')).toHaveAttribute('href', product.url);
  await expect(inventory.locator('a')).toHaveAttribute('target', '_blank');
  await expect(inventory.locator('a')).toHaveAttribute('rel', /noopener/);
  await expect(inventory.locator('a')).toHaveAttribute('rel', /noreferrer/);
}

test('inventory follows all robot selections and direct links in both languages', async ({ page, context }) => {
  test.setTimeout(240_000);
  await context.route('https://www.shop.ufactory.cc/**', route => route.fulfill({ status: 200, body: 'Product page' }));
  await page.goto('/');
  await expectReady(page, 'xarm6');
  await expectProduct(page, products[1]);
  await expect(page.locator('#assets')).toContainText('机械臂');
  await expect(page.getByRole('heading', { name: '探索每一个细节' })).toHaveCount(0);
  await expect(page.getByText('为创造而生。', { exact: true })).toHaveCount(0);
  await expect(page.getByText('关于这个演示', { exact: true })).toHaveCount(0);

  for (const product of products) {
    await selectRobot(page, product.id);
    await expectReady(page, product.id);
    await expectProduct(page, product);
  }

  await page.locator('#language').click();
  await expect(page.locator('#assets')).toContainText('Robot arm');
  await expect(page.getByRole('heading', { name: 'Explore every detail' })).toHaveCount(0);
  await expect(page.getByText('Made to create.', { exact: true })).toHaveCount(0);
  await expect(page.getByText('About this demo', { exact: true })).toHaveCount(0);

  // The real link is keyboard accessible and opens a separate tab, with the network request intercepted.
  const link = page.locator('#assets a');
  await link.focus();
  await expect(link).toBeFocused();
  const popupPromise = page.waitForEvent('popup');
  await page.keyboard.press('Enter');
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');
  expect(popup.url()).toBe(products[4].url);
  await popup.close();

  for (const product of products) {
    await page.goto(`/?model=${product.id}`);
    await expectReady(page, product.id);
    await expectProduct(page, product);
  }
});

test('loading, failed model and retry never show the previous asset', async ({ page }) => {
  let release!: () => void;
  let requested!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const intercepted = new Promise<void>(resolve => { requested = resolve; });
  let attempt = 0;
  await page.route('**/models/xarm5/xarm5.urdf', async route => {
    attempt++;
    if (attempt === 1) {
      requested();
      await gate;
      await route.abort();
    } else {
      await route.continue();
    }
  });

  await page.goto('/');
  await expectReady(page, 'xarm6');
  await expectProduct(page, products[1]);
  await selectRobot(page, 'xarm5');
  await intercepted;
  await expect(page.locator('#assets a')).toHaveCount(0);
  await expect(page.locator('#assets')).toContainText('加载');
  await page.locator('#language').click();
  await expect(page.locator('#assets')).toContainText('Loading');
  release();
  await expect(page.locator('#load-message')).toContainText('Could not load');
  await expect(page.locator('#assets a')).toHaveCount(0);
  await expect(page.locator('#assets')).toContainText(/unavailable|failed|could not/i);
  await page.locator('#retry').click();
  await expectReady(page, 'xarm5');
  await expectProduct(page, products[0]);
  expect(attempt).toBe(2);
});

test('a stale same-model failure and a stale success cannot replace the current inventory', async ({ page }) => {
  let releaseFirst!: () => void;
  let firstRequested!: () => void;
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
  const firstIntercepted = new Promise<void>(resolve => { firstRequested = resolve; });
  let count = 0;
  await page.route('**/models/xarm5/xarm5.urdf', async route => {
    count++;
    if (count === 1) {
      firstRequested();
      await firstGate;
      await route.abort();
    } else {
      await route.continue();
    }
  });

  await page.goto('/');
  await expectReady(page, 'xarm6');
  await selectRobot(page, 'xarm5');
  await firstIntercepted;
  await selectRobot(page, 'xarm7');
  await expectReady(page, 'xarm7');
  await selectRobot(page, 'xarm5');
  await expectReady(page, 'xarm5');
  await expectProduct(page, products[0]);
  releaseFirst();
  await expect.poll(() => count).toBe(2);
  await page.waitForTimeout(500);
  await expectReady(page, 'xarm5');
  await expectProduct(page, products[0]);
  await expect(page.locator('#load-message')).toBeHidden();

  let releaseSecond!: () => void;
  let secondRequested!: () => void;
  const secondGate = new Promise<void>(resolve => { releaseSecond = resolve; });
  const secondIntercepted = new Promise<void>(resolve => { secondRequested = resolve; });
  await page.route('**/models/uf850/uf850.urdf', async route => {
    secondRequested();
    await secondGate;
    await route.continue();
  });
  await selectRobot(page, 'uf850');
  await secondIntercepted;
  await selectRobot(page, 'lite6');
  await expectReady(page, 'lite6');
  await expectProduct(page, products[4]);
  releaseSecond();
  await page.waitForTimeout(500);
  await expectReady(page, 'lite6');
  await expectProduct(page, products[4]);
  await expect(page.locator('#canvas-area canvas')).toHaveAttribute('aria-label', /Lite 6/);
});

test('inventory is readable without horizontal overflow on a phone', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  await page.goto('/');
  await expectReady(page, 'xarm6');
  await expectProduct(page, products[1]);
  await expect(page.locator('#assets a')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#language').click();
  await expect(page.locator('#assets')).toContainText('Robot arm');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await context.close();
});

test('a lost WebGL context clears the inventory and invalidates pending loads', async ({ page }) => {
  let release!: () => void;
  let requested!: () => void;
  let completed!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const intercepted = new Promise<void>(resolve => { requested = resolve; });
  const finished = new Promise<void>(resolve => { completed = resolve; });
  await page.route('**/models/xarm5/xarm5.urdf', async route => {
    requested();
    await gate;
    await route.continue();
    completed();
  });
  await page.goto('/');
  await expectReady(page, 'xarm6');
  await selectRobot(page, 'xarm5');
  await intercepted;
  await page.locator('#canvas-area canvas').evaluate(canvas => {
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
  });
  release();
  await finished;
  await expect(page.locator('#load-message')).toContainText('无法启动 3D 视图');
  await expect(page.locator('#assets')).toContainText('无法启动');
  await expect(page.locator('#assets a')).toHaveCount(0);
  await expect(page.locator('#stage')).not.toHaveAttribute('data-ready', 'true');
  await page.locator('#language').click();
  await expect(page.locator('#assets')).toContainText('3D view could not start');
  await selectRobot(page, 'xarm7');
  await expect(page.locator('#assets')).toContainText('3D view could not start');
  await expect(page.locator('#assets a')).toHaveCount(0);
});
