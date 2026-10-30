/** Apply the AL0700 product-photo palette without changing its CAD geometry. */
import { createHash } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const modelPath = fileURLToPath(new URL('../public/models/al0700/model.glb', import.meta.url));
const binSha256 = 'edcf46c73495995b816a99417f981d5c56199389db13625dea6e7a898ff9c455';
const structureSha256 = '4e114aa2da11a96468a56363e164ac1b2d08a907256a2d06975035917756175b';
const blackParts = new Set([0, 3, 5, 7, 8, 11, 17, 18, 19, 22, 35, 43, 44, 45]);
const darkGrayParts = new Set([23, 24, 34, 39, 42]);
const palette = {
  black: { color: [0.015, 0.017, 0.019, 1], metalness: 0.28, roughness: 0.72 },
  darkGray: { color: [0.075, 0.08, 0.085, 1], metalness: 0.38, roughness: 0.62 },
  silver: { color: [0.41, 0.44, 0.46, 1], metalness: 0.50, roughness: 0.42 },
};

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function requireShape(condition, message) {
  if (!condition) throw new Error(`Unexpected AL0700 GLB: ${message}`);
}

function recolor(bytes) {
  requireShape(bytes.length >= 28, 'file is too short');
  requireShape(bytes.toString('ascii', 0, 4) === 'glTF' && bytes.readUInt32LE(4) === 2, 'expected glTF 2.0');
  requireShape(bytes.readUInt32LE(8) === bytes.length, 'header length does not match file');

  const jsonLength = bytes.readUInt32LE(12);
  const binHeader = 20 + jsonLength;
  requireShape(bytes.toString('ascii', 16, 20) === 'JSON' && binHeader + 8 <= bytes.length, 'expected JSON chunk first');
  const binLength = bytes.readUInt32LE(binHeader);
  requireShape(bytes.toString('ascii', binHeader + 4, binHeader + 8) === 'BIN\0', 'expected BIN chunk second');
  requireShape(binHeader + 8 + binLength === bytes.length, 'unexpected trailing data');
  const binChunk = bytes.subarray(binHeader + 8);
  requireShape(sha256(binChunk) === binSha256, 'binary geometry differs from the verified CAD conversion');

  const gltf = JSON.parse(bytes.toString('utf8', 20, binHeader));
  const { materials, ...structure } = gltf;
  requireShape(sha256(JSON.stringify(structure)) === structureSha256, 'nodes, transforms, meshes, or accessors changed');
  requireShape(Array.isArray(materials) && materials.length === 51, 'expected 51 materials');
  requireShape(blackParts.size === 14 && darkGrayParts.size === 5 &&
    [...blackParts].every(index => index >= 0 && index < 51 && !darkGrayParts.has(index)) &&
    [...darkGrayParts].every(index => index >= 0 && index < 51), 'invalid palette index list');

  const seenParts = new Set();
  const seenMaterials = new Set();
  for (const node of gltf.nodes) {
    if (!node.name?.startsWith('part_')) continue;
    const match = /^part_(\d{2})$/.exec(node.name);
    requireShape(match, `invalid part name ${node.name}`);
    const partIndex = Number(match[1]);
    requireShape(partIndex < 51 && !seenParts.has(partIndex), `duplicate or out-of-range ${node.name}`);
    requireShape(node.extras?.sourceMeshIndex === partIndex, `source index mismatch for ${node.name}`);
    const primitives = gltf.meshes[node.mesh]?.primitives;
    requireShape(primitives?.length === 1, `expected one primitive for ${node.name}`);
    const materialIndex = primitives[0].material;
    requireShape(Number.isInteger(materialIndex) && materialIndex >= 0 && materialIndex < materials.length &&
      !seenMaterials.has(materialIndex), `material missing or shared by ${node.name}`);
    const pbr = materials[materialIndex].pbrMetallicRoughness;
    requireShape(pbr, `PBR material missing for ${node.name}`);

    const finish = palette[blackParts.has(partIndex) ? 'black' : darkGrayParts.has(partIndex) ? 'darkGray' : 'silver'];
    pbr.baseColorFactor = finish.color;
    pbr.metallicFactor = finish.metalness;
    pbr.roughnessFactor = finish.roughness;
    seenParts.add(partIndex);
    seenMaterials.add(materialIndex);
  }
  requireShape(seenParts.size === 51 && seenMaterials.size === 51, 'not all 51 parts and materials were mapped');

  const jsonBytes = Buffer.from(JSON.stringify(gltf));
  const paddedJsonLength = Math.ceil(jsonBytes.length / 4) * 4;
  const output = Buffer.alloc(20 + paddedJsonLength + 8 + binLength, 0x20);
  bytes.copy(output, 0, 0, 12);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(paddedJsonLength, 12);
  output.write('JSON', 16, 'ascii');
  jsonBytes.copy(output, 20);
  bytes.copy(output, 20 + paddedJsonLength, binHeader);
  requireShape(sha256(output.subarray(20 + paddedJsonLength + 8)) === binSha256, 'binary chunk changed during export');
  return output;
}

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
  throw new Error('Usage: node scripts/colorize-al0700.mjs [--check]');
}

const before = await readFile(modelPath);
const after = recolor(before);
if (args[0] === '--check') {
  if (!after.equals(before)) throw new Error('AL0700 palette differs; run node scripts/colorize-al0700.mjs');
  console.log(`AL0700 palette OK (${sha256(before)})`);
} else if (after.equals(before)) {
  console.log(`AL0700 palette already applied (${sha256(before)})`);
} else {
  const temporary = `${modelPath}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, after);
    await rename(temporary, modelPath);
  } finally {
    await rm(temporary, { force: true });
  }
  console.log(`AL0700 palette applied (${sha256(after)})`);
}
