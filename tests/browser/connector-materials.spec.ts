import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

function originalFinish(path: string, part: string) {
  const bytes = readFileSync(path);
  const glb = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12))) as {
    nodes: { name: string; mesh?: number }[];
    meshes: { primitives: { material: number }[] }[];
    materials: { pbrMetallicRoughness: { baseColorFactor: number[]; roughnessFactor: number; metallicFactor: number } }[];
  };
  const node = glb.nodes.find(item => item.name === part)!;
  const pbr = glb.materials[glb.meshes[node.mesh!].primitives[0].material].pbrMetallicRoughness;
  return { color: pbr.baseColorFactor.slice(0, 3), roughness: pbr.roughnessFactor, metalness: pbr.metallicFactor };
}

test('connector rendering stays local to each arm and survives collision highlights and switches', async ({ page }) => {
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
    host.style.cssText = 'width: 320px; height: 320px; position: fixed; left: -9999px';
    document.body.appendChild(host);
    const scene = new RobotScene(host);
    const view = scene as unknown as {
      camera: import('three').PerspectiveCamera;
      orbit: { target: import('three').Vector3; update(): void };
      renderer: import('three').WebGLRenderer;
      scene: import('three').Scene;
    };
    const output: Record<string, {
      corrected: number; original: number; restored: number; highlighted: boolean;
      finish: { color: number[]; roughness: number; metalness: number };
      socket?: { color: number[]; roughness: number; metalness: number };
      flange: { color: number[]; roughness: number; metalness: number };
    }> = {};
    try {
      for (const id of ['xarm5', 'xarm6', 'xarm7', 'lite6'] as const) {
        const robot = (await scene.load(getRobotSpec(id)))!;
        const linkName = id === 'xarm5' ? 'link5' : id === 'xarm7' ? 'link7' : 'link6';
        const link = robot.links[linkName];
        const visual = link.children.find(child => (child as import('three').Object3D & { isURDFVisual?: boolean }).isURDFVisual)!;
        const meshes: import('three').Mesh[] = [];
        visual.traverse(object => { if ((object as import('three').Mesh).isMesh) meshes.push(object as import('three').Mesh); });
        robot.traverse(object => { if ((object as import('three').Mesh).isMesh && !meshes.includes(object as import('three').Mesh)) object.visible = false; });
        const candidates = meshes.filter(mesh => (id === 'lite6' ? ['part_1', 'part_2'] : ['part_0', 'part_1', 'part_2']).includes(mesh.name));
        const flange = meshes.find(mesh => mesh.name === (id === 'lite6' ? 'part_0' : 'part_4'))!;
        const finish = (mesh: import('three').Mesh) => {
          const material = mesh.material as import('three').MeshStandardMaterial;
          return { color: material.color.toArray(), roughness: material.roughness, metalness: material.metalness };
        };
        robot.updateWorldMatrix(true, true);
        const bounds = new THREE.Box3();
        for (const mesh of candidates) bounds.union(new THREE.Box3().setFromObject(mesh));
        const center = bounds.getCenter(new THREE.Vector3());
        const rotation = link.getWorldQuaternion(new THREE.Quaternion());
        view.camera.position.copy(center).add(new THREE.Vector3(0, id === 'lite6' ? .14 : -.14, -.04).applyQuaternion(rotation));
        view.camera.up.set(0, 0, 1).applyQuaternion(rotation);
        view.orbit.target.copy(center);
        view.orbit.update();
        const brightness = () => {
          view.renderer.render(view.scene, view.camera);
          const gl = view.renderer.getContext();
          const pixels = new Uint8Array(16 * 16 * 4);
          gl.readPixels(Math.floor(gl.drawingBufferWidth / 2) - 8, Math.floor(gl.drawingBufferHeight / 2) - 8, 16, 16, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          let sum = 0;
          for (let i = 0; i < pixels.length; i += 4) sum += pixels[i] + pixels[i + 1] + pixels[i + 2];
          return sum / (16 * 16 * 3);
        };
        const corrected = brightness();
        const originals = candidates.map(mesh => mesh.material);
        const temporary = candidates.map(mesh => {
          const material = (mesh.material as import('three').MeshStandardMaterial).clone();
          const color = id === 'lite6' ? [.79215699, .81960797, .93333298] : [1, 1, .94509798];
          material.color.setRGB(color[0], color[1], color[2]);
          material.metalness = 0;
          material.roughness = 1;
          material.envMap = null;
          material.onBeforeCompile = () => {};
          material.customProgramCacheKey = () => `original-connector-${id}`;
          mesh.material = material;
          return material;
        });
        const original = brightness();
        candidates.forEach((mesh, index) => { mesh.material = originals[index]; temporary[index].dispose(); });
        const beforeHighlight = candidates.map(mesh => mesh.material);
        scene.setCollisionHighlight([`arm:${linkName}`]);
        const highlighted = candidates.every((mesh, index) => mesh.material !== beforeHighlight[index]
          && (mesh.material as import('three').MeshStandardMaterial).color.getHex() === 0xdc2626);
        scene.clearCollisionHighlight();
        const restored = brightness();
        output[id] = { corrected, original, restored, highlighted: highlighted && candidates.every((mesh, index) => mesh.material === beforeHighlight[index]), finish: finish(candidates[id === 'lite6' ? 0 : 1]), socket: id === 'lite6' ? undefined : finish(candidates[0]), flange: finish(flange) };
      }
    } finally {
      scene.destroy();
      host.remove();
    }
    return output;
  });

  for (const id of ['xarm5', 'xarm6', 'xarm7', 'lite6'] as const) {
    expect(result[id].corrected, `${id}: connector is visibly darker`).toBeLessThan(result[id].original * .8);
    expect(result[id].restored).toBeCloseTo(result[id].corrected, 0);
    expect(result[id].highlighted).toBe(true);
    expect(result[id].finish.metalness).toBeCloseTo(.9);
    expect(result[id].finish.roughness).toBeCloseTo(.18);
    if (id !== 'lite6') {
      expect(result[id].socket!.metalness).toBe(0);
      expect(result[id].socket!.roughness).toBeCloseTo(.7);
      expect(result[id].socket!.color.every(channel => channel < .02)).toBe(true);
    }
    const dir = id === 'lite6' ? 'lite6' : `${id}_1305`;
    const link = id === 'xarm5' ? 'link5' : id === 'xarm7' ? 'link7' : 'link6';
    expect(result[id].flange).toEqual(originalFinish(`public/models/${id}/meshes/${dir}/visual_glb/${link}.glb`, id === 'lite6' ? 'part_0' : 'part_4'));
  }
});

