# M2 Beta：边界修复与独立候选视图

2026-10-10。两个 P2 已修复；用户可以在 Explorer 打开 **Discovered Candidates**，点击实际搜索任务的候选阅读来源和固定文件测量，再返回原 Graph。新增四宽度交互及既有回归通过。**真实多文件实验为 partial：匿名 Core 配额耗尽，没有产生真实相似性成绩。**

## 基线与提交范围

实际起点 `5891056b4f808107cb15e4729c46951765582a58`，分支 `review/gitlineage-development`。起点只有未跟踪 `tools/`；该目录保持未暂存、未提交。Git/Node/测试/浏览器服务器均在 WSL2 Ubuntu-24.04，Node v24.21.0。

代码仅涉及实验 Preview、源码选择/导出合同、独立 Deep Search UI 与测试。没有修改 Graph Schema 2.0.0、Canonical Resolver/Policy、相似性算法、生产缓存、Graph 相机、移动导航或 OCI/Caddy/TLS。审查分支向现有 Draft PR #1 同步，不更新远端 main、不 Merge、不部署。完整提交 SHA 可从本文所属提交的 Git 历史复核。

## P2-1：枚举和可选源码分开

旧分支以 `files.length` 判断目录完成，过滤后的 README 等也算文件，因此出现“任务 completed 但没有可比较源码”；空树则误作目录不可用。

现在 `coverage.enumeration` 单独记录 `complete / partial / failed / unavailable`，`eligibleFiles` 记录实际可选文件数。完整列出空目录或仅含过滤文件的目录仍为 `state: listed`、`enumeration: complete`；当任一仓库没有可选源码，Source Task 为 partial，比较按钮禁用，保留过滤理由。截断/请求失败/深度或目录预算未覆盖与无有效源码分别记录。

新增 `discovery-source-preview-export@1`：Source Task 即使无法比较，也能下载独立收据，保留搜索、固定 ID/SHA、目录覆盖/过滤、任务关联与累计预算。校验器检查身份、可选数量、阶段请求合计、资源上限和内容摘要；pending / none 固定。它是新的独立合同，没有替换原 `discovery-preview-export@1/@2` 或 Phase 1A–1D Sidecar。

真实执行 Preview 路径的 README-only fixture 覆盖 Unit、HTTP、UI 及下载后重新校验。390、430、1280、1920px 均显示“enumeration complete / selectable sources 0”，任务 partial、比较禁用，下载保留同一覆盖状态。

## P2-2：固定候选集合提前校验

Source Task 显式保存 `searchTaskId / targetId / candidateIds`。`startCompare()` 在 `begin()`、Provider 请求和 Worker 启动前检查：源任务归属及完成状态、目标 ID、候选集合的完整相等、重复/缺失 ID，以及每个仓库的全部已选路径。同一集合调换顺序按固定 Source Task 顺序归一，避免导出位置错配。

集合变化、重复/缺失身份、跨搜索会话源任务、重复仓库选择、无效路径均提前抛错。Unit 核对没有新增运输调用，后续合法比较仍只读取两个所选文件；浏览器在两候选已固定时实际 POST 一候选比较请求，得到 400，GitHub fixture 请求数不变，再正常完成比较。拒绝不分配新阶段或重置预算。

## 候选视图与实际用户操作

Explorer 的授权预览新增 **Discovered Candidates**。它是原 SVG 之外的只读、可关闭候选卡片层，没有 canonical edges、连接箭头或新的自动布局引擎。沿用已有字体、纸面/边框、44px 控件、原生对话框与 Deep Search 证据详情。

卡片来自当前实际 Search Task，明确显示搜索目标的 ID/SHA、候选 numeric ID 和“Search observations”。未比较候选显示“Not compared — no score”；有效比较显示“Pinned file measurements available”。点击卡片打开该候选的完整搜索观察及已有固定相似性/文件/选择收据；没有有效比较则明确说明不可用。Unknown 始终 pending，lineageClaim none。

关闭后原 Graph 保持 mounted，viewBox、SVG CTM、URL、选择和缓存摘要不变。搜索/选择/比较/下载仍走原网络任务，访问控制、取消、请求前预留、失败计费、频率/并发及共享阶段账本保持。普通生产入口默认关闭预览。

曾发现候选层转入证据再返回时的焦点时序问题；已修复返回动作及两个对话框的焦点竞争，保留旧焦点断言并重跑通过。候选呈现是卡片视图，尚未添加画布内节点布局或连线。

## 一次真实公开多文件实验

