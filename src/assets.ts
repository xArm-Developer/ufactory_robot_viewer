export type AssetLanguage = 'zh' | 'en';

export interface SceneAsset {
  name: string;
  category: 'robot' | 'accessory';
  productUrl: string;
}

export type AssetInventoryState =
  | { status: 'loading' | 'failed' | 'webgl' }
  | { status: 'ready'; assets: readonly SceneAsset[] };

const labels = {
  zh: {
    loading: '正在加载场景资产…',
    failed: '模型加载失败，无法显示场景资产。',
    webgl: '3D 视图无法启动，无法显示场景资产。',
    robot: '机械臂', accessory: '配件', productLink: '查看官网',
    accessibleLink: (name: string) => `在新标签页打开 ${name} 官网产品页面`,
  },
  en: {
    loading: 'Loading scene assets…',
    failed: 'Scene assets are unavailable because the model could not load.',
    webgl: 'Scene assets are unavailable because the 3D view could not start.',
    robot: 'Robot arm', accessory: 'Accessory', productLink: 'View product',
    accessibleLink: (name: string) => `Open the official ${name} product page in a new tab`,
  },
} as const;

/** Render assets provided by the loaded scene, or its current loading state. */
export function renderAssetInventory(container: HTMLElement, state: AssetInventoryState, language: AssetLanguage): void {
  container.replaceChildren();
  if (state.status !== 'ready') {
    const message = document.createElement('p');
    message.className = 'asset-status';
    message.textContent = labels[language][state.status];
    container.append(message);
    return;
  }

  const list = document.createElement('ul');
  list.className = 'asset-items';
  for (const asset of state.assets) {
    const item = document.createElement('li');
    item.className = 'asset-row';
    item.dataset.assetCategory = asset.category;
    const description = document.createElement('div');
    const category = document.createElement('span');
    category.textContent = labels[language][asset.category];
    const name = document.createElement('strong');
    name.textContent = asset.name;
    description.append(category, name);
    const link = document.createElement('a');
    link.href = asset.productUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', labels[language].accessibleLink(asset.name));
    link.textContent = `${labels[language].productLink} ↗`;
    item.append(description, link);
    list.append(item);
  }
  container.append(list);
}
