# 运动学方案与验证

## 选型

- **浏览器 JavaScript（本版）**：`urdf-loader` 根据原始 URDF 建立层级并计算 FK；固定到提交 `e966801426aba9873e3a853709c53cf12358d8ea` 的 [closed-chain-ik 0.0.7](https://github.com/gkjohnson/closed-chain-ik-js/tree/e966801426aba9873e3a853709c53cf12358d8ea) 使用阻尼最小二乘求解 IK。基座自由度被清除，关节限位来自 URDF，当前关节角是初值。求解在主线程执行，不依赖 SharedArrayBuffer；大范围或奇异附近的数值问题仍可能无法收敛。
- **MuJoCo WebAssembly**：[官方 JavaScript 绑定](https://github.com/google-deepmind/mujoco/tree/main/wasm)可在浏览器加载物理引擎、模型和 WASM；单线程构建无需跨源隔离，多线程需要跨源隔离。它适合后续的接触、动力学和物理仿真，但增加 WASM、模型转换与集成成本，且求解 IK 仍需自行构造数值求解。当前仅需运动学展示，故选择 JavaScript，使用本机 MuJoCo 独立核对 FK。

## 坐标与判定

- 坐标：`link_base → link_eef`；URDF 单位为米、弧度，界面使用毫米、角度。姿态采用四元数，显示 RPY 为 `Rz(yaw) × Ry(pitch) × Rx(roll)`。RPY 在 pitch 近 ±90° 时存在表达奇异和多解，四元数仍表示有效姿态。
- 初始和复位关节为 `[0, -0.5, 0, 0, 0.5, 0]` 弧度。`link_eef` 是 URDF 中相对 `link6` 零偏移的固定坐标系，不含末端工具。
- 数值求解阈值为位置 0.35 mm、旋转约 0.344°；只有库报告收敛、关节不超限且复算误差不超过 1 mm / 1° 才接受结果，否则恢复上一次有效姿态。不能保证每个可达目标都能从当前初值找到解，也未检查碰撞或路径。

## 独立 FK 基准

`scripts/generate-mujoco-fixtures.py` 从项目内的同一原始 URDF 读取关节变换，移除与 FK 无关的视觉及碰撞几何，保留固定坐标系，使用 MuJoCo 3.15.0 的 `mj_forward` 获取 `link_base` 与 `link_eef` 位姿，写入 `tests/mujoco-fk.json`。七组涵盖默认、零位、一般姿态及接近腕部奇异姿态。自动测试要求相对 MuJoCo 的位置误差小于 0.1 mm、旋转误差小于 0.01°。

IK 测试使用六组由关节姿态生成的可达目标，包括接近腕部奇异的目标，要求误差小于 1 mm / 1°、所有关节在 URDF 限位内；另测试不可达和非法输入的回退。测试覆盖有限，不能代表真机精度或完整工作空间。
