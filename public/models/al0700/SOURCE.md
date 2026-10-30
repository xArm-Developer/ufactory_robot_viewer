# 直线滑轨（AL0700）资产来源

- 来源：[UFACTORY 官方下载中心](https://www.ufactory.cc/downloads) 3D 文件压缩包 `52I20XCHEZ1I.zip`（SHA-256：`f37e8f10407bb0f206d05c11311729807150622efe0e7273c5aa5b7dd006f902`），内含 `AL0700(Zero position).STEP`（SHA-256：`c25af9373a6618d4e104dfeeb8570ee8f4d2ca68cae59f7e854f3d01cacfb103`）。
- 使用 `occt-import-js@0.0.23`（`linearUnit: "meter"`，`linearDeflectionType: "bounding_box_ratio"`，`linearDeflection: 0.001`，`angularDeflection: 0.5`）三角化并由 Three.js `GLTFExporter` 导出二进制 `model.glb`，校验值记录于 `SHA256SUMS`。
- 原始 STEP 的 51 个零件均无颜色。当前黑色上盖与端盖、深灰滑块及银色侧梁和安装板配色参考 [UFACTORY 产品图](https://www.shop.ufactory.cc/products/direct-drive-linear-motor)，属于外观估计，并非 STEP 原始材质。运行 `node scripts/colorize-al0700.mjs` 可重复写入配色；`--check` 可校验配色、几何二进制及节点结构，零件索引和材质参数见脚本。
- 原始 STEP 共 51 个无名网格；按零位空间几何拆分为固定导轨组 `rail_fixed`（网格 `0–24, 35, 43–45`）与运动滑块组 `rail_carriage`（网格 `25–34, 36–42, 46–50`）。`part_35` 为整体 U 形拖链网格，无独立链节；运行时变形使上端随滑块移动、下端固定，弯曲段移动滑块行程的一半，不改动 GLB。
- 按零位 CAD 估算原拖链中心线约 `480 mm`，不足以覆盖 `700 mm` 行程；运行时将零位上下直段各延长约 `220 mm`，中心线总长约 `920 mm`，运动时保持弯曲半径和估算总长。固定端位置与链长未经实物核实；这是连续网格的视觉联动，不模拟逐节链片、线缆或动力学。
- CAD 坐标系轴向为 `Z`、高度为 `Y`；场景将 CAD 点 `(x, y, z)` 映射至世界 `(0.3435 - z, -0.03824 - x, 0.042 + y) m`，行程 `0–700 mm` 对应滑块沿 CAD `-Z`（世界 `+X`）平移 `0–0.7 m`，滑块上方机械臂 `link_base` 安装中心位于 CAD `(-0.03824, 0.065, 0.3435) m`（世界零位 `(0, 0, 0.107) m`）。
