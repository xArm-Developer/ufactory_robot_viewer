/** Apply the AI1500 anodized-aluminum product palette without changing its CAD geometry. */
import { createHash } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const modelPath = fileURLToPath(new URL('../public/models/ai1500/model.glb', import.meta.url));
const binSha256 = 'd04549986d3cf50458c543d0d243163e1730321f143d5639d3f953455c5fa572';
const structureSha256 = '6fcd701978b279146061e7fd413d7fd420b65986be1bb9531f8dbaee52a74395';

const partGroups = {
  silverAnodized: new Set([1, 2]),
  blackAnodized: new Set([10, 12, 14]),
  stainless: new Set([0, 3, 5, 7, 11, 13]),
  connector: new Set([4, 9]),
  contactGold: new Set([6, 8]),
};

// silverAnodized matches the official xArm / 850 anodized aluminum flange PBR material;
// blackAnodized shares the same metallic/roughness sheen for the dyed middle housing.
const palette = {
  silverAnodized: { color: [0.952941, 0.952941, 0.94902, 1], metalness: 0.8, roughness: 0.634245 },
  blackAnodized: { color: [0.09, 0.094, 0.1, 1], metalness: 0.8, roughness: 0.634245 },
  stainless: { color: [0.96, 0.965, 0.97, 1], metalness: 0.78, roughness: 0.48 },
  connector: { color: [0.045, 0.048, 0.052, 1], metalness: 0.1, roughness: 0.72 },
  contactGold: { color: [0.83, 0.64, 0.24, 1], metalness: 0.8, roughness: 0.38 },
};

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function requireShape(condition, message) {
  if (!condition) throw new Error(`Unexpected AI1500 GLB: ${message}`);
}

function validatePartGroups() {
  const assigned = new Set();
  for (const [groupName, indices] of Object.entries(partGroups)) {
    requireShape(palette[groupName], `missing palette entry for ${groupName}`);
    for (const index of indices) {
      requireShape(Number.isInteger(index) && index >= 0 && index < 15 && !assigned.has(index),
        `duplicate or out-of-range part index ${index}`);
      assigned.add(index);
    }
  }
  requireShape(assigned.size === 15, 'part groups must partition all 15 parts');
}

function finishForPart(partIndex) {
  for (const [groupName, indices] of Object.entries(partGroups)) {
    if (indices.has(partIndex)) return palette[groupName];
  }
  throw new Error(`Unmapped AI1500 part index ${partIndex}`);
}

function recolor(bytes) {
  validatePartGroups();
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
  requireShape(Array.isArray(materials) && materials.length === 15, 'expected 15 materials');

  const seenParts = new Set();
  const seenMaterials = new Set();
  for (const node of gltf.nodes) {
    if (!node.name?.startsWith('part_')) continue;
    const match = /^part_(\d{2})$/.exec(node.name);
    requireShape(match, `invalid part name ${node.name}`);
    const partIndex = Number(match[1]);
    requireShape(partIndex < 15 && !seenParts.has(partIndex), `duplicate or out-of-range ${node.name}`);
    requireShape(node.extras?.sourceMeshIndex === partIndex, `source index mismatch for ${node.name}`);
    const primitives = gltf.meshes[node.mesh]?.primitives;
    requireShape(primitives?.length === 1, `expected one primitive for ${node.name}`);
    const materialIndex = primitives[0].material;
    requireShape(Number.isInteger(materialIndex) && materialIndex >= 0 && materialIndex < materials.length &&
      !seenMaterials.has(materialIndex), `material missing or shared by ${node.name}`);
    requireShape(materials[materialIndex]?.pbrMetallicRoughness, `PBR material missing for ${node.name}`);

    const finish = finishForPart(partIndex);
    materials[materialIndex] = {
      pbrMetallicRoughness: {
        baseColorFactor: finish.color,
        metallicFactor: finish.metalness,
        roughnessFactor: finish.roughness,
      },
      doubleSided: true,
    };
    seenParts.add(partIndex);
    seenMaterials.add(materialIndex);
  }
  requireShape(seenParts.size === 15 && seenMaterials.size === 15, 'not all 15 parts and materials were mapped');

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
  throw new Error('Usage: node scripts/colorize-ai1500.mjs [--check]');
}

const before = await readFile(modelPath);
const after = recolor(before);
if (args[0] === '--check') {
  if (!after.equals(before)) throw new Error('AI1500 palette differs; run node scripts/colorize-ai1500.mjs');
  console.log(`AI1500 palette OK (${sha256(before)})`);
} else if (after.equals(before)) {
  console.log(`AI1500 palette already applied (${sha256(before)})`);
} else {
  const temporary = `${modelPath}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, after);
    await rename(temporary, modelPath);
  } finally {
    await rm(temporary, { force: true });
  }
  console.log(`AI1500 palette applied (${sha256(after)})`);
}
