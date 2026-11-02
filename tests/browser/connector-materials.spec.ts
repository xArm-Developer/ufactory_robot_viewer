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
        output[id] = { corrected, original, restored, highlighted: highlighted && candidates.every((mesh, index) => mesh.material === beforeHighlight[index]), finish: finish(candidates[id === 'lite6' ? 0 : 1]), flange: finish(flange) };
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
    expect(result[id].finish.metalness).toBeCloseTo(.8);
    const dir = id === 'lite6' ? 'lite6' : `${id}_1305`;
    const link = id === 'xarm5' ? 'link5' : id === 'xarm7' ? 'link7' : 'link6';
    expect(result[id].flange).toEqual(originalFinish(`public/models/${id}/meshes/${dir}/visual_glb/${link}.glb`, id === 'lite6' ? 'part_0' : 'part_4'));
  }
});
