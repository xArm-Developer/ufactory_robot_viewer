import { expect, test, type Page } from '@playwright/test';
import { selectRail } from './selection-panels';

type ChainUpload = { kind: string; bend: number; fixed: number; moving: number };
type ChainCapture = { uploads: ChainUpload[]; disposed: number };

async function captureState(page: Page): Promise<ChainCapture> {
  return page.evaluate(() => (window as unknown as { chainCapture: ChainCapture }).chainCapture);
}

async function expectTravelUpload(page: Page, mm: number): Promise<void> {
  await expect.poll(async () => {
    const { uploads } = await captureState(page);
    return uploads.at(-1)?.bend;
  }, { timeout: 30_000 }).toBeCloseTo(0.0868774205 - 0.22 - mm / 2000, 5);
  const { uploads } = await captureState(page);
  const upload = uploads.at(-1)!;
  expect(upload.fixed).toBeCloseTo(0.3205585778, 5);
  expect(upload.moving).toBeCloseTo(0.3014238477 - mm / 1000, 5);
}

test('drag chain follows travel through initial load, interaction, and rail replacement', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  // Observe the actual WebGL buffer uploads and disposal without exposing app internals.
  await page.addInitScript(() => {
    const state: ChainCapture = { uploads: [], disposed: 0 };
    (window as unknown as { chainCapture: ChainCapture }).chainCapture = state;
    const prototype = WebGL2RenderingContext.prototype as unknown as Record<string, (...args: unknown[]) => void>;
    const bindBuffer = prototype.bindBuffer;
    const bufferData = prototype.bufferData;
    const bufferSubData = prototype.bufferSubData;
    const deleteBuffer = prototype.deleteBuffer;
    const bound = new WeakMap<WebGL2RenderingContext, WebGLBuffer | null>();
    const tracked = new WeakSet<WebGLBuffer>();
    const arrayBuffer = 0x8892;

    function capture(data: unknown, kind: string): boolean {
      if (!(data instanceof Float32Array) || data.length !== 3192 ||
          Math.abs(data[0] + 0.161242619) > 1e-6 || Math.abs(data[1] - 0.0104962) > 1e-6) return false;
      state.uploads.push({ kind, bend: data[2], fixed: data[34 * 3 + 2], moving: data[68 * 3 + 2] });
      return true;
    }

    prototype.bindBuffer = function (this: WebGL2RenderingContext, ...args: unknown[]) {
      if (args[0] === arrayBuffer) bound.set(this, args[1] as WebGLBuffer | null);
      return bindBuffer.apply(this, args);
    };
    prototype.bufferData = function (this: WebGL2RenderingContext, ...args: unknown[]) {
      if (args[0] === arrayBuffer && capture(args[1], 'create')) {
        const buffer = bound.get(this);
        if (buffer) tracked.add(buffer);
      }
      return bufferData.apply(this, args);
    };
    prototype.bufferSubData = function (this: WebGL2RenderingContext, ...args: unknown[]) {
      if (args[0] === arrayBuffer) capture(args[2], 'update');
      return bufferSubData.apply(this, args);
    };
    prototype.deleteBuffer = function (this: WebGL2RenderingContext, ...args: unknown[]) {
      if (args[0] instanceof WebGLBuffer && tracked.has(args[0])) state.disposed++;
      return deleteBuffer.apply(this, args);
    };
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/?model=xarm6&rail=al0700&railPos=350');
  await expect(page.locator('#stage')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await expectTravelUpload(page, 350);
  expect((await captureState(page)).uploads.at(-1)?.kind).toBe('create');
  const fk = await page.locator('#fk-fields').innerText();

  // Invalid edits leave both the travel and the uploaded geometry at 350 mm.
  const uploadsBeforeInvalid = (await captureState(page)).uploads.length;
  for (const invalid of ['-0.1', '700.1', '12.05', '']) {
    await page.locator('#rail-number').fill(invalid);
    await page.locator('#rail-number').dispatchEvent('change');
    await expect(page.locator('#rail-number')).toHaveValue('350.0');
  }
  expect((await captureState(page)).uploads.length).toBe(uploadsBeforeInvalid);
  await expectTravelUpload(page, 350);

  for (const mm of [0, 175, 350, 525, 700]) {
    await page.locator('#rail-range').fill(String(mm));
    await page.locator('#rail-range').dispatchEvent('input');
    await expectTravelUpload(page, mm);
    await expect(page.locator('#stage-rail-pos')).toHaveText(mm.toFixed(1));
    expect(await page.locator('#fk-fields').innerText()).toBe(fk);
    if ([0, 350, 700].includes(mm)) {
      await page.locator('#canvas-area canvas').screenshot({ path: testInfo.outputPath(`chain-${mm}.png`) });
    }
  }
  expect((await captureState(page)).uploads.at(-1)?.kind).toBe('update');

  // Drag the actual slider across the track and verify the final uploaded mesh.
  const range = page.locator('#rail-range');
  await range.fill('0');
  await range.dispatchEvent('input');
  await expectTravelUpload(page, 0);
  await range.evaluate(element => {
    const target = window as unknown as { railInputEvents: number };
    target.railInputEvents = 0;
    element.addEventListener('input', () => target.railInputEvents++);
  });
  const rangeBox = (await range.boundingBox())!;
  await page.mouse.move(rangeBox.x + 7, rangeBox.y + rangeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(rangeBox.x + rangeBox.width - 7, rangeBox.y + rangeBox.height / 2, { steps: 12 });
  await page.mouse.up();
  const draggedMm = Number(await page.locator('#rail-number').inputValue());
  expect(draggedMm).toBeGreaterThan(690);
  expect(await page.evaluate(() => (window as unknown as { railInputEvents: number }).railInputEvents)).toBeGreaterThan(1);
  await expectTravelUpload(page, draggedMm);

  // Inspect the side opposite the default camera, where the chain is attached.
  const canvas = page.locator('#canvas-area canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  const x = box.x + box.width * 0.35;
  const y = box.y + box.height * 0.65;
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, -500);
  await page.waitForTimeout(700);
  await page.mouse.down();
  await page.mouse.move(x + box.height * 0.625, y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  for (const mm of [0, 350, 700]) {
    await page.locator('#rail-range').fill(String(mm));
    await page.locator('#rail-range').dispatchEvent('input');
    await expectTravelUpload(page, mm);
    await canvas.screenshot({ path: testInfo.outputPath(`chain-rear-${mm}.png`) });
  }

  await page.locator('#view-reset').click();
  await expectTravelUpload(page, 700);
  await page.locator('#rail-number').fill('0');
  await page.locator('#rail-number').dispatchEvent('change');
  await expectTravelUpload(page, 0);

  await selectRail(page, 'none');
  await expect(page.locator('#stage')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await expect.poll(async () => (await captureState(page)).disposed).toBeGreaterThan(0);
  await expect(page.locator('#rail-panel')).toBeHidden();
  await selectRail(page, 'al0700');
  await expect(page.locator('#stage')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await expect.poll(async () => (await captureState(page)).uploads.at(-1)?.kind, { timeout: 30_000 }).toBe('create');
  await expectTravelUpload(page, 0);
  expect(errors).toEqual([]);
});
