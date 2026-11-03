export type FooterLanguage = 'zh' | 'en';

const content = {
  zh: {
    follow: '关注我们',
    social: [
      ['知乎', 'https://www.zhihu.com/people/ufactory', '\ue600'],
      ['哔哩哔哩', 'https://space.bilibili.com/182490099/upload/video', '\ue66f'],
      ['CSDN', 'https://blog.csdn.net/ufactory', '\ue605'],
      ['GitHub', 'https://github.com/xArm-Developer', '\ue85a'],
    ],
  },
  en: {
    follow: 'Follow Us',
    social: [
      ['YouTube', 'https://www.youtube.com/channel/UCyy5ekYtq35jFtPpY3O_tVA', '\ue70f'],
      ['LinkedIn', 'https://www.linkedin.com/company/ufactoryxarm/', '\ue70c'],
      ['Facebook', 'https://www.facebook.com/Ufactory2013', '\ue70e'],
      ['X', 'https://x.com/ufactory_uf', '\ue6e7'],
      ['Instagram', 'https://www.instagram.com/ufactoryofficial/', '\ue70b'],
      ['GitHub', 'https://github.com/xArm-Developer', '\ue85a'],
    ],
  },
} as const;

export class SiteFooter {
  private language: FooterLanguage = 'zh';

  constructor(private readonly host: HTMLElement) {
    this.render();
  }

  setLanguage(language: FooterLanguage): void {
    if (this.language === language) return;
    this.language = language;
    this.render();
  }

  private render(): void {
    const copy = content[this.language];
    const social = copy.social.map(([name, href, glyph]) =>
      `<li><a href="${href}" target="_blank" rel="noopener noreferrer" aria-label="${name}"><span class="footer-icon" aria-hidden="true">${glyph}</span></a></li>`,
    ).join('');
    this.host.dataset.language = this.language;
    this.host.innerHTML = `
      <div class="footer-inner">
        <div class="footer-social"><span>${copy.follow}</span><ul>${social}</ul></div>
      </div>`;
  }
}
