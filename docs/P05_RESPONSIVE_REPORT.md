# P0.5 响应式面板交付报告：Commit A

已修复桌面和平板的面板互相遮挡，并保留画布大小、缩放和证据阅读位置。
1280px 下打开 Context 会暂时隐藏 Evidence，关闭 Context 会恢复阅读；大屏允许双面板。
不需要你做任何事。本轮按任务允许的停止条件完成 Commit A；手机三视图与双指缩放留在 Commit B。

## 基线与提交边界

本轮开始实测 HEAD 为 `1ca934f792c32cb96a231b99ace8194b9a556ea3`，前四笔 P0 为：

- `1ca934f7`：P0 UI / Motion 不变量与证据。
- `f87db0c6`：回归入口与 Analysis 隔离测试。
- `115edd87`：屏幕尺度与拖拽/点击分离。
- `0b1a05a4`：工程规范、导航与 SVG 文本修复。

原工作区仅有未跟踪的 `tools/`，保持原样。Commit A 使用任务指定标题
`web: coordinate responsive overlay panels`；最终 SHA 见交付消息与本地 HTML。
未 push、未 deploy，也没有把本地检查当作线上验收。生产以用户提供的 `a4ff3532` 为准，本轮未重新核查线上。

基线先跑 Build 与 UI Contract：71/71 通过。新增可见性检查在基线只有 37/63 通过，
26 项失败，证据保存在 `artifacts/responsive/before/results.json`。
根因包括缺少根级 `--drawer-w` 定义，1280px 下 Drawer 实际宽 855px；
Context 和 Evidence 同时显示后只留下 161px 的图区域，344px 宽的关系行被遮挡。
旧 token 检查把 `drawer-w` 当作运行时变量豁免，现已取消该豁免。

## 面板状态转换

| 宽度 / 行为 | 默认 | 选中节点或关系 | 打开 Context | 关闭 Context | 关闭 Evidence |
| --- | --- | --- | --- | --- | --- |
| >=1600px | Context 开 | Evidence 开，可共存 | 双面板 | Evidence 留在原位置 | 清除选择，返回图目标焦点 |
| 1024–1599px | 图为主 | Context 收起，Evidence 开 | Evidence 暂藏，选择与滚动保留 | 恢复 Evidence | 清除选择，返回图目标焦点 |
| 768–1023px | 图为主 | 单临时 Evidence | 单临时 Context | Escape / Back / Close 恢复 Evidence | 清除选择，返回图目标焦点 |

单一 reducer 决定可见状态；不会通过两个处理器互相调用制造状态竞争。
Context 暂藏 Evidence 时保留原 DOM，而不是重新生成内容。
跨断点调整时保留缩放与选择；如果隐藏了正在聚焦的面板，将焦点移回 Context 入口。

## 实际截图与几何

打开本地 `artifacts/responsive/report.html` 可以并排查看实测截图和测量表。
1280px 修复前后的同源真实关系图截图分别在：

- 修复前：`artifacts/responsive/before/1280-context.png`。
- 修复后 Evidence：`artifacts/responsive/after/1280-evidence.png`。
- 修复后 Context：`artifacts/responsive/after/1280-context.png`。
- 大屏双面板：`artifacts/responsive/after/1920-context.png`。
- 平板：`artifacts/responsive/after/768-context.png`、`820-evidence.png`。

1280×800 的实际 Stage 始终是 `(0,44,1280,756)`，HUD 是 `(0,736,1280,64)`。
Drawer 从 855px 修正为 440px；Evidence 模式未遮挡图宽 840px，Context 模式 1016px。
选中关系行 `(374,409,344,22)` 与面板交集从 6446px² 降为 0；五点实际命中测试通过。
关系行不需要保护平移时，CTM 始终为 `[1,0,0,1,-320,-138]`，
节点尺寸 216×52px，世界焦点 `(960,560)`。

当 1280px 下选中节点受到 Context 遮挡时，只平移 170px：
CTM 从 `[1,0,0,1,-320,-138]` 变为 `[1,0,0,1,-150,-138]`；
节点从 x=102 移至 x=272，尺寸仍是 216×52px，世界焦点从 `(960,560)` 变为 `(790,560)`。
缩放和 Stage 不变。反复开关三轮没有累计漂移；关闭面板不把相机弹回旧位置。

