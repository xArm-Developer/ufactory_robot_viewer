import { expect, test } from '@playwright/test';

test('footer follows official language, links, layout and keyboard navigation', async ({ page }) => {
  await page.goto('/');
  const footer = page.locator('#site-footer');
  await expect(footer.getByText('订阅最新动态')).toBeVisible();
  await expect(footer.getByRole('link', { name: '官方商城' })).toHaveAttribute('href', /taobao\.com/);
  await expect(footer.getByRole('link', { name: '知乎' })).toHaveAttribute('href', 'https://www.zhihu.com/people/ufactory');
  await expect(footer.getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', 'https://github.com/xArm-Developer');
  await expect(footer.getByRole('textbox', { name: '邮箱地址' })).toBeVisible();

  for (const width of [1440, 800, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await expect(footer.getByRole('button', { name: '返回顶部' })).toBeVisible();
  }

  await footer.getByRole('textbox', { name: '邮箱地址' }).fill('kept@example.com');
  await page.locator('#language').click();
  await expect(footer.getByRole('textbox', { name: 'Email' })).toHaveValue('kept@example.com');
  await expect(footer.getByRole('link', { name: 'Online Store' })).toHaveAttribute('href', 'https://www.shop.ufactory.cc/');
  await expect(footer.getByRole('link', { name: 'YouTube' })).toBeVisible();
  await expect(footer.getByRole('link', { name: '知乎' })).toHaveCount(0);
  await footer.getByRole('button', { name: 'Back to top' }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(10);
  await page.locator('#page-examples').click();
  await expect(footer.getByText('Subscribe to the latest updates.')).toBeVisible();
});

test('subscription validates input and displays success and failure from the proxy', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/subscribe', async route => {
    requests++;
    const data = route.request().postDataJSON() as { email: string; language: string };
    expect(data).toEqual({ email: 'robot@example.com', language: 'zh' });
    await route.fulfill({ status: requests === 1 ? 502 : 200, json: requests === 1 ? { ok: false, error: 'upstream' } : { ok: true } });
  });
  await page.goto('/');
  const footer = page.locator('#site-footer');
  const input = footer.getByRole('textbox', { name: '邮箱地址' });
  await input.fill('invalid');
  await footer.getByRole('button', { name: '订阅' }).click();
  await expect(footer.getByRole('status')).toHaveText('请输入有效的邮箱地址。');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(requests).toBe(0);

  await input.fill('robot@example.com');
  await footer.getByRole('button', { name: '订阅' }).click();
  await expect(footer.getByRole('status')).toHaveText('订阅失败，请稍后重试。');
  await expect(input).toHaveValue('robot@example.com');
  await footer.getByRole('button', { name: '订阅' }).click();
  await expect(footer.getByRole('status')).toHaveText('订阅成功。');
  await expect(input).toHaveValue('');
  expect(requests).toBe(2);
});
