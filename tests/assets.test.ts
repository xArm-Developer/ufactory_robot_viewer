// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderAssetInventory, type SceneAsset } from '../src/assets';

const arm: SceneAsset = { name: 'xArm 6', category: 'robot', productUrl: 'https://www.shop.ufactory.cc/products/xarm-6' };
const accessory: SceneAsset = { name: 'Test accessory', category: 'accessory', productUrl: 'https://example.com/accessory' };

describe('scene asset inventory', () => {
  it('renders and removes an accessory as the scene assets change', () => {
    const container = document.createElement('div');
    renderAssetInventory(container, { status: 'ready', assets: [arm, accessory] }, 'zh');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelector('[data-asset-category="accessory"]')?.textContent).toContain('配件');
    expect(container.querySelector('[data-asset-category="accessory"] a')?.getAttribute('href')).toBe(accessory.productUrl);
    renderAssetInventory(container, { status: 'ready', assets: [arm] }, 'en');
    expect(container.querySelectorAll('li')).toHaveLength(1);
    expect(container.textContent).toContain('Robot arm');
    expect(container.textContent).not.toContain(accessory.name);
    expect(container.querySelector('a')?.getAttribute('aria-label')).toContain('new tab');
  });

  it('replaces loaded assets with localized loading and failure states', () => {
    const container = document.createElement('div');
    renderAssetInventory(container, { status: 'ready', assets: [arm] }, 'zh');
    renderAssetInventory(container, { status: 'loading' }, 'zh');
    expect(container.textContent).toContain('加载');
    expect(container.querySelector('a')).toBeNull();
    renderAssetInventory(container, { status: 'failed' }, 'en');
    expect(container.textContent).toContain('could not load');
    expect(container.querySelector('a')).toBeNull();
  });
});
