import { expect, test } from '@playwright/test';

const ready = (page: import('@playwright/test').Page) =>
  expect(page.locator('#stage')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });

test('Cartesian joint limit notice identifies the exceeded joint and preserves the pose', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('uf-robots:scene', JSON.stringify({
      version: 1, robot: 'uf850', joints: [0, 0, 0, 0, -30 * Math.PI / 180, 359.5 * Math.PI / 180],
      rail: null, railMm: 0, sensor: null, gripper: null, opening: null,
    }));
  });
  await page.goto('/');
  await ready(page);
  await expect(page.locator('#stage')).toHaveAttribute('data-robot', 'uf850');
  await expect(page.locator('#stage-joint-5')).toHaveText('359.50');
  const pose = await page.locator('#fk-fields').innerText();
  await page.locator('[data-jog-axis="roll"][data-jog-dir="-1"]').click();
  await expect(page.locator('#status-text')).toContainText('C23 Joints Angle Exceed Limit ID [6]');
  await expect(page.locator('#stage-joint-5')).toHaveText('359.50');
  expect(await page.locator('#fk-fields').innerText()).toBe(pose);
});

test('repeated 850 Pitch holds cross 90 degrees without wrist flipping', async ({ page }) => {
  await page.goto('/?model=uf850');
  await ready(page);
  await page.locator('#jog-speed').fill('100');
  const button = page.locator('[data-jog-axis="pitch"][data-jog-dir="1"]');
  await button.scrollIntoViewIfNeeded();
  let previousPitch = Number(await page.locator('#fk-4').innerText());
  for (let hold = 0; hold < 15 && previousPitch < 95; hold++) {
    const box = (await button.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(800);
    await page.mouse.up();
    const pitch = Number(await page.locator('#fk-4').innerText());
    expect(pitch).toBeGreaterThan(previousPitch + 1);
    expect(Math.abs(Number(await page.locator('#stage-joint-3').innerText()))).toBeLessThan(10);
    expect(Math.abs(Number(await page.locator('#stage-joint-5').innerText()))).toBeLessThan(10);
    previousPitch = pitch;
  }
  expect(previousPitch).toBeGreaterThan(95);
});
