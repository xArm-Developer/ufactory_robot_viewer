# 运动学方案与验证

## 选型

- **浏览器 JavaScript（本版）**：`urdf-loader` 根据原始 URDF 建立层级并计算 FK；固定到提交 `e966801426aba9873e3a853709c53cf12358d8ea` 的 [closed-chain-ik 0.0.7](https://github.com/gkjohnson/closed-chain-ik-js/tree/e966801426aba9873e3a853709c53cf12358d8ea) 使用阻尼最小二乘求解 IK。基座自由度被清除，关节限位来自 URDF，当前关节角是初值。求解在主线程执行，不依赖 SharedArrayBuffer；大范围或奇异附近的数值问题仍可能无法收敛。
- **MuJoCo WebAssembly**：[官方 JavaScript 绑定](https://github.com/google-deepmind/mujoco/tree/main/wasm)可在浏览器加载物理引擎、模型和 WASM；单线程构建无需跨源隔离，多线程需要跨源隔离。它适合后续的接触、动力学和物理仿真，但增加 WASM、模型转换与集成成本，且求解 IK 仍需自行构造数值求解。当前仅需运动学展示，故选择 JavaScript，使用本机 MuJoCo 独立核对 FK。

## 坐标与判定

- 坐标：`link_base → TCP`。未装配末端配件时 TCP 为各机型末端法兰 `eeLink`（`xArm 5`：`link5`，5 轴；`xArm 6`：`link_eef`，6 轴；`xArm 7`：`link7`，7 轴；`850` 与 `Lite 6`：`link6`，6 轴）。在 `xArm 5/6/7` 与 `850` 上可单独或串联装配 `AI1500` 六维力矩传感器与单款夹爪：力矩传感器叠加轴向固定偏移 `SENSOR_TCP = (0, 0, +58.6) mm`；夹爪叠加与开口无关的参考 URDF 固定偏移 `toolOffset`（`Gripper G2` 沿安装面 `+Z 173.5 mm`；`BIO Gripper G2` 在夹爪基座坐标 `(135, 0, 55) mm` 并叠加各机型安装变换 `BIO_MOUNTS`）；两者同装时按 `composePose(SENSOR_TCP, gripperMount / toolOffset)` 串联合成（如 `AI1500 + Gripper G2` 为法兰 `+Z 232.1 mm`）。URDF 单位为米、弧度，界面使用毫米、角度。姿态采用四元数，显示 RPY 为 `Rz(yaw) × Ry(pitch) × Rx(roll)`。RPY 在 pitch 近 ±90° 时存在表达奇异和多解，四元数仍表示有效姿态。
- 直线滑轨与基座相对运动学：`AL0700` 直线滑轨仅适配 `xArm 5/6/7`，滑块沿世界坐标 `+X` 平移 `0–700 mm`（步进 `0.1 mm`），带动机械臂基座 `link_base` 平移至世界坐标 `(railMm / 1000, 0, 0.107) m`（`107.0 mm` 为官方 STEP 三角化滑块安装面高度，与产品页标称 `114.6 mm` 的差异说明见 `public/models/al0700/SOURCE.md`）。装配时机械臂绕世界 `+Z` 旋转 `-90°`，使基座 `+Y` 与滑轨行程 `+X` 同向；未装滑轨时基座方向不变。场景将 `URDFRobot` 置于中间节点 `robotMount` 下以保持局部单位变换，`forward()` 与 `IKSolver.solve()` 均相对 `link_base` 求解，基坐标系 TCP 读数与笛卡尔点动逆解对滑轨行程严格平移不变。
- 初始关节角与滑轨行程均为零（从独立查看返回装配时机械臂关节归零，保留滑轨行程与夹爪开口）；3D 舞台支持按需显示 `link_base` 基坐标系与当前法兰或固定工具 TCP 坐标系（红 X / 绿 Y / 蓝 Z），切换机型与配件时保留显示开关状态。`xArm 5` 受五自由度几何结构约束无法独立调节末端 `Roll`，笛卡尔面板中 `Roll±` 保持灰色禁用。
- 数值求解前先由目标 TCP 经 `flangeFromTcp` 反推法兰目标位姿；迭代收敛阈值设为位置 0.02 mm、旋转 0.0002 rad（适配 1 mm / 1° 步进及 2.5 mm/s 低速连续微步），接近奇异时若复算误差已不大于 0.35 mm / 0.006 rad 亦视为收敛。当 6/7 轴机型处于共线球腕奇异附近（`|q[dof-2]| < 0.01 rad`，如 `850` 全零位执行 `Roll-`）且初值停滞时，自动以腕部旋转 `±90°` 配合 `±0.02 rad` 俯仰微扰重试初值。所有结果均须关节不超限且相对目标 TCP 复算误差不超过 1 mm / 1° 才被接受，否则恢复上一次有效姿态。不能保证每个可达目标都能从当前初值找到解，也未检查碰撞或路径。

## 独立 FK 基准

- **裸臂基准**：`scripts/generate-mujoco-fixtures.py` 从项目内五款机型的原始 URDF 读取关节变换，移除与 FK 无关的视觉及碰撞几何，保留固定坐标系，使用 MuJoCo 3.15.0 的 `mj_forward` 获取 `link_base` 与各机型 `eeLink` 位姿，写入 `tests/mujoco-fk.json`（每机型 7 组、共 35 组样本）。
- **机械臂 + 夹爪组合 TCP 基准**：`scripts/generate-mujoco-gripper-fixtures.py` 读取 `tests/reference-urdfs/` 中八份原始组合 URDF（`xArm 5/6/7`、`850` × `Gripper G2` / `BIO Gripper G2`），以 MuJoCo 3.15.0 计算 `link_base` 到 `link_tcp` / `bio_gripper_g2_tcp_link` 的位姿，写入 `tests/mujoco-gripper-fk.json`（8 种组合 × 7 组姿态 = 56 组样本）。自动测试要求裸臂与八种组合相对 MuJoCo 的位置误差均小于 0.1 mm、旋转误差均小于 0.01°。
- **Lite 6 + 夹爪组合 TCP 基准**：两款工具安装在 `link6`，`Gripper Lite` 和 `Vacuum Gripper Lite` 的参考 TCP 分别为法兰 `+Z 83.6 mm` 和 `+Z 61 mm`。`scripts/generate-mujoco-lite6-tool-fixtures.py` 从两份原始组合 URDF 生成 14 组 MuJoCo 基准，自动测试采用同一误差阈值。Gripper Lite 两指关节原点为法兰 `+Z 54.3 mm`，张开和闭合对应单指沿相反方向移动 `8.9 mm` 与 `0 mm`；这两个模型位置不代表实测夹持间距。

IK 与配件几何测试覆盖五款裸臂、八种臂爪组合、力矩传感器单装及串联双夹爪的可达目标与固定 TCP 点动（含近腕部奇异、`850` 零位 `Roll±`、`xArm 5` 独立 `Roll` 不可达回退，以及 `xArm 5/6/7` 挂载直线滑轨在 `0 / 350 / 700 mm` 行程下的 FK/IK 平移不变性），要求误差小于 1 mm / 1°、所有关节在 URDF 限位内；另测试超出工作空间和非法输入的回退、`AL0700` / `AI1500` GLB 包围盒与行程几何，以及 Gripper G2 实际 GLB 指垫在 `0 / 42 / 84 mm` 下的开口几何精度。测试覆盖有限，不能代表真机精度或完整工作空间。