test('xArm 5/6/7 display twelve female contacts on the dark insert', async ({ page }) => {
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
    host.style.cssText = 'width: 600px; height: 600px; position: fixed; left: -9999px';
    document.body.appendChild(host);
    const scene = new RobotScene(host);
    const view = scene as unknown as {
      camera: import('three').PerspectiveCamera;
      renderer: import('three').WebGLRenderer;
      scene: import('three').Scene;
    };
    const models = {
      xarm5: { link: 'link5', center: [-.001224, -.054155, -.017983] },
      xarm6: { link: 'link6', center: [-.000248, -.053931, -.017979] },
      xarm7: { link: 'link7', center: [-.000317, -.054131, -.018046] },
    } as const;
    const contacts = [
      [-1.40, 2.66], [-1.34, -2.65], [-2.79, 1.47], [2.10, -1.71],
      [2.07, 1.84], [2.73, 0], [-2.75, -1.40], [-1.34, 0],
      [.39, 1.01], [.43, -.90], [.58, -2.74], [.51, 2.82],
    ];
    const output: Record<string, number[][]> = {};
    try {
      for (const id of ['xarm5', 'xarm6', 'xarm7'] as const) {
        const robot = (await scene.load(getRobotSpec(id)))!;
        const { link: linkName, center } = models[id];
        const link = robot.links[linkName];
        const visual = link.children.find(child => (child as import('three').Object3D & { isURDFVisual?: boolean }).isURDFVisual)!;
        robot.traverse(object => {
          if ((object as import('three').Mesh).isMesh && !visual.getObjectById(object.id)) object.visible = false;
        });
        link.updateWorldMatrix(true, true);
        const rotation = link.getWorldQuaternion(new THREE.Quaternion());
        const target = link.localToWorld(new THREE.Vector3(...center));
        view.camera.position.copy(target).add(new THREE.Vector3(0, -.055, 0).applyQuaternion(rotation));
        view.camera.up.copy(new THREE.Vector3(0, 0, 1).applyQuaternion(rotation));
        view.camera.lookAt(target);
        view.camera.updateMatrixWorld();
        view.renderer.render(view.scene, view.camera);
        const gl = view.renderer.getContext();
        const pixel = (x: number, z: number) => {
          const point = link.localToWorld(new THREE.Vector3(x, center[1], z)).project(view.camera);
          const rgba = new Uint8Array(4);
          gl.readPixels(Math.round((point.x * .5 + .5) * gl.drawingBufferWidth), Math.round((point.y * .5 + .5) * gl.drawingBufferHeight), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
          return rgba[0];
        };
        output[id] = contacts.map(([dx, dz]) => {
          const x = center[0] + dx * .00115, z = center[2] + dz * .00115;
          return [pixel(x, z), pixel(x + .00037, z)];
        });
      }
      return output;
    } finally {
      scene.destroy();
      host.remove();
    }
  });

  for (const id of ['xarm5', 'xarm6', 'xarm7'] as const) {
    expect(result[id]).toHaveLength(12);
    for (const [bore, rim] of result[id]) {
      expect(bore).toBeLessThan(10);
      expect(rim).toBeGreaterThan(bore + 10);
    }
  }
});

