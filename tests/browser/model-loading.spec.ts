import { expect, test, type Page } from '@playwright/test';
import { selectGripper } from './selection-panels';

const ready = (page: Page) => expect(page.locator('#stage')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
const g2Base = '**/optimized-models/models/gripper-g2/base.*.glb.gz.bin';

test('arm meshes and selected accessory assets start before the URDF finishes', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  let release!: () => void;
  let intercepted!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const waiting = new Promise<void>(resolve => { intercepted = resolve; });
  await page.route('**/models/xarm7/xarm7.urdf', async route => {
    intercepted();
    await gate;
    await route.continue().catch(() => {});
  });
  try {
    await page.goto('/?model=xarm7&rail=al0700&gripper=gripper-g2');
    await waiting;
    await expect.poll(() => requests.filter(url => /models\/xarm7\/meshes\/.+\.glb$/.test(url)).length).toBe(8);
    await expect.poll(() => requests.some(url => /optimized-models\/models\/al0700\/model\..+\.glb\.gz\.bin$/.test(url))).toBe(true);
    await expect.poll(() => requests.some(url => /optimized-models\/models\/gripper-g2\/base\..+\.glb\.gz\.bin$/.test(url))).toBe(true);
    for (const path of ['/models/xarm7/collision.json', '/models/al0700/collision.json', '/models/gripper-g2/collision.json']) {
      await expect.poll(() => requests.some(url => url.endsWith(path))).toBe(true);
    }
    await expect(page.locator('#stage')).not.toHaveAttribute('data-ready', 'true');
  } finally { release(); }
  await ready(page);
  await expect(page.locator('#stage')).toHaveAttribute('data-robot', 'xarm7');
  await expect(page.locator('#stage')).toHaveAttribute('data-rail', 'al0700');
});

test('a URDF that differs from its visual manifest fails safely and can be retried', async ({ page }) => {
  await page.route('**/models/xarm7/xarm7.urdf', async route => {
    const response = await route.fetch();
    const xml = await response.text();
    await route.fulfill({ response, body: xml.replace('visual_glb/link1.glb', 'visual_glb/link2.glb') });
  });
  await page.goto('/?model=xarm7');
  await expect(page.locator('#load-message')).toContainText('模型加载失败', { timeout: 60_000 });
  await page.unroute('**/models/xarm7/xarm7.urdf');
  await page.locator('#retry').click();
  await ready(page);
  await expect(page.locator('#stage')).toHaveAttribute('data-robot', 'xarm7');
});

test('returning to a stalled selection starts a new request and ignores the stale result', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  let release!: () => void;
  let intercepted!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const waiting = new Promise<void>(resolve => { intercepted = resolve; });
  let attempts = 0;
  await page.route(g2Base, async route => {
    attempts++;
    if (attempts === 1) {
      intercepted();
      await gate;
      await route.abort().catch(() => {});
    } else await route.continue();
  });
  try {
    await selectGripper(page, 'gripper-g2');
    await waiting;
    await selectGripper(page, '');
    await ready(page);
    await selectGripper(page, 'gripper-g2');
    await ready(page);
    expect(attempts).toBe(2);
    await expect(page.locator('#stage')).toHaveAttribute('data-gripper', 'gripper-g2');
  } finally { release(); }
  await page.waitForTimeout(300);
  await expect(page.locator('#stage')).toHaveAttribute('data-gripper', 'gripper-g2');
  await expect(page.locator('#load-message')).toBeHidden();
});

test('without decompression support the original GLB is used', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'DecompressionStream', { value: undefined });
    Object.defineProperty(AbortSignal.prototype, 'throwIfAborted', { value: undefined, configurable: true });
  });
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto('/?rail=al0700&railPos=350');
  await ready(page);
  expect(requests.some(url => url.endsWith('/models/al0700/model.glb'))).toBe(true);
  expect(requests.some(url => url.includes('/optimized-models/'))).toBe(false);
  await expect(page.locator('#rail-number')).toHaveValue('350.0');
});

