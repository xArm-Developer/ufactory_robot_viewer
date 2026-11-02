import { devices, expect, test, type Page } from '@playwright/test';
import { jogJointTo } from './selection-panels';

async function ready(page: Page) {
  await expect(page.locator('#stage')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
}

async function railPosition(page: Page): Promise<number> {
  return Number(await page.locator('#rail-number').inputValue());
}

async function pressMouse(page: Page, selector: string) {
  const button = page.locator(selector);
  await button.scrollIntoViewIfNeeded();
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
}

test('rail buttons step, respect limits, and synchronize the read-only progress indicator', async ({ page }) => {
  await page.goto('/?rail=al0700&railPos=0');
  await ready(page);
  const progress = page.locator('#rail-progress');
  await expect(progress).toHaveAccessibleName('滑轨位置');
  await expect(page.locator('#rail-panel input[type="range"]')).toHaveCount(0);
  await expect(page.locator('#rail-panel .range-labels')).toHaveCount(0);
  await expect(progress).toHaveAttribute('aria-valuemin', '0');
  await expect(progress).toHaveAttribute('aria-valuemax', '700');
  await expect(progress).toHaveAttribute('aria-valuenow', '0.0');
  await expect(page.locator('#rail-minus')).toHaveAccessibleName('滑轨位置减小');
  await expect(page.locator('#rail-plus')).toHaveAccessibleName('滑轨位置增加');

  await page.locator('#rail-minus').click();
  await expect(page.locator('#rail-number')).toHaveValue('0.0');
  await page.locator('#rail-plus').click();
  await expect(page.locator('#rail-number')).toHaveValue('1.0');
  await expect(progress).toHaveAttribute('aria-valuetext', '1.0 mm');
  await expect(page.locator('#stage-rail-pos')).toHaveText('1.0');
  expect(new URL(page.url()).searchParams.get('railPos')).toBe('1.0');
  expect(await page.locator('#rail-fill').evaluate(el => parseFloat(el.style.width))).toBeCloseTo(100 / 700, 4);

  await page.locator('#rail-plus').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#rail-number')).toHaveValue('2.0');
  await page.locator('#rail-minus').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#rail-number')).toHaveValue('1.0');
  await page.locator('#rail-minus').evaluate(el => (el as HTMLButtonElement).click());
  await expect(page.locator('#rail-number')).toHaveValue('0.0');

  await page.locator('#rail-number').fill('699.5');
  await page.locator('#rail-number').dispatchEvent('change');
  await page.locator('#rail-plus').click();
  await expect(page.locator('#rail-number')).toHaveValue('700.0');
  await expect(progress).toHaveAttribute('aria-valuenow', '700.0');
  await pressMouse(page, '#rail-plus');
  await page.waitForTimeout(400);
  await page.mouse.up();
  await expect(page.locator('#rail-number')).toHaveValue('700.0');
  await page.locator('#language').click();
  await expect(page.locator('#rail-plus')).toHaveAccessibleName('Increase rail position');
  await expect(progress).toHaveAccessibleName('Rail position');
});

test('rail long press follows shared speed and stops on cancellation, blur, and rail removal', async ({ page }) => {
  await page.goto('/?rail=al0700&railPos=350');
  await ready(page);
  await page.locator('#rail-plus').dispatchEvent('pointerdown', { pointerId: 7, pointerType: 'touch', button: 0 });
  await page.waitForTimeout(100);
  await page.locator('#rail-plus').dispatchEvent('pointercancel', { pointerId: 7, pointerType: 'touch' });
  await page.waitForTimeout(250);
  expect(await railPosition(page)).toBe(350);

  await page.locator('#jog-speed').fill('1');
  await pressMouse(page, '#rail-plus');
  await page.waitForTimeout(100);
  expect(await railPosition(page)).toBe(350);
  await page.waitForTimeout(700);
  await page.mouse.up();
  const slow = await railPosition(page) - 350;
  expect(slow).toBeGreaterThan(0.4);
  expect(slow).toBeLessThan(4);

  await page.locator('#jog-speed').fill('100');
  const beforeFast = await railPosition(page);
  await pressMouse(page, '#rail-plus');
  await page.waitForTimeout(800);
  await page.mouse.up();
  const fast = await railPosition(page) - beforeFast;
  expect(fast).toBeGreaterThan(30);
  expect(fast).toBeGreaterThan(slow * 10);

  await pressMouse(page, '#rail-minus');
  await expect.poll(() => railPosition(page)).toBeLessThan(beforeFast + fast - 5);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const stopped = await railPosition(page);
  await page.waitForTimeout(350);
  expect(await railPosition(page)).toBe(stopped);
  await page.mouse.up();

  await pressMouse(page, '#rail-plus');
  await page.waitForTimeout(400);
  await page.locator('#rail-toggle').evaluate(el => {
    const input = el as HTMLInputElement;
    input.checked = false;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.mouse.up();
  await ready(page);
  await expect(page.locator('#rail-panel')).toBeHidden();
  await expect(page.locator('#stage')).not.toHaveAttribute('data-rail');
});

test('touch rail hold moves and stops on release in the narrow layout', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 320, height: 700 } });
  const page = await context.newPage();
  await page.goto('/?rail=al0700&railPos=350&gripper=gripper-g2');
  await ready(page);
  await page.locator('#jog-speed').fill('100');
  const button = page.locator('#rail-plus');
  await button.scrollIntoViewIfNeeded();
  const box = (await button.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('#rail-number')).toHaveValue('351.0');
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
  await page.waitForTimeout(700);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const stopped = await railPosition(page);
  expect(stopped).toBeGreaterThan(370);
  await page.waitForTimeout(350);
  expect(await railPosition(page)).toBe(stopped);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('#opening-continuous .range-labels')).toHaveCount(0);
  await context.close();
});

test('continuous rail movement stops at a collision and can reverse', async ({ page }) => {
  await page.goto('/?rail=al0700&railPos=700&gripper=gripper-g2');
  await ready(page);
  await page.locator('#joint-tab').click();
  expect(await jogJointTo(page, 0, 90)).toBeCloseTo(90, 1);
  await page.locator('#jog-speed').fill('100');
  await pressMouse(page, '#rail-minus');
  await expect(page.locator('#collision-toast')).toBeVisible({ timeout: 10_000 });
  const stopped = await railPosition(page);
  expect(stopped).toBeGreaterThan(350);
  expect(stopped).toBeLessThan(700);
  await page.waitForTimeout(350);
  expect(await railPosition(page)).toBe(stopped);
  await page.mouse.up();
  await page.locator('#rail-plus').click();
  await expect(page.locator('#collision-toast')).toBeHidden();
  expect(await railPosition(page)).toBeCloseTo(stopped + 1, 1);
});
