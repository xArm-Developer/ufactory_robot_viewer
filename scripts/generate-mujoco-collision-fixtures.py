"""Generate independent geometric collision ground-truth fixtures using MuJoCo 3.15.0.

Run with:
  python scripts/generate-mujoco-collision-fixtures.py
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import tempfile
import xml.etree.ElementTree as ET

import mujoco
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
GENESIS_URDF_DIR = Path(
    os.environ.get('UFACTORY_GENESIS_URDF_DIR', ROOT.parent / 'ufactory_genesis' / 'assets' / 'urdf')
)
PENETRATION_THRESHOLD_M = -0.0002  # -0.2 mm


def build_mujoco_model(urdf_path: Path, search_dirs: list[Path]) -> mujoco.MjModel:
    tree = ET.parse(urdf_path)
    robot = tree.getroot()

    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        for link in robot.findall('link'):
            for vis in list(link.findall('visual')):
                link.remove(vis)
            for idx, col in enumerate(link.findall('collision')):
                mesh = col.find('geometry/mesh')
                if mesh is None:
                    continue
                rel = Path(mesh.attrib['filename'])
                src = None
                for base in search_dirs:
                    cand = (base / rel).resolve()
                    if cand.is_file():
                        src = cand
                        break
                    cand_name = base / rel.name
                    if cand_name.is_file():
                        src = cand_name
                        break
                assert src is not None, f'Could not locate collision mesh {rel} for {urdf_path}'
                unique_name = f"{link.attrib['name']}_{idx}_{src.name}"
                shutil.copyfile(src, tmp_dir / unique_name)
                mesh.attrib['filename'] = unique_name

        mj = ET.SubElement(robot, 'mujoco')
        compiler = ET.SubElement(mj, 'compiler')
        compiler.set('fusestatic', 'false')
        compiler.set('meshdir', str(tmp_dir))
        compiler.set('discardvisual', 'true')
        return mujoco.MjModel.from_xml_string(ET.tostring(robot, encoding='unicode'))


def map_body_to_collision_id(body_name: str, dof: int) -> str | None:
    if body_name == 'link_base' or (
        body_name.startswith('link') and body_name[4:].isdigit() and 1 <= int(body_name[4:]) <= dof
    ):
        return f'arm:{body_name}'
    if body_name in ('bio_gripper_g2_base_link', 'uflite_gripper_link', 'uflite_vacuum_gripper_link'):
        return 'gripper:base'
    if body_name in ('bio_gripper_g2_left_finger', 'uflite_finger1'):
        return 'gripper:left'
    if body_name in ('bio_gripper_g2_right_finger', 'uflite_finger2'):
        return 'gripper:right'
    return None


def is_excluded(a: str, b: str, dof: int) -> bool:
    if a == b:
        return True
    if a.startswith('gripper:') and b.startswith('gripper:'):
        return True
    pair = {a, b}
    if pair == {'arm:link_base', 'arm:link1'}:
        return True
    for k in range(1, dof):
        if pair == {f'arm:link{k}', f'arm:link{k + 1}'}:
            return True
    if pair == {f'arm:link{dof}', 'gripper:base'}:
        return True
    return False


def build_valid_geom_pairs(model: mujoco.MjModel, dof: int) -> list[tuple[int, int, tuple[str, str]]]:
    pairs: list[tuple[int, int, tuple[str, str]]] = []
    for g1 in range(model.ngeom):
        b1 = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_BODY, int(model.geom_bodyid[g1]))
        if not b1:
            continue
        id1 = map_body_to_collision_id(b1, dof)
        if not id1:
            continue
        for g2 in range(g1 + 1, model.ngeom):
            b2 = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_BODY, int(model.geom_bodyid[g2]))
            if not b2:
                continue
            id2 = map_body_to_collision_id(b2, dof)
            if not id2 or is_excluded(id1, id2, dof):
                continue
            key = (id1, id2) if id1 < id2 else (id2, id1)
            pairs.append((g1, g2, key))
    return pairs


def evaluate_pose(
    model: mujoco.MjModel,
    data: mujoco.MjData,
    geom_pairs: list[tuple[int, int, tuple[str, str]]],
    joints: list[float],
    extra_qpos: dict[str, float] | None = None,
) -> tuple[float, dict[tuple[str, str], float], list[list[str]]]:
    """Return (min_signed_dist_m, pair_min_dists, sorted_penetrating_pairs) using exact mj_geomDistance."""
    mujoco.mj_resetData(model, data)
    for i, val in enumerate(joints, 1):
        jid = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, f'joint{i}')
        assert jid >= 0, f'Missing joint{i}'
        lo, hi = model.jnt_range[jid]
        assert lo - 1e-6 <= val <= hi + 1e-6, f'joint{i}={val} out of [{lo}, {hi}]'
        data.qpos[model.jnt_qposadr[jid]] = val

    if extra_qpos:
        for jname, val in extra_qpos.items():
            jid = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, jname)
            if jid >= 0:
                data.qpos[model.jnt_qposadr[jid]] = val

    mujoco.mj_forward(model, data)

    min_dist = 0.050
    pair_min: dict[tuple[str, str], float] = {}
    for g1, g2, key in geom_pairs:
        d = float(mujoco.mj_geomDistance(model, data, g1, g2, 0.050, None))
        if d < min_dist:
            min_dist = d
        if key not in pair_min or d < pair_min[key]:
            pair_min[key] = d

    hits = [list(pair) for pair, d in sorted(pair_min.items()) if d < PENETRATION_THRESHOLD_M]
    return min_dist, pair_min, hits


def bracket_trajectory(
    model: mujoco.MjModel,
    data: mujoco.MjData,
    geom_pairs: list[tuple[int, int, tuple[str, str]]],
    q_start: list[float],
    q_end: list[float],
    label: str,
    extra_qpos: dict[str, float] | None = None,
) -> tuple[dict, dict]:
    start_arr = np.array(q_start, dtype=np.float64)
    end_arr = np.array(q_end, dtype=np.float64)

    alphas = np.linspace(0.0, 1.0, 201)
    first_hit_idx = None
    for idx, a in enumerate(alphas):
        q = (start_arr + a * (end_arr - start_arr)).tolist()
        _, _, hits = evaluate_pose(model, data, geom_pairs, q, extra_qpos)
        if hits:
            first_hit_idx = idx
            break
    assert first_hit_idx is not None and first_hit_idx > 0, f'Trajectory {label} did not transition into collision'

    lo = float(alphas[first_hit_idx - 1])
    hi = float(alphas[first_hit_idx])
    for _ in range(28):
        mid = 0.5 * (lo + hi)
        q = (start_arr + mid * (end_arr - start_arr)).tolist()
        _, _, hits = evaluate_pose(model, data, geom_pairs, q, extra_qpos)
        if hits:
            hi = mid
        else:
            lo = mid

    alpha_star = 0.5 * (lo + hi)
    total_rad = float(np.linalg.norm(end_arr - start_arr))
    step_half_deg = np.deg2rad(0.5) / max(total_rad, 1e-6)

    # Walk backward from alpha_star until minimum clearance across all pairs > +2.0 mm
    safe_a = alpha_star
    q_safe: list[float] = []
    d_safe = 0.0
    hits_safe: list[list[str]] = []
    for k in range(1, 80):
        cand_a = max(0.0, alpha_star - k * step_half_deg)
        q_cand = np.round(start_arr + cand_a * (end_arr - start_arr), 6).tolist()
        d_cand, _, h_cand = evaluate_pose(model, data, geom_pairs, q_cand, extra_qpos)
        if not h_cand and d_cand >= 0.0020:
            safe_a = cand_a
            q_safe, d_safe, hits_safe = q_cand, d_cand, h_cand
            break
    assert q_safe and not hits_safe and d_safe >= 0.0020, f'{label} could not find clear safe sample (last d={d_safe})'

    # Walk forward from alpha_star until min_dist < -2.0 mm and NO pair sits in the [-1.2 mm, +1.2 mm] grazing band
    q_hit: list[float] = []
    d_hit = 0.0
    hits_hit: list[list[str]] = []
    for k in range(1, 120):
        cand_a = min(1.0, alpha_star + k * step_half_deg)
        q_cand = np.round(start_arr + cand_a * (end_arr - start_arr), 6).tolist()
        d_cand, pair_min, h_cand = evaluate_pose(model, data, geom_pairs, q_cand, extra_qpos)
        ambiguous = any(-0.0020 < dist < 0.0020 for dist in pair_min.values())
        if h_cand and d_cand <= -0.0020 and not ambiguous:
            q_hit, d_hit, hits_hit = q_cand, d_cand, h_cand
            break
    assert q_hit and hits_hit and d_hit <= -0.0020, f'{label} could not find unambiguous colliding sample'

    return (
        {
            'label': f'{label}_safe',
            'joints': q_safe,
            'collides': False,
            'minDistMm': round(d_safe * 1000, 3),
            'pairs': [],
        },
        {
            'label': f'{label}_colliding',
            'joints': q_hit,
            'collides': True,
            'minDistMm': round(d_hit * 1000, 3),
            'pairs': hits_hit,
        },
    )


ARM_TRAJECTORIES: dict[str, dict] = {
    'xarm5': {
        'dof': 5,
        'cases': [
            ('wrist_into_link1', [0, 0, 0, 0, 0], [0.4, -0.55, 0.08, 2.62, 0.5]),
            ('forearm_into_base', [0, 0, 0, 0, 0], [0.2, 2.00, -0.62, 1.80, 0.3]),
            ('rotated_wrist_into_base', [0, 0, 0, 0, 0], [-1.2, -0.25, 0.16, 2.60, -0.8]),
            ('twisted_forearm_into_base', [0, 0, 0, 0, 0], [1.1, 1.92, -0.63, 1.18, 0.9]),
        ],
    },
    'xarm6': {
        'dof': 6,
        'cases': [
            ('link4_into_base', [0, 0, 0, 0, 0, 0], [-0.5, 1.88, -0.15, -0.24, -0.10, 0.4]),
            ('wrist_into_link1_link2', [0, 0, 0, 0, 0, 0], [0.6, -1.60, 0.18, 4.76, -0.32, 0.5]),
            ('folded_wrist_into_link1', [0, 0, 0, 0, 0, 0], [1.0, 1.69, 0.11, 3.79, 2.07, -0.6]),
            ('rotated_link4_into_base', [0, 0, 0, 0, 0, 0], [0.9, 1.96, -0.72, 2.72, 0.48, -1.0]),
        ],
    },
    'xarm7': {
        'dof': 7,
        'cases': [
            ('wrist_into_base', [0, 0, 0, 0, 0, 0, 0], [-0.6, -2.00, -3.39, 0.35, 2.23, -1.10, 0.1]),
            ('elbow_wrist_into_link2', [0, 0, 0, 0, 0, 0, 0], [0.5, -0.62, -4.72, -0.02, 3.48, 0.68, 0.4]),
            ('twisted_wrist_into_link1_link2', [0, 0, 0, 0, 0, 0, 0], [-0.8, -1.42, -4.83, -0.10, -5.58, -0.85, -0.5]),
            ('rotated_wrist_into_base', [0, 0, 0, 0, 0, 0, 0], [1.2, -1.94, -3.26, 0.40, 3.48, -0.73, 0.8]),
        ],
    },
    'uf850': {
        'dof': 6,
        'cases': [
            ('link5_into_base', [0, 0, 0, 0, 0, 0], [0.3, -1.83, -0.65, -5.63, 1.84, -0.5]),
            ('link4_into_link1_base', [0, 0, 0, 0, 0, 0], [-0.8, -1.73, -0.25, -1.29, -0.86, -0.1]),
            ('folded_wrist_into_upper_arm', [0, 0, 0, 0, 0, 0], [0.9, -1.79, 0.05, 4.76, -0.93, 0.7]),
            ('rotated_link4_into_base', [0, 0, 0, 0, 0, 0], [-1.1, -2.18, -0.25, -0.65, -0.83, 1.2]),
        ],
    },
    'lite6': {
        'dof': 6,
        'cases': [
            ('link4_into_link1', [0, 0, 0, 0, 0, 0], [0.74, -1.03, 0.10, -0.80, -1.24, -1.1]),
            ('link4_into_base', [0, 0, 0, 0, 0, 0], [0.6, 2.45, 1.66, -1.63, -0.13, -0.8]),
            ('wrist_cluster_into_base', [0, 0, 0, 0, 0, 0], [-0.9, 1.50, 0.62, -0.62, -0.56, 1.0]),
            ('forearm_into_base', [0, 0, 0, 0, 0, 0], [0.4, -2.15, 3.76, -0.48, -1.47, 0.1]),
        ],
    },
}


def main() -> None:
    arm_fixtures: dict[str, list[dict]] = {}
    total = 0

    for arm_id, spec in ARM_TRAJECTORIES.items():
        dof = spec['dof']
        urdf = ROOT / 'public' / 'models' / arm_id / f'{arm_id}.urdf'
        model = build_mujoco_model(urdf, [GENESIS_URDF_DIR / arm_id])
        data = mujoco.MjData(model)
        geom_pairs = build_valid_geom_pairs(model, dof)

        home = [0.0] * dof
        d_home, _, hits_home = evaluate_pose(model, data, geom_pairs, home)
        assert not hits_home, f'{arm_id} HOME had unexpected hits: {hits_home}'

        samples = [
            {
                'label': 'home_zero',
                'joints': home,
                'collides': False,
                'minDistMm': round(d_home * 1000, 3),
                'pairs': [],
            }
        ]
        for label, q0, q1 in spec['cases']:
            safe_s, hit_s = bracket_trajectory(model, data, geom_pairs, q0, q1, label)
            samples.extend([safe_s, hit_s])

        arm_fixtures[arm_id] = samples
        total += len(samples)
        print(f'{arm_id:8s}: {len(samples)} arm samples verified')

    combo_fixtures: list[dict] = []
    # Arm + BIO Gripper G2 pure gripper-vs-arm collision trajectories
    for arm_id, dof, q1 in [
        ('xarm5', 5, [-4.396, 1.332, -2.364, 3.039, 1.131]),
        ('xarm6', 6, [-3.080, -0.210, -1.849, 0.672, 3.120, 3.678]),
        ('xarm7', 7, [0.057, 0.240, 6.227, 3.073, 1.535, 3.088, -3.578]),
        ('uf850', 6, [2.777, 2.289, -0.200, 4.311, 1.199, -1.319]),
    ]:
        prefix = f'{arm_id}_1305' if arm_id != 'uf850' else 'uf850'
        combo_urdf = ROOT / 'tests' / 'reference-urdfs' / f'{prefix}_bio_gripper_g2_movable_visual.glb.urdf'
        model = build_mujoco_model(
            combo_urdf,
            [GENESIS_URDF_DIR / arm_id, GENESIS_URDF_DIR / 'bio_gripper_g2'],
        )
        data = mujoco.MjData(model)
        geom_pairs = build_valid_geom_pairs(model, dof)
        extra = {
            'bio_gripper_g2_right_finger_joint': 0.0395,
            'bio_gripper_g2_left_finger_joint': -0.0395,
        }
        home = [0.0] * dof
        d_home, _, hits_home = evaluate_pose(model, data, geom_pairs, home, extra)
        assert not hits_home, f'{arm_id}+bio HOME had hits: {hits_home}'
        safe_s, hit_s = bracket_trajectory(model, data, geom_pairs, home, q1, f'{arm_id}_bio_g2', extra)
        assert any('gripper:' in p[0] or 'gripper:' in p[1] for p in hit_s['pairs']), (
            f'{arm_id}+bio trajectory did not hit gripper: {hit_s["pairs"]}'
        )
        for s in (
            {
                'label': f'{arm_id}_bio_home',
                'joints': home,
                'collides': False,
                'minDistMm': round(d_home * 1000, 3),
                'pairs': [],
            },
            safe_s,
            hit_s,
        ):
            combo_fixtures.append({**s, 'robotId': arm_id, 'gripperId': 'bio-gripper-g2', 'opening': 150})
        print(f'{arm_id}+bio-gripper-g2: 3 combo samples verified ({hit_s["pairs"]})')

    # Lite 6 + Gripper Lite & Vacuum Gripper Lite pure gripper-vs-arm collision trajectories
    for gripper_id, urdf_name, tool_dir, opening, extra, q1 in [
        (
            'lite6-gripper',
            'lite6_gripper_movable_visual.glb.urdf',
            'lite6_gripper',
            100,
            {'finger_joint1': 0.0089, 'finger_joint2': 0.0089},
            [0.993, -1.049, 0.350, 3.307, -1.597, -4.609],
        ),
        (
            'lite6-vacuum-gripper',
            'lite6_with_vacuum_gripper.urdf',
            'lite6_vacuum_gripper',
            0,
            {},
            [0.500, -0.236, 0.240, -0.058, 1.682, -1.051],
        ),
    ]:
        combo_urdf = ROOT / 'tests' / 'reference-urdfs' / urdf_name
        model = build_mujoco_model(
            combo_urdf,
            [GENESIS_URDF_DIR / 'lite6', GENESIS_URDF_DIR / tool_dir],
        )
        data = mujoco.MjData(model)
        geom_pairs = build_valid_geom_pairs(model, 6)
        home = [0.0] * 6
        d_home, _, hits_home = evaluate_pose(model, data, geom_pairs, home, extra)
        assert not hits_home, f'lite6+{gripper_id} HOME had hits: {hits_home}'
        safe_s, hit_s = bracket_trajectory(model, data, geom_pairs, home, q1, f'lite6_{gripper_id}', extra)
        assert any('gripper:' in p[0] or 'gripper:' in p[1] for p in hit_s['pairs']), (
            f'lite6+{gripper_id} trajectory did not hit gripper: {hit_s["pairs"]}'
        )
        for s in (
            {
                'label': f'lite6_{gripper_id}_home',
                'joints': home,
                'collides': False,
                'minDistMm': round(d_home * 1000, 3),
                'pairs': [],
            },
            safe_s,
            hit_s,
        ):
            combo_fixtures.append({**s, 'robotId': 'lite6', 'gripperId': gripper_id, 'opening': opening})
        print(f'lite6+{gripper_id}: 3 combo samples verified ({hit_s["pairs"]})')

    total += len(combo_fixtures)
    out_path = ROOT / 'tests' / 'mujoco-collision-fixtures.json'
    out_path.write_text(
        json.dumps(
            {
                'mujocoVersion': mujoco.__version__,
                'penetrationThresholdMm': -0.2,
                'arms': arm_fixtures,
                'combinations': combo_fixtures,
            },
            indent=2,
        )
        + '\n',
        encoding='utf-8',
    )
    print(f'Wrote {total} ground-truth collision samples to {out_path}')


if __name__ == '__main__':
    main()
