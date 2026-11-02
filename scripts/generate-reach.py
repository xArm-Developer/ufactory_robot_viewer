"""Estimate z=0 TCP reach from the project's URDFs and actual TypeScript TCP offsets.

Run from the project root with Node and Python (numpy, scipy, mujoco) installed:
  node scripts/reach-input.mjs  # inspect the application-derived inputs
  python scripts/generate-reach.py

The primary search is multistart SLSQP with z=0 as an equality.  An independent
search eliminates joint 2 by solving its sinusoidal height equation, then uses
differential evolution over the remaining joints.  Neither proves global optimality.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET

import mujoco
import numpy as np
import scipy
from scipy.optimize import differential_evolution, minimize

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / 'src/reach-data.json'


class ReachModel:
    def __init__(self, spec: dict, offset: list[float]):
        root = ET.parse(ROOT / spec['urdf']).getroot()
        for link in root.findall('link'):
            for tag in ('visual', 'collision'):
                for element in link.findall(tag):
                    link.remove(element)
        ET.SubElement(ET.SubElement(root, 'mujoco'), 'compiler', fusestatic='false')
        self.model = mujoco.MjModel.from_xml_string(ET.tostring(root, encoding='unicode'))
        self.data = mujoco.MjData(self.model)
        self.base = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_BODY, 'link_base')
        self.end = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_BODY, spec['eeLink'])
        ids = [mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_JOINT, f'joint{i}')
               for i in range(1, spec['dof'] + 1)]
        if self.base < 0 or self.end < 0 or any(i < 0 for i in ids):
            raise ValueError(f"Missing base, end link, or joint for {spec['id']}")
        self.addresses = self.model.jnt_qposadr[ids]
        self.bounds = np.array(self.model.jnt_range[ids], dtype=float)
        self.offset = np.array(offset, dtype=float)
        # A first revolute joint through base Z spanning a full turn leaves radius and Z invariant.
        joint = root.find("joint[@name='joint1']")
        axis = np.fromstring(joint.find('axis').get('xyz'), sep=' ')
        origin = np.fromstring(joint.find('origin').get('xyz'), sep=' ')
        rpy = np.fromstring(joint.find('origin').get('rpy'), sep=' ')
        if (joint.get('type') != 'revolute' or not np.allclose(axis, [0, 0, 1])
                or not np.allclose(origin[:2], 0) or not np.allclose(rpy, 0)
                or self.bounds[0, 1] - self.bounds[0, 0] < 2 * math.pi
                or not self.bounds[0, 0] <= 0 <= self.bounds[0, 1]):
            raise ValueError(f"First-joint rotational symmetry changed for {spec['id']}")

    def point(self, remaining: np.ndarray) -> np.ndarray:
        self.data.qpos[self.addresses] = np.r_[0.0, remaining]
        mujoco.mj_kinematics(self.model, self.data)
        base_rotation = self.data.xmat[self.base].reshape(3, 3)
        end_rotation = self.data.xmat[self.end].reshape(3, 3)
        world = self.data.xpos[self.end] + end_rotation @ self.offset
        return base_rotation.T @ (world - self.data.xpos[self.base])

    def radius(self, remaining: np.ndarray) -> float:
        return float(np.linalg.norm(self.point(remaining)[:2]))

    def height(self, remaining: np.ndarray) -> float:
        return float(self.point(remaining)[2])

    def solve_joint2(self, rest: np.ndarray) -> tuple[float, np.ndarray | None]:
        # With other joints fixed, height as a function of a revolute joint is
        # C + A cos(q2) + B sin(q2), even outside the joint's allowed interval.
        q = np.r_[0.0, rest]
        z0 = self.height(q)
        q[0] = math.pi
        zpi = self.height(q)
        q[0] = math.pi / 2
        zhalf = self.height(q)
        c = (z0 + zpi) / 2
        a = (z0 - zpi) / 2
        b = zhalf - c
        amplitude = math.hypot(a, b)
        if amplitude < 1e-12 or abs(c) > amplitude:
            return 0.0, None
        phase = math.atan2(b, a)
        angle = math.acos(np.clip(-c / amplitude, -1, 1))
        lo, hi = self.bounds[1]
        best_radius, best = 0.0, None
        for root in (phase + angle, phase - angle):
            for turn in range(math.ceil((lo - root) / (2 * math.pi)), math.floor((hi - root) / (2 * math.pi)) + 1):
                q[0] = root + turn * 2 * math.pi
                radius = self.radius(q)
                if radius > best_radius:
                    best_radius, best = radius, q.copy()
        return best_radius, best


def slsqp_search(arm: ReachModel, seed: int, starts: int) -> tuple[float, np.ndarray]:
    rng = np.random.default_rng(seed)
    bounds = arm.bounds[1:]
    seeds = [np.clip(np.zeros(len(bounds)), bounds[:, 0], bounds[:, 1])]
    seeds.extend(rng.uniform(bounds[:, 0], bounds[:, 1]) for _ in range(starts - 1))
    best = None
    for start in seeds:
        result = minimize(lambda q: -arm.radius(q), start, method='SLSQP', bounds=bounds,
                          constraints={'type': 'eq', 'fun': arm.height},
                          options={'maxiter': 300, 'ftol': 1e-12})
        if (abs(arm.height(result.x)) < 1e-7
                and np.all(result.x >= bounds[:, 0] - 1e-9)
                and np.all(result.x <= bounds[:, 1] + 1e-9)):
            radius = arm.radius(result.x)
            if best is None or radius > best[0]:
                best = radius, result.x.copy()
    if best is None:
        raise RuntimeError('SLSQP failed to find a feasible witness')
    return best


def differential_search(arm: ReachModel, seed: int, iterations: int) -> tuple[float, np.ndarray]:
    result = differential_evolution(lambda rest: -arm.solve_joint2(rest)[0], arm.bounds[2:],
                                    rng=np.random.default_rng(seed), popsize=14, maxiter=iterations,
                                    tol=1e-9, atol=1e-10, polish=False)
    radius, q = arm.solve_joint2(result.x)
    if q is None:
        raise RuntimeError('Differential evolution failed to find a feasible witness')
    return radius, q


def witness(arm: ReachModel, solution: tuple[float, np.ndarray]) -> dict:
    radius, q = solution
    point = arm.point(q)
    if abs(point[2]) > 1e-7:
        raise RuntimeError(f'Infeasible z={point[2]}')
    return {'radiusM': radius, 'jointsRad': [0.0, *q.tolist()], 'tcpBaseM': point.tolist()}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--only', help='Run one robot ID for development; requires --output')
    parser.add_argument('--output', type=Path, default=OUTPUT)
    parser.add_argument('--starts', type=int, default=100)
    parser.add_argument('--iterations', type=int, default=450)
    args = parser.parse_args()
    if args.only and args.output == OUTPUT:
        parser.error('--only requires a separate --output to avoid overwriting the full dataset')
    robots = json.loads(subprocess.check_output(['node', 'scripts/reach-input.mjs'], cwd=ROOT, text=True))
    if args.only:
        robots = [robot for robot in robots if robot['id'] == args.only]
        if not robots:
            parser.error('Unknown robot ID')
    result = {'version': 1, 'mujocoVersion': mujoco.__version__, 'scipyVersion': scipy.__version__,
              'methods': {'primary': f'SLSQP, {args.starts} deterministic starts',
                          'crossCheck': f'differential evolution, joint-2 height roots, max {args.iterations} iterations'},
              'robots': {}}
    for robot_index, spec in enumerate(robots):
        entry = {'eeLink': spec['eeLink'], 'dof': spec['dof'],
                 'urdfSha256': hashlib.sha256((ROOT / spec['urdf']).read_bytes()).hexdigest(), 'combinations': []}
        for combo_index, combo in enumerate(spec['combinations']):
            arm = ReachModel(spec, combo['tcp']['position'])
            seed = 1701 + robot_index * 100 + combo_index
            primary = slsqp_search(arm, seed, args.starts)
            independent = differential_search(arm, seed + 10000, args.iterations)
            if abs(primary[0] - independent[0]) > 0.001:
                raise RuntimeError(f"Search disagreement >1 mm for {spec['id']} {combo}: {primary[0]} vs {independent[0]}")
            # Record the better witness after the independent searches; preserve both results.
            if independent[0] > primary[0]:
                primary, independent = independent, primary
                primary_method, check_method = 'differential-evolution', 'slsqp'
            else:
                primary_method, check_method = 'slsqp', 'differential-evolution'
            entry['combinations'].append({**combo, 'method': primary_method, **witness(arm, primary),
                                          'crossCheck': {'method': check_method, **witness(arm, independent)}})
            print(f"{spec['id']:6s} sensor={combo['sensor']!s:5s} {str(combo['gripperId']):21s} "
                  f"{primary[0] * 1000:9.4f} mm  Δ={abs(primary[0] - independent[0]) * 1000:.4f} mm", flush=True)
        result['robots'][spec['id']] = entry
    args.output.write_text(json.dumps(result, indent=2, allow_nan=False) + '\n')
    print(f'Wrote {sum(len(r["combinations"]) for r in result["robots"].values())} combinations to {args.output}')


if __name__ == '__main__':
    main()
