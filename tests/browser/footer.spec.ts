import { expect, test } from '@playwright/test';

const links = {
  zh: [
    ['知乎', 'https://www.zhihu.com/people/ufactory'],
    ['哔哩哔哩', 'https://space.bilibili.com/182490099/upload/video'],
    ['CSDN', 'https://blog.csdn.net/ufactory'],
    ['GitHub', 'https://github.com/xArm-Developer'],
  ],
  en: [
    ['YouTube', 'https://www.youtube.com/channel/UCyy5ekYtq35jFtPpY3O_tVA'],
    ['LinkedIn', 'https://www.linkedin.com/company/ufactoryxarm/'],
    ['Facebook', 'https://www.facebook.com/Ufactory2013'],
    ['X', 'https://x.com/ufactory_uf'],
    ['Instagram', 'https://www.instagram.com/ufactoryofficial/'],
    ['GitHub', 'https://github.com/xArm-Developer'],
  ],
} as const;

test('footer shows only localized social links at desktop and mobile widths', async ({ page }) => {
  await page.goto('/');
  const footer = page.locator('#site-footer');

  for (const language of ['zh', 'en'] as const) {
    if (language === 'en') await page.locator('#language').click();
    await expect(footer).toHaveAttribute('data-language', language);
    await expect(footer.locator('.footer-social > span')).toHaveText(language === 'zh' ? '关注我们' : 'Follow Us');
    await expect(footer.getByRole('link')).toHaveCount(links[language].length);
    await expect(footer.locator('form, input, button, nav, img')).toHaveCount(0);
    await expect(footer).not.toContainText(/订阅|关于我们|联系方式|隐私政策|法律声明|返回顶部|Subscribe|About Us|Copyright|Privacy Policy|Legal Notice|Back to top/i);

    for (const [name, href] of links[language]) {
      const link = footer.getByRole('link', { name, exact: true });
      await expect(link).toHaveAttribute('href', href);
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }

    for (const width of [1440, 800, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      for (const [name] of links[language]) {
        const link = footer.getByRole('link', { name, exact: true });
        await expect(link).toBeVisible();
        const box = await link.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      }
    }
  }

  await expect(footer).toHaveCSS('font-family', /FooterPoppins/);
  await page.locator('#page-examples').click();
  await expect(footer.locator('.footer-social > span')).toHaveText('Follow Us');
  await page.locator('#language').click();
  await expect(footer.locator('.footer-social > span')).toHaveText('关注我们');
});

test('social links support keyboard navigation and activation in both languages', async ({ page }) => {
  await page.context().route('https://github.com/xArm-Developer', route => route.fulfill({ status: 200, body: 'GitHub' }));
  await page.goto('/');
  const footer = page.locator('#site-footer');

  for (const language of ['zh', 'en'] as const) {
    if (language === 'en') await page.locator('#language').click();
    const socialLinks = footer.getByRole('link');
    await socialLinks.first().focus();
    for (let index = 0; index < links[language].length; index++) {
      await expect(socialLinks.nth(index)).toBeFocused();
      if (index < links[language].length - 1) await page.keyboard.press('Tab');
    }
    const popupPromise = page.waitForEvent('popup');
    await page.keyboard.press('Enter');
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    expect(popup.url()).toBe('https://github.com/xArm-Developer');
    await popup.close();
  }
});