test('cached arm and accessory instances avoid fetching and parsing again', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const result = await page.evaluate(async () => {
    const scenePath = '/src/scene.ts';
    const robotsPath = '/src/robots.ts';
    const grippersPath = '/src/grippers.ts';
    const [{ RobotScene }, { getRobotSpec }, { getGripper }] = await Promise.all([
      import(scenePath) as Promise<typeof import('../../src/scene')>,
      import(robotsPath) as Promise<typeof import('../../src/robots')>,
      import(grippersPath) as Promise<typeof import('../../src/grippers')>,
    ]);
    const host = document.createElement('div');
    host.style.cssText = 'width: 320px; height: 320px; position: fixed; left: -9999px';
    document.body.appendChild(host);
    const scene = new RobotScene(host);
    const cache = (scene as unknown as { modelCache: {
      gltf: { parseAsync: (...args: [ArrayBuffer, string]) => Promise<unknown> };
      totalBytes: number;
    } }).modelCache;
    const parse = cache.gltf.parseAsync.bind(cache.gltf);
    let parses = 0;
    cache.gltf.parseAsync = (...args) => { parses++; return parse(...args); };
    const originalFetch = window.fetch;
    const originalParseXml = DOMParser.prototype.parseFromString;
    let urdfRequests = 0;
    let xmlParses = 0;
    DOMParser.prototype.parseFromString = function(source, type) {
      if (type === 'application/xml') xmlParses++;
      return originalParseXml.call(this, source, type);
    };
    let modelRequests = 0;
    window.fetch = (...args) => {
      if (/\.(?:glb|bin|stl)(?:\?|$)/.test(String(args[0]))) modelRequests++;
      if (/\.urdf(?:\?|$)/.test(String(args[0]))) urdfRequests++;
      return originalFetch(...args);
    };
    const arm6 = getRobotSpec('xarm6');
    const arm7 = getRobotSpec('xarm7');
    const accessories = { rail: true, railMm: 350, sensor: true, gripper: getGripper('gripper-g2'), opening: 42 };
    const empty = { rail: false, railMm: 0, sensor: false, opening: 0 };
    const snapshot = () => ({ parses, modelRequests, urdfRequests, xmlParses, bytes: cache.totalBytes });
    try {
      const firstArm = (await scene.load(arm6))!;
      firstArm.setJointValue('joint1', 0.4);
      const structure = (scene as unknown as { armTemplates: Map<string, import('three').Object3D> }).armTemplates.get('xarm6')!;
      let templateMeshes = 0;
      structure.traverse(object => { if ((object as import('three').Mesh).isMesh) templateMeshes++; });
      await scene.setAssemblyAccessories(accessories, arm6);
      const initial = snapshot();
      scene.setCollisionHighlight(['rail:drag_chain', 'gripper:left']);
      scene.clearCollisionHighlight();
      await scene.setAssemblyAccessories(empty, arm6);
      await scene.setAssemblyAccessories(accessories, arm6);
      const accessoriesAgain = snapshot();
      await scene.load(arm7);
      await scene.setAssemblyAccessories(accessories, arm7);
      const otherArm = snapshot();
      const reloadedArm = (await scene.load(arm6))!;
      const reloadedHome = reloadedArm.joints.joint1.jointValue[0];
      reloadedArm.setJointValue('joint1', 0.2);
      const reloadedMotion = reloadedArm.joints.joint1.jointValue[0];
      const firstArmMotion = firstArm.joints.joint1.jointValue[0];
      await scene.setAssemblyAccessories(accessories, arm6);
      const originalArm = snapshot();
      return { initial, accessoriesAgain, otherArm, originalArm, templateMeshes, reloadedHome, reloadedMotion, firstArmMotion };
    } finally {
      window.fetch = originalFetch;
      DOMParser.prototype.parseFromString = originalParseXml;
      scene.destroy();
      host.remove();
    }
  });
  expect(result.accessoriesAgain).toEqual(result.initial);
  expect(result.otherArm.parses).toBe(result.initial.parses + 8);
  expect(result.otherArm.urdfRequests).toBe(2);
  expect(result.otherArm.xmlParses).toBe(2);
  expect(result.originalArm).toEqual(result.otherArm);
  expect(result.templateMeshes).toBe(0);
  expect(result.reloadedHome).toBe(0);
  expect(result.reloadedMotion).toBeCloseTo(0.2);
  expect(result.firstArmMotion).toBeCloseTo(0.4);
  expect(result.originalArm.bytes).toBeLessThanOrEqual(64 * 1024 * 1024);
});

