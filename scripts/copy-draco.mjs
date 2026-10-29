import { copyFile, mkdir } from 'node:fs/promises';
const dir = 'public/draco';
await mkdir(dir, { recursive: true });
for (const name of ['draco_decoder.js', 'draco_wasm_wrapper.js', 'draco_decoder.wasm']) {
  await copyFile(`node_modules/three/examples/jsm/libs/draco/gltf/${name}`, `${dir}/${name}`);
}
