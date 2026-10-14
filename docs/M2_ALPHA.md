# M2 Alpha — authorized local Deep Search

已实现可操作的最小流程：输入公开仓库 → 有界 Repository Search → 用户选取最多两个候选 → 固定版本源码比较 → 展开摘要/路径/匹配区间/请求收据 → 下载独立 Sidecar → 返回 Graph。普通生产入口默认关闭，未部署。

## 启动和使用

在 WSL2 Ubuntu、仓库根目录执行：

```sh
npm run build
GITLINEAGE_DEEP_PREVIEW=1 npm run preview:deep
```

打开终端输出的临时本地授权链接。该链接只在当前进程有效，不要发布或通过公网代理开放。服务固定监听 `127.0.0.1:8082`。打开 Deep Search 后填写公开 owner/repo，点击 Search candidates；搜索结束后勾选候选，再点击 Compare selected。两次任务启动之间至少等待 15 秒；过早提交会明确提示 cooldown。

这个入口使用真实匿名 GitHub API，没有演示数据替换。GitHub 限额、入口文件不适用或响应过大时会保留部分完成/不可用收据。常规 Graph 分析沿用原服务；只操作 Deep Search 时，实验候选不会写入 Graph 或 Standard AnalysisCache。

## 入口和安全边界

`src/web/serve.ts` 只有显式 handler 注入点，没有 Discovery import；正常 CLI 只返回 disabled capability。`serve-preview.ts` 要求显式环境开关，安装独立实验 handler。客户端 capability disabled 时不创建工作区。

授权链为随机进程 nonce → 不记录路径的授权端点 → HttpOnly / SameSite=Strict 本地 cookie。要求 loopback socket、localhost/127.0.0.1 Host，拒绝 Forwarded/X-Forwarded-* 常用转发头；POST 要求精确同源 Origin、JSON 和闭合字段集，最多 2048 字节。没有接收 Token 的接口，不读取本机其他凭据。operator link 与 cookie 不写入收据、缓存或日志。

输入只接受公开 GitHub owner/repo 或对应 HTTPS URL。所有外部目标由现有 GitHub provider 构造，禁止任意目的地址，不执行仓库代码，不自动跟随重定向。候选必须出自当前搜索结果并具有无冲突 numeric ID。

## 数据流

搜索任务复用 RepositorySnapshotResolver：用户名称 bootstrap → numeric ID metadata → canonical owner/repo → 完整 commit SHA。再复用 Phase 1B name query，仅一条查询、第一页三条结果；目标 ID 被排除，最多保留三个候选，候选 SHA 尚未解析。Search 的索引排名只是候选相关性，不是代码分数。

比较任务复用 runPinnedProbe / Phase 1D 官方 owner/repo Git API：目标使用搜索时固定 SHA，候选独立核实 ID 并固定 SHA；tree/blob 校验对象摘要和 SHA-256，最后再次核实 owner/repo 的 ID。失败不混入其他仓库内容。使用 Phase 1A worker 做 exact blob、strict token5、normalized token5；未修改算法、阈值或旧固定结果。

第一版仅选择 `index.js`、`index.ts`、`src/index.js`、`src/index.ts`。缺失路径、过滤、解析失败、预算不足均由原收据保留。文件级成功测量可以阅读；有未完成路径时整体 partial，不能称为仓库整体相似度。没有有效输入时不生成零分。Fork metadata 单独展示，Unknown 始终 pending；所有输出 verification=pending、lineageClaim=none，没有 Verification Adapter。

结果仅在进程内存保存，最多 12 个任务、30 分钟读取有效期。Sidecar 手动下载，Discovery 不写磁盘缓存。未来服务化和更广入口选择属于下一阶段。

## 预算

每次搜索/比较是独立任务：24 HTTP attempts、2 search attempts、最多 3 个候选、比较最多 2 个；每仓库 8 文件、每文件 128 KiB、源码总量 2 MiB、30 秒、worker 并发最多 2。网络每次请求先预留，默认单响应保留/解析最多 32 KiB、累计保守预留 1 MiB；received / retained / reserved / overflow 分开记录。全进程同时一个任务，启动间隔 15 秒，最多 4 次启动/分钟。

403/429/remaining=0/Retry-After 记录配额窗口并阻止新任务，不切换认证、不反复撞限额。CPU hard budget unsupported；流式接收可越过保留上限，不能保证真实线路字节绝对上限。30 秒不足时保留 partial/cancelled 和已完成测量。取消实际传播 AbortSignal，不只关闭 UI。

## 可重复验证

```sh
npm run test:deep-search
node --test test/discovery/preview.test.ts
node experiments/discovery-v2/run-m2-controls.ts
```

真实联网验证单独显式执行，不加入默认测试：

```sh
node experiments/discovery-v2/run-m2-live.ts --live
node experiments/discovery-v2/run-m2-live.ts --live yocto
```

该 browser probe 使用既有本地 Graph fixture，Discovery 使用真实匿名 API；先检查保存的配额信息，整个探针不自动扩展候选。生成收据及截图于 artifacts/deep-search。固定 Mock 测试通过正式路由使用真实算法和构造 Git 对象，绝不冒充真实 GitHub。

具体结果、局限与回归见 [M2_ALPHA_REPORT.md](M2_ALPHA_REPORT.md)，OCI 与远端分支安全证据见 [OCI_REVIEW_BRANCH_AUDIT.md](OCI_REVIEW_BRANCH_AUDIT.md)。