旧“所有 CTM 分量、节点位置及焦点在任意面板切换时必须相等”的断言已过时：
它禁止任务明确允许的有限保护平移。现在保留 Stage、CTM 尺度与节点屏幕尺寸不变，
同时要求完整目标可见、交集为零、可点击、重复开关无累计漂移；没有更新截图基线来掩盖失败。

七种视口均测量真实矩形、CTM、viewBox、未遮挡范围、选中目标、面板/HUD 交集和命中结果：
1920×1080、1600×900、1280×800、1024×768、768×1024、820×1180、844×390。
844px 横屏按 CSS 宽度执行临时面板策略，不代表手机竖屏已通过。

## 触摸与焦点证据

使用 Chromium CDP 的真实 touchStart / touchMove / touchEnd 输入，而非直接调用鼠标处理器。
在 97 条真实关系的节点 Evidence 中，内容高 3030px，可视高 692px；
原生触摸滚动后相机与选择不变，Context 开关后精确保留滚动偏移。
画布空白处触摸拖动后 Evidence、选择和 HUD 保持。
测试等待惯性滚动结束与 resize 状态更新后再测量，不将异步中间帧当成最终状态。
节点和关系关闭 Evidence 后焦点返回图目标；隐藏聚焦 Context 时焦点回入口。

## 回归与可复现入口

全部命令使用 WSL2 Ubuntu 执行，浏览器检查针对最终构建 bundle。
单元测试包含重建 dist/web 的检查，必须先结束 unit/build 再运行浏览器套件。
本轮一次错误并行导致临时首页 404，已重新按正确顺序构建并运行，不计作最终通过。

| 检查 | 结果 |
| --- | --- |
| `npm run build` | PASS |
| `npm run typecheck` | PASS |
| `npm test` | 437 PASS，0 FAIL，3 SKIP（既有显式 live 网络测试开关） |
| `npm run test:canvas` | 113/113 PASS |
| `npm run test:landing` | 40/40 PASS |
| `npm run test:analysis` | 16 个状态，0 违约，无页面异常 |
| `npm run test:preflight` | 45/45 PASS |
| `npm run test:stale` | PASS，A→B 完成且无陈旧泄漏 / 页面异常 |
| `npm run test:ui-contract` | 75/75 PASS，包括原生 Chromium 200% |
| `npm run test:responsive` | 71/71 PASS |

日志保存在 `artifacts/p05-*.log`，响应式 JSON 和截图保存在 `artifacts/responsive/after/`。
原生 200% 测得 innerWidth=640、innerHeight=400、devicePixelRatio=2、visualViewport.scale=1，
保留 P0 在紧凑浏览器缩放下的交互检查；不把这个结果当作手机端验收。
新增 `test/panels.test.ts` 验证断点、隐藏选择、窗口转换、最小平移和重复保护不漂移；
`test/web/responsive-acceptance.ts` 验证真实浏览器可见性、触摸与焦点。
UI Contract、Motion Contract 和 AGENTS 已将这些检查固化为未来修改的门槛。

## 明确未完成与后续边界

手机审计发现现有实现没有三视图导航、系统返回、手机操作菜单或双指状态管理，
需要独立新增导航与手势子系统，超出本轮有限面板修复。按原任务停止条件，不混入半成品 Commit B。

- 390×844、375×667、430×932 的 Mobile Explorer 尚未实现 / 验收；因此没有虚构三视图截图。
- Graph / Relations / Evidence、真实关系列表双向定位、独立详情、safe-area、软键盘处理留待 Commit B。
- Pinch 不误触点击、双指结束不清选择、Sheet 拖动关闭尚未实现 / 验证。
- 没有可访问的物理手机；本轮触摸输入来自 Chromium，不等同于硬件触控验收。
- WebKit 未安装：缺少 `webkit-2359/pw_run.sh`；Mobile Safari / iOS 未验证。
- 高倍率下目标大于可用图区域时，仅平移无法保证整对象放入；保持用户 zoom，不擅自缩小。
  未展开聚合成员没有现成行可保护；直连边只保护视觉标签，不保护整条连线路径；标签不接受指针事件，真实路径命中未纳入新增验收。
- 除无障碍原生 200% 外，不能将已通过的默认缩放视口外推为任意高倍率 / 任意图数据验收。

不需要你做任何事。尚未上线；后续阶段是完整的手机交互实现和设备验收。
