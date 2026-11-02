import { expect, test, type Page } from '@playwright/test';

async function layout(page: Page) {
  return page.evaluate(() => {
    const stage = document.querySelector('#stage')!.getBoundingClientRect();
    const controls = document.querySelector('#controls')!.getBoundingClientRect();
    return { scroll: window.scrollY, stageTop: stage.top, controlsTop: controls.top, width: stage.width, height: stage.height };
  });
}

async function checkPageScroll(page: Page, viewport: { width: number; height: number }, size: { width: number; height: number }) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  const controlsRight = await page.locator('#controls').evaluate(el => el.getBoundingClientRect().right);
  await page.mouse.move(controlsRight - 8, viewport.height / 2);
  const before = await layout(page);
  expect(before.width).toBe(size.width);
  expect(before.height).toBe(size.height);

  await page.mouse.wheel(0, 220);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  const down = await layout(page);
  await page.mouse.wheel(0, -80);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(down.scroll - 60);
  const up = await layout(page);

  for (const [start, end] of [[before, down], [down, up]]) {
    const scrollDelta = end.scroll - start.scroll;
    expect(end.stageTop - start.stageTop).toBeCloseTo(-scrollDelta, 0);
    expect(end.controlsTop - start.controlsTop).toBeCloseTo(-scrollDelta, 0);
    expect(end.stageTop - start.stageTop).toBeCloseTo(end.controlsTop - start.controlsTop, 0);
  }
}

for (const viewport of [{ width: 1440, height: 600 }, { width: 1440, height: 900 }]) {
  test(`robot stage and controls scroll together at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.locator('#stage')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
    const initial = await layout(page);
    expect(initial.height).toBe(Math.min(670, viewport.height - 32));

    await checkPageScroll(page, viewport, initial);
    await page.locator('#motion-collapse').click();
    await expect(page.locator('#motion-collapse')).toHaveAttribute('aria-expanded', 'false');
    await checkPageScroll(page, viewport, initial);
    await page.locator('#motion-collapse').click();
    await page.locator('#rail-toggle').check();
    await expect(page.locator('#rail-panel')).toBeVisible();
    await expect(page.locator('#stage')).toHaveAttribute('data-rail', 'al0700');
    await expect(page.locator('#stage')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
    await checkPageScroll(page, viewport, initial);
  });
}

test('narrow robot layout stays stacked and the canvas wheel zooms without scrolling the page', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('#stage')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  const canvas = page.locator('#canvas-area canvas');
  const box = (await canvas.boundingBox())!;
  const before = await canvas.screenshot();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4);
  await page.mouse.wheel(0, 250);
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect((await canvas.screenshot()).equals(before)).toBe(false);

  for (const [width, height, stageHeight] of [[800, 900, 520], [320, 740, 450]]) {
    await page.setViewportSize({ width, height });
    const geometry = await page.evaluate(() => {
      const stage = document.querySelector('#stage')!;
      const stageBox = stage.getBoundingClientRect();
      const controlsBox = document.querySelector('#controls')!.getBoundingClientRect();
      return {
        position: getComputedStyle(stage).position, stageHeight: stageBox.height,
        stageBottom: stageBox.bottom, controlsTop: controlsBox.top,
        stageWidth: stageBox.width, controlsWidth: controlsBox.width,
        pageWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth,
      };
    });
    expect(geometry.position).toBe('relative');
    expect(geometry.stageHeight).toBe(stageHeight);
    expect(geometry.controlsTop).toBeGreaterThan(geometry.stageBottom);
    expect(geometry.stageWidth).toBe(geometry.controlsWidth);
    expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  }
});

test('packing stage keeps its desktop and narrow-screen positioning', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.goto('/?example=packing-01');
  await expect(page.locator('#packing-stage')).toHaveAttribute('data-status', 'running', { timeout: 60_000 });
  const stage = page.locator('#packing-stage');
  await expect(stage).toHaveCSS('position', 'sticky');
  await expect(stage).toHaveCSS('top', '16px');
  await expect(stage).toHaveCSS('height', '568px');

  await page.setViewportSize({ width: 320, height: 740 });
  await expect(stage).toHaveCSS('position', 'relative');
  await expect(stage).toHaveCSS('height', '450px');
  const geometry = await page.evaluate(() => ({
    stageBottom: document.querySelector('#packing-stage')!.getBoundingClientRect().bottom,
    panelTop: document.querySelector('.packing-panel')!.getBoundingClientRect().top,
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(geometry.panelTop).toBeGreaterThan(geometry.stageBottom);
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
});