入口：`node experiments/discovery-v2/run-m2-beta-live.ts --live`。默认测试不联网。先读取已保存 reset，旧窗口已结束；仅使用匿名公开 API，不读取任何其他程序凭据，不换身份、不扩大候选池、不重试撞限额。

真实浏览器执行 Search → Candidate → 固定 Tree → 每仓库选择两个文件 → Compare → 下载并重新校验。Graph 侧为明确标注的本地 fixture，搜索与源码请求为真实 GitHub。收据在 [live/receipt.json](experiments/m2-beta/live/receipt.json)，下载原件在 [live/comparison-sidecar.json](experiments/m2-beta/live/comparison-sidecar.json)。

| 仓库 | numeric ID | 固定 commit SHA | 用户选择 |
|---|---:|---|---|
| sindresorhus/yocto-queue | 315531538 | 72a8fa96a9d389765cdf2bb9c6daba8302fc375d | index.d.ts、index.js |
| munachi-n/yocto-queue | 1168938776 | db05e3dcd2aabd33b5b325aa7646f8d2c4b1ffd0 | index.d.ts、index.js |

固定树返回两个仓库上述文件的 blob ID：`index.d.ts = 0475d9853a37ea304cac34ad41b1ac3736447ff3`，`index.js = 627ed535f3163b37f2e3b208a23788fd0a715eba`。这只是固定目录观察，不等于完成源码比较或谱系验证。

目标列出 13 个文件、4 个可选、过滤 9 个；候选列出 11 个、4 个可选、过滤 7 个。目录遍历分别 3 / 1 个固定 Tree，预算内目录没有剩余未列路径，仍不是全仓源码扫描。Search 仅第一页三个返回结果，39 个命中中有 12 个可访问页面未请求，保持 partial_provider。

搜索 4 次、目录 8 次、比较实际网络 2 次，累计 **14 HTTP attempts**。reserved 458,752 bytes，received = retained = 79,758，overflow = 0；所选文件计量合计 7,156 bytes（因 Blob 读取未完成，不代表已下载或比较的源码字节）。活动工作 7,901.83 ms，包含人工选择/cooldown 的总交互 34,936 ms；三个阶段约 2,356 / 4,100 / 1,446 ms。没有改动累计 30 秒活动工作预算，也不将自然交互时间冒称 30 秒以内。

目标第二个真实 blob 请求返回 200，同时 `x-ratelimit-remaining: 0`、used 60、reset `1791556829`。Provider 随即停止；候选 blob 和最终 metadata 核实没有再发送。下载中保留这些未完成请求与路径，最终快照身份结论为 inconclusive，bindings 被撤回，candidate/summary 为 null，**没有文件对测量，也没有可交付的完整 SHA-256 版本绑定结论**。验证仍 pending / none。不能把固定 Tree 中相同 blob ID 或已有 Fork metadata 当作完成比较。

这次没有达到“成功比较一组真实多个文件”的目标，明确交付 partial；没有重复调用、Mock 伪装成功或配额绕过。真实 API 同步收据中的缓存 before/after 完全一致。

## 验收与证据

- Typecheck / Build：通过。
- Unit：565 项，562 PASS，3 个既有联网测试 SKIP，0 FAIL。
- Discovery：118 PASS；Phase 0：6 PASS；Phase 1A/1B/1C/1D 离线固定入口全部通过，原固定结果与哈希文件无改动。
- Canvas 113/113，Landing 40/40，Analysis 16 状态无违规，Preflight 45/45，stale A→B complete / failed false。
- UI Contract 75/75，Responsive 71/71，Mobile 133/133。
- Deep Search / 候选层：21 场景，通过。四宽度分别覆盖未比较候选、选择/证据、返回、README-only partial、无结果、限额、取消；另验证多个搜索观察下载后完整保留。

[浏览器收据](experiments/m2-beta/validation.json) 保存实际 viewBox、SVG CTM、URL、Selection、缓存摘要列表及几何；[回归结果](experiments/m2-beta/regression.json) 保存执行状态；[截图索引](screenshots/m2-beta/index.html) 提供四宽度候选层、文件选择、比较和真实 partial 截图。固定 Mock 的 Unknown 可测得 100%，但始终 pending / none；这些数据不冒充公开 API 成绩。

浏览器为 Chromium，手机为触摸模拟；WebKit/Safari、实体设备未执行。候选层没有新增画布布局或自动派生判定。CPU hard budget 仍 unsupported，真实线路字节绝对上限仍不能保证。所有既有硬额度保持；源码文件还受原 24,000-byte 保守响应适配限制。真实多文件成功评测等待正常可用额度与后续明确执行，当前停止等待 Review。
