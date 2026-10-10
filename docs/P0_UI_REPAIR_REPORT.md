# P0 工程规范与 Explorer 交互整改

2026-10-08；基线 `a4ff3532`。仅本地整改与提交，未 push、未部署。

## 结果与提交

- 第一阶段 `0b1a05a4`：UI / Motion 契约、Agent 工作规则、Topbar、Landing 项目链接、SVG Hover 与实际宽度截断。
- 第二阶段 `115edd87`：Shell / World / HUD 分离、面板覆盖、相机映射、Pointer 拖动与点击分离、键盘焦点与 stale DOM 清理。
- 第三阶段 `f87db0c6`：既有验收脚本正式纳入 npm scripts，隔离分析 fixture。另将本报告与独立质量门禁提交为第四笔，SHA 见最终交付和 `git log -4 --oneline`。

没有引入 P1 Discovery V2、AI、BYOK、Git History 或新 Graph Explorer 功能。保留原有颜色、字体、图语义及构图容量边界；未改图数据生成。原有未跟踪 `tools/` 未纳入提交。

## 每项 P0 的根因和证据

| 项目 | 根因 | 修复与实测 |
| --- | --- | --- |
| A 导航与项目入口 | 混合行盒、revision/cache 基线错位；仓库身份未允许 Flex 收缩，长名称挤占操作区；Landing 没有项目链接 | 显式行盒与居中轴，身份优先截断，操作区不收缩；Landing 指向 GitLineage GitHub。1920/1280/768 同行中心差从 6.25px 到 0px；640 两行各自中心差 0px。长名称无页面横向溢出，主要操作可命中 |
| B Hover 与长文本 | SVG 命中矩形在文字之后绘制 Hover 填充，覆盖 glyph；字符数估算不反映实际字体宽度 | 背景先绘制、透明命中层最后绘制；字体就绪后以实际 getComputedTextLength 截断，为名称和 locator 各留区域。真实关系点击打开对应证据；Hover 文字暗色像素：基线 226→0，修复后 223→223。宽 W、中文与长 manifest 的实际 getBBox 均留在卡片内，完整路径保留在 title |
| C HUD 固定 | 图例属于随相机变换的 HTML world 层，缩放和平移带走图例；控制按钮与面板竞争空间 | 底部固定高度 viewport HUD，面板底边止于 HUD 上方。1280 下图例矩形 x=16,y=757,w=1140,h=22，反复 Zoom、Pan、Fit 前后相同，字体固定 10px；双面板时按钮仍可真实点击 |
| D 面板导致隐式缩放 | Rail / Drawer 占据 Grid 列，改变实际 SVG 尺寸；viewBox 未变仍会改变 CTM 和节点屏幕比例 | 面板使用 shell 覆盖层，Stage 保留整幅视口。测量 Stage、CTM、节点矩形、世界焦点及 viewBox，面板开关均保持一致，见下表 |
| E 拖动后误取消选择 | mousedown 直接进入 Pan，mouseup 后浏览器 click 继续执行空白取消或对象激活 | 主 Pointer 状态机：pending→位移超过 5 CSS px→Pan；越过阈值即抑制随后的 click，包括返回原点。实际鼠标与 CDP touch 拖动保留选择、Rail、Drawer、HUD；2px 空白点击仍可取消选择。Enter 打开证据并保留行焦点，Escape 关闭后恢复焦点；微小 wheel 使用比例缩放 |

## 面板开关的实际屏幕测量

下表的节点尺寸单位为 CSS px，CTM.a 为屏幕像素/世界单位。每次比较均来自同一页面同一数据集。

| 视口 | 状态 | 基线 Stage 宽 / CTM.a / 节点尺寸 | 修复后 Stage 宽 / CTM.a / 节点尺寸 |
| --- | --- | --- | --- |
| 1920×1080 | 打开 Drawer 前（Rail 可见） | 1656 / 1 / 216×52 | 1920 / 1 / 216×52 |
| 1920×1080 | 双面板 | 714 / 0.431159 / 93.130×22.420 | 1920 / 1 / 216×52 |
| 1280×800 | 无面板 | 1280 / 1 / 216×52 | 1280 / 1 / 216×52 |
| 1280×800 | 双面板 | 1016 / 0.793750 / 171.450×41.275 | 1280 / 1 / 216×52 |

修复后 1280 的节点矩形始终为 x=102,y=396,w=216,h=52，世界焦点始终为 (960,560)，viewBox 为 `320 182 1280 756`。1920 的节点矩形始终为 x=422,y=536,w=216,h=52。768 和 640 的独立开关检查也通过。

