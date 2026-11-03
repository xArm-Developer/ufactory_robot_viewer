import { expect, test } from '@playwright/test';

test('polished connector shells reflect light at multiple angles without changing the 850 flange', async ({ page }) => {
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
    host.style.cssText = 'width: 400px; height: 400px; position: fixed; left: -9999px';
    document.body.appendChild(host);
    const scene = new RobotScene(host);
    const view = scene as unknown as {
      camera: import('three').PerspectiveCamera;
      renderer: import('three').WebGLRenderer;
      scene: import('three').Scene;
    };
    const specs = {
      xarm5: { link: 'link5', center: [-.001224, -.048, -.01798], axis: [0, -1, 0] },
      xarm6: { link: 'link6', center: [-.000248, -.048, -.01798], axis: [0, -1, 0] },
      xarm7: { link: 'link7', center: [-.000317, -.048, -.01805], axis: [0, -1, 0] },
      lite6: { link: 'link6', center: [.000076, .040, -.009], axis: [0, 1, 0] },
      uf850: { link: 'link6', center: [.02, -.034641, -.0184], axis: [.5, -.8660254, 0] },
    } as const;
    const output: Record<string, { shell?: number; large?: number; small?: number; flange?: number }[]> = {};

    try {
      for (const id of ['xarm5', 'xarm6', 'xarm7', 'lite6', 'uf850'] as const) {
        const robot = (await scene.load(getRobotSpec(id)))!;
        const { link: linkName, center, axis } = specs[id];
        const link = robot.links[linkName];
        const visual = link.children.find(child => (child as import('three').Object3D & { isURDFVisual?: boolean }).isURDFVisual)!;
        robot.traverse(object => {
          if ((object as import('three').Mesh).isMesh && !visual.getObjectById(object.id)) object.visible = false;
        });
        const meshNames = id === 'uf850' ? ['part_0'] : ['part_1', 'part_2'];
        const materials = meshNames.map(name => (visual.getObjectByName(name) as import('three').Mesh).material as import('three').MeshStandardMaterial);
        link.updateWorldMatrix(true, true);
        const rotation = link.getWorldQuaternion(new THREE.Quaternion());
        const target = link.localToWorld(new THREE.Vector3(...center));
        const gl = view.renderer.getContext();
        const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
        const results = [];
        for (const side of [0, .5]) {
          const forward = new THREE.Vector3(...axis);
          const tangent = new THREE.Vector3(-forward.y, forward.x, 0);
          const offset = forward.multiplyScalar(.88).addScaledVector(tangent, side).add(new THREE.Vector3(0, 0, .12)).normalize().multiplyScalar(.075);
          view.camera.position.copy(target).add(offset.applyQuaternion(rotation));
          view.camera.up.copy(new THREE.Vector3(0, 0, 1).applyQuaternion(rotation));
          view.camera.lookAt(target);
          view.camera.updateMatrixWorld();
          const pixels = () => {
            view.renderer.render(view.scene, view.camera);
            const out = new Uint8Array(width * height * 4);
            gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, out);
            return out;
          };
          const reflected = pixels();
          const intensities = materials.map(material => material.envMapIntensity);
          for (const material of materials) material.envMapIntensity = 0;
          const unreflected = pixels();
          materials.forEach((material, index) => { material.envMapIntensity = intensities[index]; });
          const changed = (point: import('three').Vector3, radius: number) => {
            const cx = Math.round((point.x * .5 + .5) * width), cy = Math.round((point.y * .5 + .5) * height);
            let count = 0;
            for (let y = Math.max(0, cy - radius); y < Math.min(height, cy + radius); y++) {
              for (let x = Math.max(0, cx - radius); x < Math.min(width, cx + radius); x++) {
                const i = (y * width + x) * 4;
                const difference = Math.abs(reflected[i] - unreflected[i]) + Math.abs(reflected[i + 1] - unreflected[i + 1]) + Math.abs(reflected[i + 2] - unreflected[i + 2]);
                if (difference > 30) count++;
              }
            }
            return count;
          };
          const project850 = (tangent: number, z: number, depth: number) => link.localToWorld(
            new THREE.Vector3(.8660254 * tangent + .5 * depth, .5 * tangent - .8660254 * depth, z),
          ).project(view.camera);
          results.push(id === 'uf850' ? {
            large: changed(project850(-.00845, -.0185, .0455), 55),
            small: changed(project850(.0099, -.0183, .0399), 40),
            flange: changed(project850(0, -.03, .039), 10),
          } : { shell: changed(new THREE.Vector3(0, 0, 0), 100) });
        }
        output[id] = results;
      }
      return output;
    } finally {
      scene.destroy();
      host.remove();
    }
  });

  for (const id of ['xarm5', 'xarm6', 'xarm7', 'lite6'] as const) {
    for (const angle of result[id]) expect(angle.shell, `${id} should reflect at both angles`).toBeGreaterThan(500);
  }
  for (const angle of result.uf850) {
    expect(angle.large).toBeGreaterThan(500);
    expect(angle.small).toBeGreaterThan(500);
    expect(angle.flange).toBe(0);
  }
});
