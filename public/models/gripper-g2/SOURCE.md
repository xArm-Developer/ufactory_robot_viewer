# Gripper G2 资产来源

- 七个分体 GLB 来自本地参考查看器（`3d/src/assets/models/`），其资产注明源自 [UFACTORY Genesis](https://github.com/xArm-Developer/ufactory_genesis) 和 [xArm ROS](https://github.com/xArm-Developer/xarm_ros2)；该本地查看器没有 Git 提交号可供记录。原始版权及许可见 `NOTICE.txt`、`XARM-LICENSE.txt` 和 `UF_GENESIS_LICENSE.txt`。
- `SHA256SUMS` 记录实际复制文件的 SHA-256。网格没有重新压缩或编辑。
- 参考查看器以 `Z=-1.498179100862778 mm` 为法兰面，并对底座及指垫进行视觉校准；本项目将整体几何上移该距离，使法兰面位于 `Z=0`。固定 TCP 沿夹爪基座 `Z` 轴为 `173.5 mm`，不再叠加视觉位移。
- 平行连杆与内侧开口的对应关系参考查看器 `src/kinematics.mjs` 和其 STEP 标定说明；0–84 mm 开口为几何估算，未用实体夹爪验证。参考 STEP 文件的 SHA-256 为 `24b69dc52369f06801ae10d670a26b6dac6cad0d52f10a9cd239bea20df4ab52`。