## 原生 200% 浏览器缩放

另开完整 Chromium 临时配置，在 `chrome://settings/appearance` 的 Page Zoom 中选择 200%。1280×800 浏览器视口实测 innerWidth=640、innerHeight=400、devicePixelRatio=2、visualViewport.scale=1。这与缩小视口/提高 deviceScaleFactor 的布局探针分别运行。真实点击主要操作、双面板、Zoom 和 Escape 均通过，无横向文档溢出或 runtime error。

## 测试结果与入口

| 检查 | 本地结果 | 证据日志 |
| --- | --- | --- |
| npm run build | PASS | artifacts/p0-build.log |
| npm run typecheck | PASS（含所有 test/web 脚本） | artifacts/p0-typecheck.log |
| npm test | 433 PASS / 3 SKIP / 0 FAIL，共 436 项 | artifacts/p0-unit-final.log |
| npm run test:canvas | 113 / 113 PASS | artifacts/p0-canvas-final.log |
| npm run test:landing | 40 / 40 PASS | artifacts/p0-landing.log |
| npm run test:analysis | 16 个状态 / 0 违反契约 | artifacts/p0-analysis-final.log |
| npm run test:preflight | 45 / 45 PASS | artifacts/p0-preflight-final.log |
| npm run test:stale | A→B 完成；五个真实轮询阶段均观察到，无 A 身份/计数/证据/图节点泄漏 | artifacts/p0-stale-final.log |
| npm run test:ui-contract | 71 / 71 PASS，包括原生 200% 的 7 项 | artifacts/ui-contract-after.log |

新增/正式纳入仓库的验收：`test/web/ui-contract.ts`；`landing-acceptance.ts`、`analysis-acceptance.ts`、`preflight-acceptance.ts`、`stale-acceptance.ts`；共享 `fixture-server.ts`；`test/ui-tokens.test.ts`。后者检查全部 CSS 自定义属性引用都有定义，以轻量质量门禁替代本轮引入 Stylelint 依赖。

Analysis 的 16 状态检查复用已有测试 hook；stale A→B 通过同一页面的 Landing 输入、返回和 B 输入，观察真正 scheduler / HTTP 轮询。两者使用已有真实缓存图（pebrel@51514bd50094、obsidian-config@3982a219c102），只控制调度时钟、隔离临时 job store，并等待 scheduler drain 后清理。因此它们证明 UI 状态机与隔离行为，不代表重新访问上游进行全量分析。

## 旧断言修正说明

在修改前已说明冲突：旧单元测试要求图例随世界变换、Drawer 占 Grid 第三列，以及允许面板压缩节点。这些与本轮正确契约直接冲突，替换为 HUD 固定、覆盖层和真实屏幕比例稳定检查。Canvas 的 camera 断言加强为节点屏幕矩形与比例也必须相同。行数预算断言改为匹配仍在运行的 `plateRowsFor`，保留容量边界。

Canvas 滚动条像素检查另发现旧脚本的取色正则在 evaluate 字符串中少一层转义，总回退到错误背景色；修正取色后重跑 113 项通过，像素容差未放宽。未批量更新快照、未删除失败检查。

## 实际截图与原始数据

本地可视报告：`artifacts/p0-ui-report.html`（依赖同目录下的证据文件，可离线打开）。

- Before / After 截图：`artifacts/ui-contract/before/`、`artifacts/ui-contract/after/`，覆盖 1920、1280、768、640 的 Landing、长名称、Hover、双面板；追加长 manifest 和原生 200%。
- 原始坐标/像素/交互值：上述两个目录的 `results.json`。
- Canvas 完整截图：`artifacts/shots/v2/`；Analysis/stale 截图：`artifacts/slice3/`。
- 代表图：`1280-long-name.png`、`1280-hover.png`、`1920-both-panels.png`、`1280-both-panels.png`、`long-manifest.png`、`native-200-both-panels.png`。

截图与日志为本地 ignored artifacts，未作为大体积 Git 提交。基线证据来自实际 a4ff3532 bundle，保留原始文件；后续复现必须先构建目标 revision，并使用独立证据目录，不能用当前 bundle 覆盖原始 before。

## 剩余边界

本轮没有观察到未解决的 P0 缺陷。浏览器自动验收覆盖 Chromium；未验证 Firefox/Safari、物理触控板硬件或真实触屏设备。三项单元 SKIP 保持既有配置，未计入通过数。没有提交线上发布动作，生产版本按用户要求保持 a4ff3532；本轮未重新查询部署状态。
