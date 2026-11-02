export type FooterLanguage = 'zh' | 'en';
type SubscribeStatus = '' | 'invalid' | 'success' | 'error';

const content = {
  zh: {
    subscribe: '订阅最新动态', email: '邮箱地址', submit: '订阅', sending: '提交中…',
    invalid: '请输入有效的邮箱地址。', success: '订阅成功。', error: '订阅失败，请稍后重试。',
    navigation: '页脚导航', follow: '关注我们', top: '返回顶部',
    links: [
      ['about', '关于我们', 'https://www.ufactory.cc/zh-cn/about'],
      ['store', '官方商城', 'https://shop346325081.taobao.com/category.htm'],
      ['contact', '联系我们', 'https://www.ufactory.cc/zh-cn/contact'],
      ['payment', '购买与支付政策', 'https://www.ufactory.cc/zh-cn/purchase-payment'],
      ['shipping', '发货政策', 'https://www.ufactory.cc/zh-cn/shipping'],
      ['warranty', '保修与更换政策', 'https://www.ufactory.cc/zh-cn/warranty-replacement'],
    ],
    sales: '销售咨询：', support: '技术支持：', headquarters: '总部：',
    address: '深圳市南山区粤海街道麻雀岭工业区中钢科技园M6栋2楼', branch: '美国分公司：',
    privacy: '隐私政策', legal: '法律声明',
    social: [
      ['知乎', 'https://www.zhihu.com/people/ufactory', '\ue600'],
      ['哔哩哔哩', 'https://space.bilibili.com/182490099/upload/video', '\ue66f'],
      ['CSDN', 'https://blog.csdn.net/ufactory', '\ue605'],
      ['GitHub', 'https://github.com/xArm-Developer', '\ue85a'],
    ],
  },
  en: {
    subscribe: 'Subscribe to the latest updates.', email: 'Email', submit: 'Subscribe', sending: 'Submitting…',
    invalid: 'Enter a valid email address.', success: 'Subscription successful.', error: 'Could not subscribe. Please try again.',
    navigation: 'Footer navigation', follow: 'Follow Us', top: 'Back to top',
    links: [
      ['about', 'About Us', 'https://www.ufactory.cc/about'],
      ['contact', 'Contact Us', 'https://www.ufactory.cc/contact'],
      ['store', 'Online Store', 'https://www.shop.ufactory.cc/'],
      ['payment', 'Purchase & Payment Policy', 'https://www.ufactory.cc/purchase-payment'],
      ['shipping', 'Shipping Policy', 'https://www.ufactory.cc/shipping'],
      ['warranty', 'Warranty & Replacement Policy', 'https://www.ufactory.cc/warranty-replacement'],
    ],
    sales: 'Sales Inquiries:', support: 'Technical Support:', headquarters: 'Headquarters:',
    address: '2F, Building M-6, Ma Que Ling Industrial Zone, Nanshan District, Shenzhen, Guangdong, P.R. China', branch: 'US Branch:',
    privacy: 'Privacy Policy', legal: 'Legal Notice',
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
  private status: SubscribeStatus = '';
  private pending = false;

  constructor(private readonly host: HTMLElement) {
    host.addEventListener('submit', event => {
      event.preventDefault();
      void this.subscribe();
    });
    host.addEventListener('input', event => {
      if ((event.target as HTMLElement).id === 'footer-email' && this.status === 'invalid') {
        this.status = '';
        this.updateStatus();
      }
    });
    host.addEventListener('click', event => {
      if ((event.target as Element).closest('[data-footer-top]')) window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    this.render();
  }

  setLanguage(language: FooterLanguage): void {
    if (this.language === language) return;
    this.language = language;
    this.render();
  }

  private updateStatus(): void {
    const copy = content[this.language];
    const status = this.host.querySelector<HTMLElement>('.footer-status')!;
    status.textContent = this.status ? copy[this.status] : '';
    status.hidden = !this.status;
    const input = this.host.querySelector<HTMLInputElement>('#footer-email')!;
    if (this.status === 'invalid') input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
    const button = this.host.querySelector<HTMLButtonElement>('.footer-submit')!;
    button.disabled = this.pending;
    button.setAttribute('aria-label', this.pending ? copy.sending : copy.submit);
  }

  private async subscribe(): Promise<void> {
    if (this.pending) return;
    const input = this.host.querySelector<HTMLInputElement>('#footer-email')!;
    const email = input.value.trim();
    if (!email || !input.validity.valid) {
      this.status = 'invalid';
      this.updateStatus();
      input.focus();
      return;
    }
    this.pending = true;
    this.status = '';
    this.updateStatus();
    try {
      const response = await fetch(new URL(`${import.meta.env.BASE_URL}api/subscribe`, document.baseURI), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, language: this.language }),
      });
      const result: { ok?: boolean; error?: string } = await response.json();
      if (!response.ok || !result.ok) {
        this.status = result.error === 'invalid' ? 'invalid' : 'error';
      } else {
        this.status = 'success';
        const currentInput = this.host.querySelector<HTMLInputElement>('#footer-email')!;
        if (currentInput.value.trim() === email) currentInput.value = '';
      }
    } catch {
      this.status = 'error';
    } finally {
      this.pending = false;
      this.updateStatus();
    }
  }

  private render(): void {
    const email = this.host.querySelector<HTMLInputElement>('#footer-email')?.value ?? '';
    const copy = content[this.language];
    const links = copy.links.map(([id, text, href]) =>
      `<li data-footer-link="${id}"><a href="${href}"${id === 'store' ? ' target="_blank" rel="noopener noreferrer"' : ''}>${text}</a></li>`,
    ).join('');
    const social = copy.social.map(([name, href, glyph]) =>
      `<li><a href="${href}" target="_blank" rel="noopener noreferrer" aria-label="${name}"><span class="footer-icon" aria-hidden="true">${glyph}</span></a></li>`,
    ).join('');
    this.host.dataset.language = this.language;
    this.host.innerHTML = `
      <div class="footer-inner">
        <div class="footer-main">
          <div class="footer-brand-block">
            <a class="footer-logo" href="https://www.ufactory.cc/${this.language === 'zh' ? 'zh-cn' : ''}" aria-label="UFACTORY"><img src="${import.meta.env.BASE_URL}branding/logo.png" alt="UFACTORY" /></a>
            <p class="footer-subscribe-title">${copy.subscribe}</p>
            <form class="footer-form" novalidate>
              <label class="visually-hidden" for="footer-email">${copy.email}</label>
              <input id="footer-email" name="email" type="email" maxlength="254" autocomplete="email" placeholder="${copy.email}" aria-describedby="footer-status" required />
              <button class="footer-submit" type="submit" aria-label="${copy.submit}"><span class="footer-icon" aria-hidden="true">&#xe709;</span></button>
            </form>
            <p class="footer-status" id="footer-status" role="status" hidden></p>
          </div>
          <div class="footer-right">
            <nav aria-label="${copy.navigation}"><ul class="footer-links">${links}</ul></nav>
            <div class="footer-contact">
              <dl><dt>${copy.sales}</dt><dd><a href="mailto:sales@ufactory.cc">sales@ufactory.cc</a></dd></dl>
              <dl><dt>${copy.support}</dt><dd><a href="mailto:support@ufactory.cc">support@ufactory.cc</a></dd></dl>
              <dl><dt>${copy.headquarters}</dt><dd>${copy.address}</dd></dl>
              <dl><dt>${copy.branch}</dt><dd>262 W 38th Street #607, New York, NY 10018</dd></dl>
            </div>
          </div>
        </div>
        <div class="footer-bottom">
          <div class="footer-social"><span>${copy.follow}</span><ul>${social}</ul></div>
          <div class="footer-legal-row">
            <p>Copyright @ ${new Date().getFullYear()} Ufactory All Rights Reserved.</p>
            <div class="footer-legal"><div><span>${copy.privacy}</span><span class="footer-divider"></span><span>${copy.legal}</span></div>
              <button type="button" class="footer-top" data-footer-top aria-label="${copy.top}">
                <svg viewBox="0 0 37.5 41.5" aria-hidden="true"><path d="M0.5 12.523c0-1.434.768-2.759 2.012-3.471L16.513 1.036a3.998 3.998 0 0 1 3.974 0l14.001 8.016a4 4 0 0 1 2.001 3.471v15.974a4 4 0 0 1-2.001 3.471l-14.001 8.016a4 4 0 0 1-3.974 0L2.512 31.968A4 4 0 0 1 .5 28.497Z" /></svg>
                <span class="footer-icon" aria-hidden="true">&#xe714;</span>
              </button>
            </div>
          </div>
        </div>
      </div>`;
    this.host.querySelector<HTMLInputElement>('#footer-email')!.value = email;
    this.updateStatus();
  }
}
