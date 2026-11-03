# UFACTORY Robot Viewer 设计说明

[English](./design.md) | 简体中文 · [返回 README_zh.md](../README_zh.md)

## 机型与配件

默认场景：`xArm 6`、无滑轨、无末端工具、关节与滑轨均为零位。`xArm 5/6/7` 为 1305 版本。

| 机械臂 | 直线滑轨 `AL0700` | 六维力矩传感器 `AI1500` | 末端执行器 |
| --- | :---: | :---: | --- |
| `xArm 5/6/7` | ✓ | ✓ | `Gripper G2`、`BIO Gripper G2` |
| `850` | — | ✓ | `Gripper G2`、`BIO Gripper G2` |
| `Lite 6` | — | — | `Gripper Lite`、`Vacuum Gripper Lite` |

| 末端执行器 | 开口 |
| --- | --- |
| `Gripper G2` | `0–84 mm`，步长 `0.1 mm` |
| `BIO Gripper G2` | `71–150 mm`，步长 `0.1 mm` |
| `Gripper Lite` | 气动，`0` 闭合 / `100` 张开 |
| `Vacuum Gripper Lite` | 静态模型 |

- 切换配件保留当前姿态；切换机械臂保留兼容配件、清除不兼容项。非法输入恢复上一次有效值。
- 场景（型号、姿态、配件）保存在浏览器本地，连续运动按 `200 ms` 节流写入。打开首页优先恢复本地场景，无效或碰撞时依次回退至链接场景、`xArm 6` 无配件零位。

## TCP 偏移

法兰坐标系下的固定偏移（mm）：

| 末端配置 | TCP 位置 `(x, y, z)` |
| --- | --- |
| 无 | `(0, 0, 0)`（法兰） |
| `AI1500` | `(0, 0, 58.6)` |
| `Gripper G2` | `(0, 0, 173.5)` |
| `BIO Gripper G2` | `(135, 0, 55)` |
| `Gripper Lite` | `(0, 0, 83.6)` |
| `Vacuum Gripper Lite` | `(0, 0, 61.0)` |

- `AI1500` + 夹爪：夹爪偏移整体叠加 `+Z 58.6`。
- TCP 不随夹爪开口和滑轨行程变化。

## 运动控制

关节、笛卡尔和滑轨共用速度 `1%–100%`（默认 `50%`，本地保存），线性映射如下：

| 控制 | 短按步进 | 长按（> `220 ms`）速度 |
| --- | --- | --- |
| 关节 | `1°` | `1–45°/s` |
| 笛卡尔位置 / 姿态 | `1 mm` / `1°` | `2.5–250 mm/s` / `1–40°/s` |
| 直线滑轨（`0–700 mm`） | `1 mm` | `2.5–250 mm/s` |

- **初始位置**：全部关节移向 `0°`，保留滑轨与末端配置。
- **末端调平**：仅调整最后三个关节，取限位内关节变化平方和最小的解，使法兰 `+Z` 与基坐标 `−Z` 夹角 ≤ `0.1°`；不可达时保持原姿态并提示。
- 连续运动在释放、切换标签/场景、收起面板或失焦时停止。`xArm 5` 禁用 `Roll±`。

## 碰撞检测与可视化

- 每步检查关节限位和几何碰撞（自碰撞、机械臂与配件含 `AL0700` 拖链；地面不参与），碰撞时回退至上一有效姿态、碰撞部件变红并提示碰撞部件对。
- 逆解未收敛保持原姿态；超限显示 `C23 Joints Angle Exceed Limit ID [x], joint angle [1.23°].`。
- 地面圆环为 TCP 在基座 `z=0` 平面的理论最大水平可达距离（仅受关节限位约束、姿态自由、不考虑碰撞），由离线数据提供。
- 遥测显示 `link_base` 下 TCP 位姿（mm、°），RPY 为固定轴 `Rz(yaw) × Ry(pitch) × Rx(roll)`。

## 示例 01：装箱物理仿真

- 场景：`xArm 6 + Gripper G2`，传送带 `40 mm/s`，九个 `30 mm`、`17 g` 工件，全部稳定落箱后停止；与机械臂页状态独立。
- 引擎：[MuJoCo 3.15.0 单线程 WASM](https://github.com/google-deepmind/mujoco/blob/3.15.0/wasm/README.md)。工件为自由刚体，由传送带[表面速度](https://mujoco.readthedocs.io/en/3.13.0/XMLreference.html#body-geom-surfacevel)搬运；抓放依靠驱动器、接触摩擦和重力，不使用固定约束。驱动与摩擦参数为展示设定。
- 抓空、掉落、未稳定落箱及非预期碰撞时停止并提示。不连接真机，不可作为安全验证。
- MJCF 由 [`scripts/build-packing-model.py`](../scripts/build-packing-model.py) 根据 URDF、[`src/packing-config.json`](../src/packing-config.json) 和碰撞凸包生成。

## 直达链接参数

| 参数 | 取值 | 适用机型 |
| --- | --- | --- |
| `example` | `packing-01` | — |
| `model` | `xarm5`、`xarm6`（默认）、`xarm7`、`uf850`、`lite6` | — |
| `rail` / `railPos` | `al0700` / `0–700` | `xArm 5/6/7` |
| `sensor` | `ai1500` | `xArm 5/6/7`、`850` |
| `gripper` | `gripper-g2`、`bio-gripper-g2` / `lite6-gripper`、`lite6-vacuum-gripper` | 兼容机型 |
| `opening` | 夹爪开口范围；`Gripper Lite` 仅 `0` 或 `100` | — |

- 示例：`?model=xarm7&rail=al0700&railPos=280.5&sensor=ai1500&gripper=bio-gripper-g2&opening=110.0`。
- 无效参数回退默认值并更新地址栏。旧链接 `?model=ai1500|gripper-g2|bio-gripper-g2` 转为 `xArm 6` 装配，`?model=lite6-gripper|lite6-vacuum-gripper` 转为 `Lite 6` 装配。

## 资源缓存与离线管线

- 构建时对大于 `128 KiB` 且压缩率 ≥ `20%` 的 GLB 生成 gzip 副本（SHA-256 命名、`.bin` 后缀），`_headers` 设置长期缓存；不支持解压 API 时回退原文件。
- 运行时解码模型缓存上限 `64 MiB`，跨页面共享 `ModelCache`。

| 脚本 | 用途 |
| --- | --- |
| [`build-collision-hulls.py`](../scripts/build-collision-hulls.py) | 生成碰撞凸包 `public/models/<id>/collision.json` |
| [`reach-input.mjs`](../scripts/reach-input.mjs) + [`generate-reach.py`](../scripts/generate-reach.py) | 计算 27 种装配组合的可达半径，写入 [`reach-data.json`](../src/reach-data.json) |
| `generate-mujoco-*-fixtures.py`、[`packing-physics.py`](../tests/packing-physics.py) | 生成 FK 与碰撞真值基准；装箱物理核验 |

重新生成凸包或碰撞基准需只读的 [UFACTORY Genesis](https://github.com/xArm-Developer/ufactory_genesis) `assets/urdf`（默认 `../ufactory_genesis/assets/urdf`，可用 `UFACTORY_GENESIS_URDF_DIR` 指定）。夹爪 FK 基准使用 [`tests/reference-urdfs/`](../tests/reference-urdfs/)。
