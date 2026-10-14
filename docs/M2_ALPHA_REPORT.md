# M2 Alpha — delivery and evidence, 2026-10-09

## 结论

**OCI 审计 SAFE；独立审查分支已同步。M2 Alpha 首个操作流程实现并通过本地浏览器验收，未发布到生产。**普通入口默认关闭。授权本地预览支持真实搜索、显式选择比较、证据阅读/下载、取消和返回 Graph。

起点：main / `3195ffaa36ca3e3b6b5a39392f25c39e6c9fcfc7`；远端 main / 生产均 `a4ff353275925860e02c7c69d165a1a4701a5698`，领先 21 笔提交；初始工作树只有未跟踪 tools/。当前开发位于 `review/gitlineage-development`。Draft PR：[GitLineage #1](https://github.com/yunmin311/GitLineage/pull/1)，[完整 Compare](https://github.com/yunmin311/GitLineage/compare/main...review/gitlineage-development)。最终提交 SHA 在 Git 历史和 PR 中记录，避免报告自引用 SHA。

## 生产和权限

[只读审计](OCI_REVIEW_BRANCH_AUDIT.md) 已核实 systemd → Node → 独立 detached checkout，Caddy 只负责 HTTPS/反向代理。检查相关 crontab、timer/path、服务、监听端口、release 脚本及 GitHub Actions/webhook。没有审查分支自动部署机制；没有生产写入、重启、环境变量变更或 deploy。

预览入口严格限制为本地显式启动和进程授权链接，同源 JSON POST；匿名、转发、CSRF、任意目的 URL、额外 Token 字段被拒绝。全进程单任务、15 秒启动间隔、四次/分钟。不能直接公开这些实验接口；未实现公共账户/用户授权服务。启动方法见 [M2_ALPHA.md](M2_ALPHA.md)。

## 实际真实 API 浏览器结果

两次均为显式匿名 GitHub 调用；标准 Graph 使用既有本地 fixture，不把 Mock 声称为真实 Discovery。

### p-limit：保留失败，未造零分

[原始收据](experiments/m2-alpha/live-p-limit.json)：搜索固定 target ID `71542716` / SHA `a8a6fbec4e0e866d6d779b10889bb4f5567e70eb`。第一页三项中排除目标，发现 `1inch/limit-order-protocol` 与 `nullice/limitpng`。显式选中前者，无支持入口文件，比较无 score，reason 为 `no eligible identity-checked pinned source`。

目标 index.js 已真实读取，Git blob `c24de5782032605aa83636bcf455f700e3b2ada7`，SHA-256 `edde12a4a4dbdbe8d27161cdd0853db0bab435d5dc6c15f9f4dedc27ee9bca60`；不能因候选不可比较而说不存在关系。搜索 4 请求，比较 9 请求，总 13。probe 含冷却/Graph UI 的时间 26.896 秒；每项任务独立 30 秒预算。搜索仅部分覆盖，有大量未取页。

### yocto-queue：真实成功文件比较，Unknown 保持 pending

[原始收据和缓存前后摘要](experiments/m2-alpha/live-yocto.json)：输入 `sindresorhus/yocto-queue`，搜索发现 `munachi-n/yocto-queue` 与 `mosquito18/yocto-queue`，明确选择前者。

| 身份 | numeric ID | 完整 pinned SHA |
|---|---:|---|
| sindresorhus/yocto-queue | 315531538 | 72a8fa96a9d389765cdf2bb9c6daba8302fc375d |
| munachi-n/yocto-queue | 1168938776 | db05e3dcd2aabd33b5b325aa7646f8d2c4b1ffd0 |

两者真实 `index.js` 均 1587 字节，Git blob `627ed535f3163b37f2e3b208a23788fd0a715eba`，SHA-256 `2eabf3096793c43934ef127fb50238dcba93074fb54f943fc62aeab616769dfc`。pre/post numeric ID、固定 commit→tree→blob、Git blob SHA/SHA-256 和路径绑定均通过现有 Phase 1D 读取器核实。

- exact_blob / git-blob-sha1@1 = 1。
- strict_token5 / token5-set@1 = 1，239 shared shingles，12 组返回匹配区间。
- normalized_token5 / token5-set@1 = 1，215 shared shingles，12 组返回匹配区间。
- 268 / 268 tokens；结果只是当前 index.js 文件测量。三个其他固定入口不存在，因此 overall partial，未生成仓库整体谱系概率。
- 候选没有独立谱系验证，Unknown；verification=pending、lineageClaim=none。

搜索 4 请求（含 1 Search），比较 10 Core 请求，总 14；probe 含冷却 24.613 秒。搜索/比较 received=retained 分别 31,382 / 56,676 字节，reserved 分别 131,072 / 327,680，overflow 均 0。末次 Core remaining=22，reset=1791553188。未读取或切换凭据、未绕过额度、没有重试限额失败。

临时标准 Graph 缓存的文件名+SHA-256 列表在 Deep 前后严格相等；该证明写入真实收据。固定 Mock 四个宽度也逐文件校验不变。Discovery 模块没有 Graph/cache 写入接口，UI 不更新 Canonical Graph。

## 可重复控制集

[13 例结果](experiments/m2-alpha/controls.json)，由 `run-m2-controls.ts` 复用现有合法、固定版本 Phase 1A 样本，无新搜索/算法/阈值。原 content digest 保持 `546af0c31bc3434abca4f64ff8691457373a2c3449363b641f30eb53d637167c`；0 HTTP requests；本轮耗时 3.584 秒。

| 样本 | 标签依据 | strict / normalized |
|---|---|---|
| p-limit → copy-reinit | MIT 源码复制、独立初始历史，构造正例 | 1 / 1 |
| p-limit → format-path | 格式/路径修改，构造正例 | 1 / 1 |
| p-limit → jucke/p-limit | 已记录的公开 Fork metadata + 共同历史 | .055072 / .141473 |
| logic-root → logic-renamed | 标识符修改，构造正例 | .023256 / 1 |
| template-app-a → b | 共享 scaffold，构造负例 | 0 / .108108 |
| generic-a → b | 通用片段，构造负例 | .137500 / .448276 |
| p-limit → yocto-queue / p-throttle | 真实、未人工验证，Unknown | .004932/.039063 与 .017387/.134794 |
| broken / small-only | 解析失败 / 有效输入不足，Unknown | null，不计负例 |

可见 Fork 身份不保证当前代码高相似，通用代码归一化可能高分。固定 Mock 浏览器额外构造 divergent Fork=0 与 identical Unknown=1，均 pending/none。没有把现实 Unknown 当作正例，也没有将分数作为 Verification。这个小型测试不能推导全 GitHub Recall/Precision。

## 回归和浏览器证据

| 检查 | 本轮结果 |
|---|---|
| Typecheck / Build | PASS；最终构建 app.js / app.css SHA 与浏览器验收构建一致 |
| Unit | 549 PASS，3 项既有 live skip，0 FAIL，共 552 |
| Discovery（含 Phase 1A/B/C/D + 7 个 preview tests） | 105/105 |
| Phase 0 | 6/6 |
| Phase 1A / 1B / 1C / 1D 固定入口重跑 | PASS；旧固定结果未改 |
| Canvas | 113/113 |
| Landing | 40/40 |
| Analysis | 16 states，0 contract violation |
| Preflight | 45/45 |
| Stale A→B | complete=true，failed=false，0 page error |
| UI Contract / Responsive / Mobile | 75/75、71/71、133/133 |
| 新 Deep browser | 四个宽度 + 403/cancel，6 场景 PASS |

新测试先验证入口缺失及搜索限额被误解为空结果的失败，再修复。没有删除旧测试或放宽断言；旧阴影规范发现新 launcher 用了字面 shadow 后，改为现有 sh-2 token。

四宽度 390/430/1280/1920：可搜索、勾选两候选、运行真实 worker、展开路径/摘要/区间、读取不可用原因、实际下载 Sidecar，返回后 URL、viewBox、实际 SVG CTM、selection 和 focus 保持一致；不存在水平溢出。390/430 使用 Chromium 原生 touch dispatch 验证工作区滚动且 Graph 相机不变。临时缓存逐文件一致；JS page errors 均为空。固定 Mock 与真实 API 的来源在 [浏览器收据](experiments/m2-alpha/browser.json) 和真实收据中分开记录。

截图保留于 `artifacts/deep-search/{390,430,1280,1920}-comparison.png`、`rate_limit.png`、`cancel.png`、`live-yocto/1280-live.png`。[已提交截图图册](screenshots/m2-alpha/index.html)，本地副本 `artifacts/deep-search/report.html`。这是 WSL Chromium 验收；未声称物理手机或 Safari/WebKit 验收。

## 已知限制与下一步

- 一条名称查询、第一页三条，GitHub 分词会返回弱相关项目；展示未取页，未提高召回算法或自动遍历。
- 只四个 JS/TS 入口，许多项目不可比较。所有项目中不存在的候选路径都显示 pending，整体通常 partial。
- 内存任务、单进程频率限制，不适合公开多租户；没有生产 Deep Search、Code Search、AI/BYOK 或 Verification Adapter。
- CPU 没有 hard budget，网络 received 不等于真实线路总字节。
- 下一最小切片：在同一 gate 内提供预算内 tree-derived 源码选择预览，让用户确认支持文件；继续保留完整路径/覆盖说明及 pending/none。生产开放必须另行处理服务级授权和运维评审。

完成本轮后停止，等待 GitHub Diff Review。未合并 main、未部署，tools/ 未暂存。
