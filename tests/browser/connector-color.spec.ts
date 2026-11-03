import { expect, test } from '@playwright/test';

test('connector metal stays silver gray with highlights instead of washing out', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const sceneUrl = '/src/scene.ts';
    const robotsUrl = '/src/robots.ts';
    const threeUrl = '/node_modules/.vite/deps/three.js';
    const [{ RobotScene }, { getRobotSpec }, THREE] = await Promise.all([
      import(sceneUrl) as Promise<typeof import('../../src/scene')>,
      import(robotsUrl) as Promise<typeof import('../../src/robots')>,
      import(threeUrl) as Promise<typeof import('three')>,
    ]);
    const host = document.createElement('div');
    host.style.cssText = 'width: 800px; height: 800px; position: fixed; left: -9999px';
    document.body.appendChild(host);
    const scene = new RobotScene(host);
    const view = scene as unknown as {
      camera: import('three').PerspectiveCamera;
      renderer: import('three').WebGLRenderer;
      scene: import('three').Scene;
    };
    const specs = {
      xarm5: { link: 'link5', center: [-.001224, -.046225, -.017983], axis: [0, -1, 0], roi: [420, 310, 65, 175] },
      xarm6: { link: 'link6', center: [-.000248, -.046, -.017979], axis: [0, -1, 0], roi: [420, 310, 65, 175] },
      xarm7: { link: 'link7', center: [-.000317, -.0462, -.018046], axis: [0, -1, 0], roi: [420, 310, 65, 175] },
      lite6: { link: 'link6', center: [.000076, .040, -.009], axis: [0, 1, 0], roi: [415, 325, 55, 145] },
      uf850: { link: 'link6', center: [.02, -.034641, -.0184], axis: [.5, -.8660254, 0], roi: [290, 310, 60, 170] },
    } as const;
    const output: Record<string, { mean: number[]; p10: number; p90: number }> = {};
    try {
      for (const id of ['xarm5', 'xarm6', 'xarm7', 'lite6', 'uf850'] as const) {
        const robot = (await scene.load(getRobotSpec(id)))!;
        const { link: linkName, center, axis, roi } = specs[id];
        const link = robot.links[linkName];
        const visual = link.children.find(child => (child as import('three').Object3D & { isURDFVisual?: boolean }).isURDFVisual)!;
        robot.traverse(object => {
          if ((object as import('three').Mesh).isMesh && !visual.getObjectById(object.id)) object.visible = false;
        });
        link.updateWorldMatrix(true, true);
        const rotation = link.getWorldQuaternion(new THREE.Quaternion());
        const target = link.localToWorld(new THREE.Vector3(...center));
        const forward = new THREE.Vector3(...axis);
        const tangent = new THREE.Vector3(-forward.y, forward.x, 0);
        const offset = forward.multiplyScalar(.88).addScaledVector(tangent, .5).add(new THREE.Vector3(0, 0, .12)).normalize().multiplyScalar(.075);
        view.camera.position.copy(target).add(offset.applyQuaternion(rotation));
        view.camera.up.copy(new THREE.Vector3(0, 0, 1).applyQuaternion(rotation));
        view.camera.lookAt(target);
        view.camera.updateMatrixWorld();
        view.renderer.render(view.scene, view.camera);
        const gl = view.renderer.getContext();
        const scaleX = gl.drawingBufferWidth / 800, scaleY = gl.drawingBufferHeight / 800;
        const x = Math.round(roi[0] * scaleX), y = Math.round(roi[1] * scaleY);
        const width = Math.round(roi[2] * scaleX), height = Math.round(roi[3] * scaleY);
        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(x, gl.drawingBufferHeight - y - height, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        const luminance: number[] = [], sum = [0, 0, 0];
        for (let i = 0; i < pixels.length; i += 4) {
          luminance.push(.2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2]);
          for (let channel = 0; channel < 3; channel++) sum[channel] += pixels[i + channel];
        }
        luminance.sort((a, b) => a - b);
        output[id] = {
          mean: sum.map(value => value / luminance.length),
          p10: luminance[Math.floor(luminance.length * .1)],
          p90: luminance[Math.floor(luminance.length * .9)],
        };
      }
      return output;
    } finally {
      scene.destroy();
      host.remove();
    }
  });

  // Broad ranges calibrated from the official xArm, Lite 6 and 850 product renders;
  // the fixed local view is different, so these are not pixel-perfect comparisons.
  for (const id of ['xarm5', 'xarm6', 'xarm7', 'lite6', 'uf850'] as const) {
    const { mean, p10, p90 } = result[id];
    const average = (mean[0] + mean[1] + mean[2]) / 3;
    const [min, max] = id === 'lite6' ? [105, 175] : id === 'uf850' ? [70, 140] : [45, 110];
    expect(average, `${id}: metal should not be white or black`).toBeGreaterThan(min);
    expect(average, `${id}: metal should not be white or black`).toBeLessThan(max);
    expect(Math.max(...mean) - Math.min(...mean), `${id}: neutral silver gray`).toBeLessThan(25);
    expect(p90 - p10, `${id}: retain visible metal highlights`).toBeGreaterThan(50);
  }
});
