"""Build compact, deterministic convex-hull collision manifests for all 11 models.

Run with:
  python scripts/build-collision-hulls.py
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import struct
import xml.etree.ElementTree as ET

import numpy as np
from scipy.spatial import ConvexHull

ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = ROOT / 'public' / 'models'
GENESIS_URDF_DIR = Path(
    os.environ.get('UFACTORY_GENESIS_URDF_DIR', ROOT.parent / 'ufactory_genesis' / 'assets' / 'urdf')
)

SENSOR_FLANGE_CAD = np.array([-0.00424, 0.00668, 0.0657], dtype=np.float64)
BIO_LEFT_VISUAL_Y = 0.00695659220219
BIO_RIGHT_VISUAL_Y = -0.00811730325222
DRAG_CHAIN_BEND_END_Z = 0.12437742


def read_binary_stl(path: Path) -> np.ndarray:
    raw = path.read_bytes()
    tri_count = struct.unpack_from('<I', raw, 80)[0]
    expected_len = 84 + tri_count * 50
    if len(raw) == expected_len:
        dtype = np.dtype([('normal', '<3f4'), ('verts', '<9f4'), ('attr', '<u2')])
        tris = np.frombuffer(raw, dtype=dtype, offset=84, count=tri_count)
        return tris['verts'].reshape(-1, 3).astype(np.float64)
    # Fallback for ASCII STL if ever encountered
    verts = []
    for line in raw.decode('utf-8', errors='ignore').splitlines():
        stripped = line.strip()
        if stripped.startswith('vertex '):
            parts = stripped.split()
            verts.append([float(parts[1]), float(parts[2]), float(parts[3])])
    return np.asarray(verts, dtype=np.float64)


def read_uncompressed_glb_nodes(path: Path) -> tuple[dict, dict[int, np.ndarray]]:
    raw = path.read_bytes()
    json_len = struct.unpack_from('<I', raw, 12)[0]
    gltf = json.loads(raw[20 : 20 + json_len])
    bin_buf = raw[20 + json_len + 8 :]
    node_points: dict[int, np.ndarray] = {}
    for idx, node in enumerate(gltf.get('nodes', [])):
        if 'mesh' not in node:
            continue
        prim_arrays = []
        for prim in gltf['meshes'][node['mesh']]['primitives']:
            acc = gltf['accessors'][prim['attributes']['POSITION']]
            bv = gltf['bufferViews'][acc['bufferView']]
            offset = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
            stride = bv.get('byteStride', 12)
            arr = np.ndarray(
                (acc['count'], 3),
                dtype='<f4',
                buffer=bin_buf,
                offset=offset,
                strides=(stride, 4),
            ).astype(np.float64)
            prim_arrays.append(arr)
        node_points[idx] = np.vstack(prim_arrays)
    return gltf, node_points


def collect_subtree_points(gltf: dict, node_points: dict[int, np.ndarray], root_idx: int) -> dict[str, np.ndarray]:
    out: dict[str, np.ndarray] = {}

    def visit(idx: int) -> None:
        node = gltf['nodes'][idx]
        if idx in node_points:
            out[node.get('name', f'node_{idx}')] = node_points[idx]
        for child in node.get('children', []):
            visit(child)

    visit(root_idx)
    return out


def sample_directions(num_fib: int = 56) -> np.ndarray:
    dirs = []
    # Axis + face/corner diagonals (26 canonical directions)
    for dx in (-1.0, 0.0, 1.0):
        for dy in (-1.0, 0.0, 1.0):
            for dz in (-1.0, 0.0, 1.0):
                if dx == 0.0 and dy == 0.0 and dz == 0.0:
                    continue
                v = np.array([dx, dy, dz], dtype=np.float64)
                dirs.append(v / np.linalg.norm(v))
    # Deterministic Fibonacci sphere directions
    golden = np.pi * (3.0 - np.sqrt(5.0))
    for i in range(num_fib):
        y = 1.0 - (2.0 * (i + 0.5)) / num_fib
        r = np.sqrt(max(0.0, 1.0 - y * y))
        theta = golden * i
        dirs.append(np.array([np.cos(theta) * r, y, np.sin(theta) * r], dtype=np.float64))
    return np.vstack(dirs)


AXES_6 = np.array(
    [[1.0, 0.0, 0.0], [-1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, -1.0, 0.0], [0.0, 0.0, 1.0], [0.0, 0.0, -1.0]],
    dtype=np.float64,
)
CANON_26 = sample_directions(0)
DIRECTIONS_64 = 48
DIRECTIONS_96 = 46


def exact_hull_vertices(points: np.ndarray, max_dirs: int | None = None, tol: float = 0.0004) -> list[float]:
    max_verts = max_dirs if max_dirs is not None else 64
    quantized = np.round(points, 5)
    _, unique_idx = np.unique(quantized, axis=0, return_index=True)
    pts = points[np.sort(unique_idx)]
    hull = ConvexHull(pts)
    hull_pts = pts[hull.vertices]

    if len(hull_pts) > 10:
        seed_idx = list(np.unique(np.argmax(hull_pts @ AXES_6.T, axis=0)))
        for cand in np.unique(np.argmax(hull_pts @ CANON_26.T, axis=0)):
            if len(seed_idx) >= 4:
                try:
                    ConvexHull(hull_pts[seed_idx])
                    break
                except Exception:
                    pass
            if int(cand) not in seed_idx:
                seed_idx.append(int(cand))

        while len(seed_idx) < min(len(hull_pts), max_verts):
            sub = ConvexHull(hull_pts[seed_idx])
            normals = sub.equations[:, :3]
            d_f = -sub.equations[:, 3]
            gaps = (hull_pts @ normals.T) - d_f[None, :]
            max_per_face = gaps.max(axis=0)
            worst_face = int(np.argmax(max_per_face))
            if max_per_face[worst_face] <= tol:
                break
            best_v = int(np.argmax(gaps[:, worst_face]))
            if best_v in seed_idx:
                break
            seed_idx.append(best_v)

        sub_pts = hull_pts[seed_idx]
        hull_pts = sub_pts[ConvexHull(sub_pts).vertices]

    # Canonical lexicographic sort at 0.05 mm / 4-decimal precision for deterministic compact JSON
    rounded = np.round(hull_pts, 4)
    rounded[np.abs(rounded) < 1e-9] = 0.0
    _, uniq_rounded = np.unique(rounded, axis=0, return_index=True)
    rounded = rounded[np.sort(uniq_rounded)]
    order = np.lexsort((rounded[:, 2], rounded[:, 1], rounded[:, 0]))
    sorted_pts = rounded[order]
    assert len(sorted_pts) >= 4, f'Expected >= 4 hull vertices, got {len(sorted_pts)}'
    return [round(float(x), 4) for x in sorted_pts.reshape(-1)]


def polytope_entry(body_key: str, points: np.ndarray, *, part_key: str | None = None, dirs: np.ndarray | None = None) -> dict:
    entry: dict = {
        'bodyKey': body_key,
    }
    if part_key is not None:
        entry['partKey'] = part_key
    entry['kind'] = 'polytope'
    entry['vertices'] = exact_hull_vertices(points, max_dirs=dirs)
    return entry


def box_entry(body_key: str, center: list[float], size: list[float], *, part_key: str | None = None) -> dict:
    entry: dict = {
        'bodyKey': body_key,
    }
    if part_key is not None:
        entry['partKey'] = part_key
    entry['kind'] = 'box'
    entry['center'] = [round(float(c), 6) for c in center]
    entry['halfExtents'] = [round(float(s) * 0.5, 6) for s in size]
    return entry


def build_arm_manifest(arm_id: str) -> dict:
    urdf_path = MODELS_DIR / arm_id / f'{arm_id}.urdf'
    root = ET.parse(urdf_path).getroot()
    genesis_arm_dir = GENESIS_URDF_DIR / arm_id
    hulls = []
    for link in root.findall('link'):
        link_name = link.attrib['name']
        for col in link.findall('collision'):
            mesh_el = col.find('geometry/mesh')
            if mesh_el is None:
                continue
            origin = col.find('origin')
            if origin is not None:
                assert origin.attrib.get('xyz', '0 0 0') == '0 0 0'
                assert origin.attrib.get('rpy', '0 0 0') == '0 0 0'
            rel_mesh = mesh_el.attrib['filename']
            stl_path = genesis_arm_dir / rel_mesh
            assert stl_path.is_file(), f'Missing reference collision STL: {stl_path}'
            pts = read_binary_stl(stl_path)
            hulls.append(polytope_entry(link_name, pts, dirs=DIRECTIONS_96))
    return {'schemaVersion': 1, 'assetId': arm_id, 'hulls': hulls}


def build_bio_gripper_manifest() -> dict:
    col_dir = GENESIS_URDF_DIR / 'bio_gripper_g2' / 'meshes' / 'collision'
    hulls = []
    base_pts = read_binary_stl(col_dir / 'bio_gripper_g2_base_link_convex_0.stl')
    hulls.append(polytope_entry('base', base_pts, part_key='bio_gripper_g2_base', dirs=DIRECTIONS_96))

    for idx in (0, 1):
        l_pts = read_binary_stl(col_dir / f'bio_gripper_g2_left_finger_convex_{idx}.stl').copy()
        l_pts[:, 1] -= BIO_LEFT_VISUAL_Y
        hulls.append(polytope_entry('left', l_pts, part_key='bio_gripper_g2_left_finger', dirs=DIRECTIONS_96))

    for idx in (0, 1):
        r_pts = read_binary_stl(col_dir / f'bio_gripper_g2_right_finger_convex_{idx}.stl').copy()
        r_pts[:, 1] -= BIO_RIGHT_VISUAL_Y
        hulls.append(polytope_entry('right', r_pts, part_key='bio_gripper_g2_right_finger', dirs=DIRECTIONS_96))

    return {'schemaVersion': 1, 'assetId': 'bio-gripper-g2', 'hulls': hulls}


def build_gripper_g2_manifest() -> dict:
    g2_dir = MODELS_DIR / 'gripper-g2'
    hulls = []

    def load_pts(name: str) -> np.ndarray:
        _, node_pts = read_uncompressed_glb_nodes(g2_dir / f'{name}.glb')
        return np.vstack(list(node_pts.values()))

    # Base: split main housing (z <= 0.068) from left/right mounting ears (z >= 0.060) to avoid bridging ear slot
    base_pts = load_pts('base')
    hulls.append(polytope_entry('base', base_pts[base_pts[:, 2] <= 0.068], part_key='base', dirs=DIRECTIONS_64))
    upper = base_pts[base_pts[:, 2] >= 0.060]
    hulls.append(polytope_entry('base', upper[upper[:, 1] >= 0.0], part_key='base', dirs=DIRECTIONS_64))
    hulls.append(polytope_entry('base', upper[upper[:, 1] <= 0.0], part_key='base', dirs=DIRECTIONS_64))

    for side, body_key in (('left', 'left'), ('right', 'right')):
        for knuckle in (f'{side}_outer_knuckle', f'{side}_inner_knuckle'):
            pts = load_pts(knuckle)
            hulls.append(polytope_entry(body_key, pts, part_key=knuckle, dirs=DIRECTIONS_64))
        # L-shaped finger: split knuckle lug (z <= 0.020) and vertical jaw pad (z >= 0.015)
        f_pts = load_pts(f'{side}_finger')
        hulls.append(polytope_entry(body_key, f_pts[f_pts[:, 2] <= 0.020], part_key=f'{side}_finger', dirs=DIRECTIONS_64))
        hulls.append(polytope_entry(body_key, f_pts[f_pts[:, 2] >= 0.015], part_key=f'{side}_finger', dirs=DIRECTIONS_64))

    return {'schemaVersion': 1, 'assetId': 'gripper-g2', 'hulls': hulls}


def build_lite6_gripper_manifest() -> dict:
    shell_stl = GENESIS_URDF_DIR / 'lite6_gripper' / 'meshes' / 'collision' / 'shell.stl'
    shell_pts = read_binary_stl(shell_stl)
    hulls = [
        polytope_entry('base', shell_pts, part_key='shell', dirs=160),
        # Exact analytical boxes from lite6_gripper_movable_visual.glb.urdf
        box_entry('left', [0.0, 0.00775, 0.002], [0.02, 0.0155, 0.0095], part_key='finger1'),
        box_entry('left', [0.0, 0.013375, 0.016875], [0.02, 0.00425, 0.01975], part_key='finger1'),
        box_entry('right', [0.0, -0.00775, 0.002], [0.02, 0.0155, 0.0095], part_key='finger2'),
        box_entry('right', [0.0, -0.013375, 0.016875], [0.02, 0.00425, 0.01975], part_key='finger2'),
    ]
    return {'schemaVersion': 1, 'assetId': 'lite6-gripper', 'hulls': hulls}


def build_lite6_vacuum_manifest() -> dict:
    vac_stl = GENESIS_URDF_DIR / 'lite6_vacuum_gripper' / 'meshes' / 'visual' / 'vacuum_gripper_lite.stl'
    pts = read_binary_stl(vac_stl)
    # Split main cylinder body (z <= 0.046) from narrower front suction cup assembly (z >= 0.044)
    hulls = [
        polytope_entry('base', pts[pts[:, 2] <= 0.046], part_key='vacuum', dirs=DIRECTIONS_64),
        polytope_entry('base', pts[pts[:, 2] >= 0.044], part_key='vacuum', dirs=DIRECTIONS_64),
    ]
    return {'schemaVersion': 1, 'assetId': 'lite6-vacuum-gripper', 'hulls': hulls}


def build_ai1500_manifest() -> dict:
    _, node_pts = read_uncompressed_glb_nodes(MODELS_DIR / 'ai1500' / 'model.glb')
    pts = np.vstack(list(node_pts.values())) - SENSOR_FLANGE_CAD
    hulls = [polytope_entry('ai1500', pts, dirs=DIRECTIONS_64)]
    return {'schemaVersion': 1, 'assetId': 'ai1500', 'hulls': hulls}


def build_al0700_manifest() -> dict:
    gltf, node_pts = read_uncompressed_glb_nodes(MODELS_DIR / 'al0700' / 'model.glb')
    name_to_idx = {n.get('name'): idx for idx, n in enumerate(gltf['nodes']) if 'name' in n}
    fixed_parts = collect_subtree_points(gltf, node_pts, name_to_idx['rail_fixed'])
    carriage_parts = collect_subtree_points(gltf, node_pts, name_to_idx['rail_carriage'])

    def merge_parts(mapping: dict[str, np.ndarray], indices: list[int]) -> np.ndarray:
        return np.vstack([mapping[f'part_{i:02d}'] for i in indices])

    hulls = [
        # rail_fixed sub-assemblies (excluding dynamic drag chain part_35)
        polytope_entry('fixed', merge_parts(fixed_parts, [0, 3, 6, 11, 13, 16, 17, 21]), dirs=DIRECTIONS_64),
        polytope_entry('fixed', merge_parts(fixed_parts, [5]), dirs=DIRECTIONS_64),
        polytope_entry('fixed', merge_parts(fixed_parts, [7]), dirs=DIRECTIONS_64),
        polytope_entry('fixed', merge_parts(fixed_parts, [1, 2, 4, 14, 15, 18, 19]), dirs=DIRECTIONS_64),
        polytope_entry('fixed', merge_parts(fixed_parts, [8, 9, 10, 12, 20, 22, 43, 44, 45]), dirs=DIRECTIONS_64),
        polytope_entry('fixed', merge_parts(fixed_parts, [23, 24]), dirs=DIRECTIONS_64),
        # rail_carriage sub-assemblies
        polytope_entry(
            'carriage',
            merge_parts(carriage_parts, [25, 26, 27, 28, 29, 30, 31, 32, 34, 37, 38, 39, 40, 41, 46, 47, 48, 49, 50]),
            dirs=DIRECTIONS_64,
        ),
        polytope_entry('carriage', merge_parts(carriage_parts, [36]), dirs=DIRECTIONS_64),
        polytope_entry('carriage', merge_parts(carriage_parts, [33, 42]), dirs=DIRECTIONS_64),
        # Untranslated U-bend vertices (z <= BEND_END_Z) of part_35 in CAD coordinates for runtime rigid translation
        polytope_entry(
            'drag_chain_bend',
            fixed_parts['part_35'][fixed_parts['part_35'][:, 2] <= DRAG_CHAIN_BEND_END_Z + 1e-5],
            dirs=DIRECTIONS_64,
        ),
    ]
    return {'schemaVersion': 1, 'assetId': 'al0700', 'hulls': hulls}


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def update_sha256sums(model_id: str) -> None:
    model_dir = MODELS_DIR / model_id
    sums_path = model_dir / 'SHA256SUMS'
    collision_hash = sha256_file(model_dir / 'collision.json')

    if model_id in ('xarm5', 'xarm6', 'xarm7', 'uf850', 'lite6'):
        tracked = [model_dir / f'{model_id}.urdf']
        tracked.extend(sorted(model_dir.glob('meshes/*/visual_glb/*.glb')))
        tracked.append(model_dir / 'collision.json')
        lines = [f'{sha256_file(p)}  {p.relative_to(model_dir).as_posix()}' for p in tracked]
        sums_path.write_text('\n'.join(lines) + '\n', encoding='utf-8')
        return

    existing_lines = [line.strip() for line in sums_path.read_text(encoding='utf-8').splitlines() if line.strip()]
    use_repo_prefix = any(line.split()[1].startswith('public/models/') for line in existing_lines)
    target_name = f'public/models/{model_id}/collision.json' if use_repo_prefix else 'collision.json'

    filtered = [line for line in existing_lines if not line.split()[1].endswith('collision.json')]
    filtered.append(f'{collision_hash}  {target_name}')
    sums_path.write_text('\n'.join(filtered) + '\n', encoding='utf-8')


SOURCE_NOTES: dict[str, str] = {
    'xarm5': '- `collision.json`：由 `scripts/build-collision-hulls.py` 从上游同一提交的 `assets/urdf/xarm5/meshes/collision/*.stl` 严格凸包提取去重顶点生成，校验值见 `SHA256SUMS`。',
    'xarm6': '- `collision.json`：由 `scripts/build-collision-hulls.py` 从上游同一提交的 `assets/urdf/xarm6/meshes/collision/*.stl` 严格凸包提取去重顶点生成，校验值见 `SHA256SUMS`。',
    'xarm7': '- `collision.json`：由 `scripts/build-collision-hulls.py` 从上游同一提交的 `assets/urdf/xarm7/meshes/collision/*.stl` 严格凸包提取去重顶点生成，校验值见 `SHA256SUMS`。',
    'uf850': '- `collision.json`：由 `scripts/build-collision-hulls.py` 从上游同一提交的 `assets/urdf/uf850/meshes/collision/*.stl` 严格凸包提取去重顶点生成，校验值见 `SHA256SUMS`。',
    'lite6': '- `collision.json`：由 `scripts/build-collision-hulls.py` 从上游同一提交的 `assets/urdf/lite6/meshes/collision/*.stl` 严格凸包提取去重顶点生成，校验值见 `SHA256SUMS`。',
    'bio-gripper-g2': '- `collision.json`：由 `scripts/build-collision-hulls.py` 从上游同一提交的 `assets/urdf/bio_gripper_g2/meshes/collision/*_convex_*.stl` 提取凸包顶点并对齐可动手指局部坐标系生成，校验值见 `SHA256SUMS`。',
    'gripper-g2': '- `collision.json`：由 `scripts/build-collision-hulls.py` 从同目录 7 个分体 GLB 几何网格提取紧凑凸分解顶点生成，校验值见 `SHA256SUMS`。',
    'lite6-gripper': '- `collision.json`：由 `scripts/build-collision-hulls.py` 结合上游 `lite6_gripper` 壳体碰撞网格与双指解析包围盒原语生成，校验值见 `SHA256SUMS`。',
    'lite6-vacuum-gripper': '- `collision.json`：由 `scripts/build-collision-hulls.py` 从上游 `vacuum_gripper_lite.stl` 按主体与吸盘分段提取紧凑凸包顶点生成，校验值见 `SHA256SUMS`。',
    'ai1500': '- `collision.json`：由 `scripts/build-collision-hulls.py` 从同目录 `model.glb` 对齐末端法兰坐标系提取紧凑凸包顶点生成，校验值见 `SHA256SUMS`。',
    'al0700': '- `collision.json`：由 `scripts/build-collision-hulls.py` 从同目录 `model.glb` 按固定导轨组、滑块组与拖链弯头分段提取紧凑凸包顶点生成，校验值见 `SHA256SUMS`。',
}


def update_source_md(model_id: str) -> None:
    source_path = MODELS_DIR / model_id / 'SOURCE.md'
    text = source_path.read_text(encoding='utf-8')
    note = SOURCE_NOTES[model_id]
    lines = [line for line in text.splitlines() if '`collision.json`' not in line]
    while lines and not lines[-1].strip():
        lines.pop()
    lines.append(note)
    updated = '\n'.join(lines) + '\n'
    assert '/home/' not in updated and 'dev/asserts' not in updated
    source_path.write_text(updated, encoding='utf-8')


def main() -> None:
    builders = {
        'xarm5': lambda: build_arm_manifest('xarm5'),
        'xarm6': lambda: build_arm_manifest('xarm6'),
        'xarm7': lambda: build_arm_manifest('xarm7'),
        'uf850': lambda: build_arm_manifest('uf850'),
        'lite6': lambda: build_arm_manifest('lite6'),
        'bio-gripper-g2': build_bio_gripper_manifest,
        'gripper-g2': build_gripper_g2_manifest,
        'lite6-gripper': build_lite6_gripper_manifest,
        'lite6-vacuum-gripper': build_lite6_vacuum_manifest,
        'ai1500': build_ai1500_manifest,
        'al0700': build_al0700_manifest,
    }

    total_bytes = 0
    for model_id, builder in builders.items():
        manifest = builder()
        out_path = MODELS_DIR / model_id / 'collision.json'
        encoded = json.dumps(manifest, separators=(',', ':')) + '\n'
        out_path.write_text(encoded, encoding='utf-8')
        size = out_path.stat().st_size
        assert size <= 30_720, f'{model_id}/collision.json exceeds 30 KB ({size} B)'
        total_bytes += size
        update_sha256sums(model_id)
        update_source_md(model_id)
        hull_count = len(manifest['hulls'])
        vert_count = sum(len(h.get('vertices', [])) // 3 for h in manifest['hulls'])
        print(f'{model_id:22s}: {hull_count:2d} hulls, {vert_count:4d} polytope verts, {size:6d} B')

    assert total_bytes <= 153_600, f'Total collision.json size exceeds 150 KB ({total_bytes} B)'
    print(f'Total collision manifests size: {total_bytes} B ({total_bytes / 1024:.1f} KiB)')


if __name__ == '__main__':
    main()