test('cache evicts unused decoded resources while preserving active instances', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const result = await page.evaluate(async () => {
    const path = '/src/model-cache.ts';
    const dracoPath = '/node_modules/three/examples/jsm/loaders/DRACOLoader.js';
    const [{ ModelCache }, { DRACOLoader }] = await Promise.all([
      import(path) as Promise<typeof import('../../src/model-cache')>,
      import(dracoPath) as Promise<typeof import('three/addons/loaders/DRACOLoader.js')>,
    ]);
    const draco = new DRACOLoader();
    const cache = new ModelCache(draco, 1);
    const url = new URL('/models/lite6-gripper/finger1.stl', document.baseURI).href;
    let requests = 0;
    const fetch = window.fetch;
    window.fetch = (...args) => { if (String(args[0]) === url) requests++; return fetch(...args); };
    try {
      const first = await cache.acquire(url);
      const second = await cache.acquire(url);
      let disposals = 0;
      const mesh = first.object as import('three').Mesh;
      mesh.geometry.addEventListener('dispose', () => disposals++);
      first.release();
      const whileActive = disposals;
      second.release();
      const afterRelease = disposals;
      const third = await cache.acquire(url);
      third.release();
      return { requests, whileActive, afterRelease };
    } finally { window.fetch = fetch; cache.dispose(); draco.dispose(); }
  });
  expect(result).toEqual({ requests: 2, whileActive: 0, afterRelease: 1 });
});

async function installCameraScene(page: Page, rail: boolean) {
  return page.evaluate(async rail => {
    const scenePath = '/src/scene.ts';
    const robotsPath = '/src/robots.ts';
    const [{ RobotScene }, { getRobotSpec }] = await Promise.all([
      import(scenePath) as Promise<typeof import('../../src/scene')>,
      import(robotsPath) as Promise<typeof import('../../src/robots')>,
    ]);
    const host = document.createElement('div');
    host.id = 'camera-test-host';
    host.style.cssText = 'width: 500px; height: 400px; position: fixed; z-index: 10000; top: 0; left: 0';
    document.body.appendChild(host);
    const scene = new RobotScene(host);
    const spec = getRobotSpec('xarm6');
    await scene.load(spec);
    if (rail) await scene.setAssemblyAccessories({ rail: true, railMm: 350, sensor: false, opening: 0 }, spec);
    (window as unknown as { cameraTest: unknown }).cameraTest = scene;
    const camera = (scene as unknown as { camera: import('three').PerspectiveCamera }).camera;
    return camera.position.toArray();
  }, rail);
}

async function cameraPosition(page: Page) {
  return page.evaluate(() => {
    const scene = (window as unknown as { cameraTest: { camera: import('three').PerspectiveCamera } }).cameraTest;
    return scene.camera.position.toArray();
  });
}

test('mouse rotation reaches beneath the arm and reset restores the rail preset', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const initial = await installCameraScene(page, true);
  const canvas = page.locator('#camera-test-host canvas');
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.8);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.1, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await cameraPosition(page))[2]).toBeLessThan(0);
  await page.evaluate(() => (window as unknown as { cameraTest: { resetView(): void } }).cameraTest.resetView());
  await expect.poll(async () => Math.max(...(await cameraPosition(page)).map((value, i) => Math.abs(value - initial[i])))).toBeLessThan(1e-8);
});

test('touch rotation can reach below the arm and reset the view', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, hasTouch: true, viewport: { width: 800, height: 600 } });
  const page = await context.newPage();
  try {
    await page.goto('/');
    await ready(page);
    const initial = await installCameraScene(page, false);
    const client = await context.newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 250, y: 320 }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 250, y: 40 }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => (await cameraPosition(page))[2]).toBeLessThan(0);
    await page.evaluate(() => (window as unknown as { cameraTest: { resetView(): void } }).cameraTest.resetView());
    await expect.poll(async () => Math.max(...(await cameraPosition(page)).map((value, i) => Math.abs(value - initial[i])))).toBeLessThan(1e-8);
  } finally { await context.close(); }
});
