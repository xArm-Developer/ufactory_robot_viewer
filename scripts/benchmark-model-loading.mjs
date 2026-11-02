// Run against a production preview: npm run build && npm run preview -- --host 127.0.0.1
// MODEL_BENCH_URL and CHROME_PATH may be overridden for the local test environment.
import { chromium } from '@playwright/test';

const baseURL = process.env.MODEL_BENCH_URL ?? 'http://127.0.0.1:4173/';
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--enable-unsafe-swiftshader', '--no-sandbox'],
});
const samples = { compressed: [], original: [] };

try {
  for (let trial = 0; trial < 3; trial++) {
    for (const mode of ['compressed', 'original']) {
      const context = await browser.newContext();
      const page = await context.newPage();
      if (mode === 'original') {
        await page.addInitScript(() => Object.defineProperty(window, 'DecompressionStream', { value: undefined }));
      }
      try {
        await page.goto(baseURL);
        await page.waitForFunction(() => document.querySelector('#stage')?.getAttribute('data-ready') === 'true', null, { timeout: 60_000 });
        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
        await cdp.send('Network.emulateNetworkConditions', {
          offline: false, latency: 100, downloadThroughput: 10_000_000 / 8, uploadThroughput: 10_000_000 / 8,
        });
        const start = await page.evaluate(() => {
          const now = performance.now();
          document.querySelector('#rail-toggle').click();
          return now;
        });
        await page.waitForFunction(() => document.querySelector('#stage')?.getAttribute('data-ready') === 'true', null, { timeout: 60_000 });
        const sample = await page.evaluate(startTime => {
          const elapsedMs = performance.now() - startTime;
          const resource = performance.getEntriesByType('resource').find(entry =>
            /\/models\/al0700\/model(?:\.[a-f0-9]{64})?\.glb(?:\.gz\.bin)?$/.test(entry.name));
          if (!resource) throw new Error('Missing rail resource timing');
          return { elapsedMs, transferBytes: resource.encodedBodySize, resourceMs: resource.duration };
        }, start);
        samples[mode].push(sample);
      } finally { await context.close(); }
    }
  }
} finally { await browser.close(); }

const median = numbers => [...numbers].sort((a, b) => a - b)[Math.floor(numbers.length / 2)];
const result = Object.fromEntries(Object.entries(samples).map(([mode, data]) => [mode, {
  samples: data,
  medianMs: median(data.map(sample => sample.elapsedMs)),
  transferBytes: median(data.map(sample => sample.transferBytes)),
}]));
result.reduction = 1 - result.compressed.medianMs / result.original.medianMs;
console.log(JSON.stringify(result, null, 2));
