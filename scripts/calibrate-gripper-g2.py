#!/usr/bin/env python3
"""Calibrate Gripper G2 base.glb flange alignment and split anodized aluminum flange material.

Applies the verified STEP mounting-flange centering and dimensions (75.000 x 109.559 mm)
and splits the base mesh at z = 8.4 mm into:
  - Primitive 0: upper white housing shell (z > 8.4 mm)
  - Primitive 1: bottom anodized aluminum mounting flange (z <= 8.4 mm)
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import struct
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
G2_DIR = ROOT / 'public' / 'models' / 'gripper-g2'
BASE_GLB = G2_DIR / 'base.glb'
SUMS_PATH = G2_DIR / 'SHA256SUMS'

FLANGE_Z_SPLIT = 0.0084

WHITE_HOUSING_MATERIAL = {
    'pbrMetallicRoughness': {
        'baseColorFactor': [1.0, 1.0, 1.0, 1.0],
        'metallicFactor': 0.0,
        'roughnessFactor': 0.5,
    },
    'emissiveFactor': [0.0, 0.0, 0.0],
    'alphaMode': 'OPAQUE',
    'alphaCutoff': 0.5,
    'doubleSided': True,
}

ANODIZED_ALUMINUM_MATERIAL = {
    'pbrMetallicRoughness': {
        'baseColorFactor': [0.9529411764705883, 0.9529411764705883, 0.9490196078431372, 1.0],
        'metallicFactor': 0.8,
        'roughnessFactor': 0.640130877494812,
    },
    'emissiveFactor': [0.0, 0.0, 0.0],
    'alphaMode': 'OPAQUE',
    'alphaCutoff': 0.5,
    'doubleSided': True,
}


def load_glb_geometry(path: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray, list[int]]:
    raw = path.read_bytes()
    json_len = struct.unpack_from('<I', raw, 12)[0]
    gltf = json.loads(raw[20 : 20 + json_len])
    bin_buf = raw[20 + json_len + 8 :]

    all_pos = []
    all_norm = []
    all_faces = []
    prim_vert_counts: list[int] = []
    vert_offset = 0

    for prim in gltf['meshes'][0]['primitives']:
        pos_acc = gltf['accessors'][prim['attributes']['POSITION']]
        pos_bv = gltf['bufferViews'][pos_acc['bufferView']]
        pos = np.frombuffer(
            bin_buf,
            dtype='<f4',
            count=pos_acc['count'] * 3,
            offset=pos_bv.get('byteOffset', 0) + pos_acc.get('byteOffset', 0),
        ).reshape(-1, 3).astype(np.float64).copy()

        norm_acc = gltf['accessors'][prim['attributes']['NORMAL']]
        norm_bv = gltf['bufferViews'][norm_acc['bufferView']]
        norm = np.frombuffer(
            bin_buf,
            dtype='<f4',
            count=norm_acc['count'] * 3,
            offset=norm_bv.get('byteOffset', 0) + norm_acc.get('byteOffset', 0),
        ).reshape(-1, 3).astype(np.float32).copy()

        idx_acc = gltf['accessors'][prim['indices']]
        idx_bv = gltf['bufferViews'][idx_acc['bufferView']]
        faces = np.frombuffer(
            bin_buf,
            dtype='<u4',
            count=idx_acc['count'],
            offset=idx_bv.get('byteOffset', 0) + idx_acc.get('byteOffset', 0),
        ).reshape(-1, 3).astype(np.uint32).copy() + vert_offset

        all_pos.append(pos)
        all_norm.append(norm)
        all_faces.append(faces)
        prim_vert_counts.append(len(pos))
        vert_offset += len(pos)

    return np.vstack(all_pos), np.vstack(all_norm), np.vstack(all_faces), prim_vert_counts


def calibrate_positions(pos: np.ndarray, prim_vert_counts: list[int]) -> tuple[np.ndarray, np.ndarray]:
    out = pos.copy()
    if len(prim_vert_counts) == 1 and out[:, 0].min() < -0.040:
        out += np.array([0.0054832734, 0.0014903322, 0.0000595873], dtype=np.float64)
        shell_vert_mask = out[:, 2] > FLANGE_Z_SPLIT
        out[shell_vert_mask, 2] -= 0.0003601400
        out[:, 0] *= 0.037500 / np.abs(out[:, 0]).max()
        out[:, 1] *= 0.0547795 / np.abs(out[:, 1]).max()
    elif len(prim_vert_counts) == 2:
        shell_vert_mask = np.zeros(len(out), dtype=bool)
        shell_vert_mask[: prim_vert_counts[0]] = True
    else:
        shell_vert_mask = out[:, 2] > FLANGE_Z_SPLIT
    return out, shell_vert_mask


def extract_submesh(
    pos: np.ndarray,
    norm: np.ndarray,
    faces: np.ndarray,
    face_mask: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    sub_faces = faces[face_mask]
    unique_verts, inverse = np.unique(sub_faces, return_inverse=True)
    remapped_faces = inverse.reshape(-1, 3).astype('<u4')
    sub_pos = pos[unique_verts].astype('<f4')
    sub_norm = norm[unique_verts].astype('<f4')
    return remapped_faces, sub_pos, sub_norm


def build_calibrated_glb(
    pos: np.ndarray,
    norm: np.ndarray,
    faces: np.ndarray,
    shell_vert_mask: np.ndarray,
) -> bytes:
    tri_in_shell = shell_vert_mask[faces]
    shell_face_mask = np.all(tri_in_shell, axis=1)
    flange_face_mask = np.all(~tri_in_shell, axis=1)
    if int(flange_face_mask.sum() + shell_face_mask.sum()) != len(faces):
        raise RuntimeError('Unexpected triangles straddling z = 8.4 mm split plane')

    shell_faces, shell_pos, shell_norm = extract_submesh(pos, norm, faces, shell_face_mask)
    flange_faces, flange_pos, flange_norm = extract_submesh(pos, norm, faces, flange_face_mask)

    chunks: list[bytes] = []
    buffer_views: list[dict] = []
    accessors: list[dict] = []
    offset = 0

    def add_Part(part_faces: np.ndarray, part_pos: np.ndarray, part_norm: np.ndarray) -> tuple[int, int, int]:
        nonlocal offset
        idx_bytes = part_faces.tobytes()
        pos_bytes = part_pos.tobytes()
        norm_bytes = part_norm.tobytes()

        idx_bv = len(buffer_views)
        buffer_views.append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(idx_bytes)})
        chunks.append(idx_bytes)
        offset += len(idx_bytes)

        pos_bv = len(buffer_views)
        buffer_views.append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(pos_bytes)})
        chunks.append(pos_bytes)
        offset += len(pos_bytes)

        norm_bv = len(buffer_views)
        buffer_views.append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(norm_bytes)})
        chunks.append(norm_bytes)
        offset += len(norm_bytes)

        idx_acc = len(accessors)
        accessors.append({
            'componentType': 5125,
            'type': 'SCALAR',
            'bufferView': idx_bv,
            'count': int(part_faces.size),
            'max': [int(part_faces.max())],
            'min': [int(part_faces.min())],
        })

        pos_acc = len(accessors)
        accessors.append({
            'componentType': 5126,
            'type': 'VEC3',
            'byteOffset': 0,
            'bufferView': pos_bv,
            'count': int(len(part_pos)),
            'max': [float(v) for v in part_pos.max(axis=0)],
            'min': [float(v) for v in part_pos.min(axis=0)],
        })

        norm_acc = len(accessors)
        accessors.append({
            'componentType': 5126,
            'type': 'VEC3',
            'byteOffset': 0,
            'bufferView': norm_bv,
            'count': int(len(part_norm)),
            'max': [float(v) for v in part_norm.max(axis=0)],
            'min': [float(v) for v in part_norm.min(axis=0)],
        })

        return idx_acc, pos_acc, norm_acc

    shell_idx, shell_pos_acc, shell_norm_acc = add_Part(shell_faces, shell_pos, shell_norm)
    flange_idx, flange_pos_acc, flange_norm_acc = add_Part(flange_faces, flange_pos, flange_norm)

    bin_body = b''.join(chunks)
    while len(bin_body) % 4 != 0:
        bin_body += b'\x00'

    gltf = {
        'scene': 0,
        'scenes': [{'nodes': [0]}],
        'asset': {'version': '2.0', 'generator': 'https://github.com/mikedh/trimesh'},
        'accessors': accessors,
        'meshes': [
            {
                'name': 'GLTF',
                'extras': {'units': 'meters', 'from_gltf_primitive': False},
                'primitives': [
                    {
                        'attributes': {'POSITION': shell_pos_acc, 'NORMAL': shell_norm_acc},
                        'indices': shell_idx,
                        'mode': 4,
                        'material': 0,
                    },
                    {
                        'attributes': {'POSITION': flange_pos_acc, 'NORMAL': flange_norm_acc},
                        'indices': flange_idx,
                        'mode': 4,
                        'material': 1,
                    },
                ],
            }
        ],
        'materials': [WHITE_HOUSING_MATERIAL, ANODIZED_ALUMINUM_MATERIAL],
        'nodes': [{'name': 'part_0', 'mesh': 0}],
        'buffers': [{'byteLength': len(bin_body)}],
        'bufferViews': buffer_views,
    }

    json_bytes = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    while len(json_bytes) % 4 != 0:
        json_bytes += b' '

    total_len = 12 + 8 + len(json_bytes) + 8 + len(bin_body)
    header = struct.pack('<4sII', b'glTF', 2, total_len)
    json_header = struct.pack('<I4s', len(json_bytes), b'JSON')
    bin_header = struct.pack('<I4s', len(bin_body), b'BIN\x00')
    return header + json_header + json_bytes + bin_header + bin_body


def update_sha256sums(new_base_hash: str) -> None:
    lines = []
    for line in SUMS_PATH.read_text(encoding='utf-8').splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        digest, path = stripped.split(None, 1)
        if path.endswith('base.glb'):
            lines.append(f'{new_base_hash}  {path}')
        else:
            lines.append(stripped)
    SUMS_PATH.write_text('\n'.join(lines) + '\n', encoding='utf-8')


def main() -> None:
    pos, norm, faces, prim_vert_counts = load_glb_geometry(BASE_GLB)
    calibrated_pos, shell_vert_mask = calibrate_positions(pos, prim_vert_counts)
    glb_bytes = build_calibrated_glb(calibrated_pos, norm, faces, shell_vert_mask)
    BASE_GLB.write_bytes(glb_bytes)
    new_hash = hashlib.sha256(glb_bytes).hexdigest()
    update_sha256sums(new_hash)
    print(f'Calibrated {BASE_GLB.relative_to(ROOT)} (sha256={new_hash})')


if __name__ == '__main__':
    main()