test('850 preserves the metal flange and both sockets through highlight and model switches', async ({ page }) => {
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
    host.style.cssText = 'width: 600px; height: 600px; position: fixed; left: -9999px';
    document.body.appendChild(host);
    const scene = new RobotScene(host);
    const view = scene as unknown as {
      camera: import('three').PerspectiveCamera;
      renderer: import('three').WebGLRenderer;
      scene: import('three').Scene;
    };

    const prepare = async () => {
      const robot = (await scene.load(getRobotSpec('uf850')))!;
      const link = robot.links.link6;
      const visual = link.children.find(child => (child as import('three').Object3D & { isURDFVisual?: boolean }).isURDFVisual)!;
      robot.traverse(object => {
        if ((object as import('three').Mesh).isMesh && !visual.getObjectById(object.id)) object.visible = false;
      });
      const mesh = visual.getObjectByName('part_0') as import('three').Mesh;
      link.updateWorldMatrix(true, true);
      const rotation = link.getWorldQuaternion(new THREE.Quaternion());
      const center = link.localToWorld(new THREE.Vector3(.02, -.034641, -.0184));
      view.camera.position.copy(center).add(new THREE.Vector3(.5, -.8660254, 0).applyQuaternion(rotation).multiplyScalar(.075));
      view.camera.up.copy(new THREE.Vector3(0, 0, 1).applyQuaternion(rotation));
      view.camera.lookAt(center);
      view.camera.updateMatrixWorld();
      const measure = () => {
        view.renderer.render(view.scene, view.camera);
        const gl = view.renderer.getContext();
        const pixel = (tangent: number, z: number, depth: number) => {
          const projected = link.localToWorld(new THREE.Vector3(.8660254 * tangent + .5 * depth, .5 * tangent - .8660254 * depth, z)).project(view.camera);
          const x = Math.round((projected.x * .5 + .5) * gl.drawingBufferWidth);
          const y = Math.round((projected.y * .5 + .5) * gl.drawingBufferHeight);
          const rgba = new Uint8Array(4);
          gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
          return Array.from(rgba);
        };
        return {
          large: pixel(-.00845, -.0185, .0462),
          small: pixel(.0099, -.0183, .0399),
          shell: pixel(-.0152, -.0185, .0455),
          flange: pixel(0, -.027, .039),
        };
      };
      return { mesh, measure };
    };

    try {
      const { mesh, measure } = await prepare();
      const corrected = measure();
      const material = mesh.material as import('three').MeshStandardMaterial;
      const original = material.clone();
      original.envMap = null;
      original.onBeforeCompile = () => {};
      original.customProgramCacheKey = () => '850-connector-unmodified';
      mesh.material = original;
      const unmodified = measure();
      mesh.material = material;
      original.dispose();
      scene.setCollisionHighlight(['arm:link6']);
      const highlighted = measure();
      scene.clearCollisionHighlight();
      const restored = measure();
      await scene.load(getRobotSpec('xarm6'));
      const reloaded = (await prepare()).measure();
      return { corrected, unmodified, highlighted, restored, reloaded };
    } finally {
      scene.destroy();
      host.remove();
    }
  });

  for (const name of ['large', 'small'] as const) {
    expect(result.corrected[name][0], `${name} socket is dark`).toBeLessThan(30);
    expect(result.unmodified[name][0], `${name} source socket was light`).toBeGreaterThan(70);
    expect(result.highlighted[name][0]).toBeGreaterThan(result.highlighted[name][1] * 1.5);
  }
  expect(result.corrected.shell).not.toEqual(result.unmodified.shell);
  expect(result.corrected.flange).toEqual(result.unmodified.flange);
  expect(result.restored).toEqual(result.corrected);
  expect(result.reloaded).toEqual(result.corrected);
});
