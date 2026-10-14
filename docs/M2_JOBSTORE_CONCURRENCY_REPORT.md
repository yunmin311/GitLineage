# JobStore 并发持久化修复

基线：`4deb8140f7571a91799a224cdc3525a83d558e72`。仅修改公共分析 JobStore、Scheduler 及其回归测试；不改变 Job Registry 格式、Graph 合同、Discovery 算法或生产缓存。

## 原失败与确定性复现

原 [稳定 UI ARM64 CI 38056420914](https://github.com/yunmin311/GitLineage/actions/runs/38056420914) 的 Job `114225766561` 日志记录：同一 Job 在 collecting 后，rename `<jobId>.json.tmp` → `<jobId>.json` 返回 ENOENT。测试 `a completed artifact is served from cache without starting a job` 随后的 POST 返回 202，预期为 200；第二个 Job 又出现相同 rename 错误。

原因：JobStore.update 在写入前读取内存旧状态，多次异步 persist 共用同一个临时文件；Scheduler 的 onPhase 未等待 markPhase。一个写入 rename 后移走了另一个写入正在使用的临时文件。阶段记录、terminal 记录及 idle 判定之间也缺乏等待关系。

对基线 Store 仅加入测试用 persistence barrier，暂停 collecting，然后同时发起后续阶段、complete 和迟到的 collecting，实际重现 rename ENOENT。没有使用随机循环、延长轮询或修改原缓存测试。临时基线复现副本已移除；提交的测试使用同一受控暂停点检查修复后的顺序。

## 修复合同

- 每个 Job 有独立写入队列；不同 Job 仍可并行。执行写入时读取最新内存状态，迟到的旧阶段及 terminal 后的变更不覆盖新状态。
- 先完成文件写入和 rename，后更新内存索引。写入失败保留上一次成功状态，并通过对应调用的 Promise 返回；失败不阻断后续失败状态保存。
- Scheduler 按回调顺序等待 phase / timeout 写入；读取当前阶段、合法推进和日志发生在该队列内。发布前等待这些写入，出现错误则处理为失败。
- 完成保存后才报告 completed；未落盘的任务不报告 idle。run 的最终拒绝有明确错误日志，不留下未处理 Promise。
- whenIdle 包含创建中的任务、运行及排队任务、尚未结束的状态写入。

保持原有固定临时文件名及 JSON Registry 兼容性；安全性来自同一实例内同一 Job 的串行化。本次不增加跨进程共享 JobStore 的保证，不声称提供断电级持久性。

## 新增可复现测试

`node --test test/job-store-concurrency.test.ts test/web-jobs.test.ts`

新增四项，连同原 Job 测试共 30 项通过：

1. 暂停阶段保存，重叠提交后续阶段、terminal 和旧阶段；idle 等待，磁盘与内存最终一致，terminal 不被覆盖。
2. 注入一次写盘错误；调用者收到拒绝，旧状态保留，后续 failed 可以正常落盘。
3. 分析器立即连续报告各阶段；暂停 complete 保存，Scheduler 不报告 idle；释放后检查完整阶段顺序、磁盘 complete 以及缓存命中且分析器只调用一次。
4. Scheduler 的阶段保存失败被接收；最终内存及磁盘 failed、活动索引释放。Node 测试的未处理异常检测保持开启。

## 回归与边界

Typecheck、Build、最终完整 Unit（594 项：591 pass、3 项既有 live integration skip）、Discovery（134/134）、Phase 0（6/6 与离线 benchmark）、Phase 1A–1D、Production Preview Disabled 全部通过。Canvas 113/113、Landing 40/40、Analysis、Preflight 45/45、Stale A→B、UI Contract 75/75、Responsive 71/71、Mobile 133/133、Deep Search、Private Beta 浏览器回归通过。全部原断言保留，未增加 skip。

浏览器回归前后全部 dist/web 文件 SHA-256 一致。最终 Unit 后重新 Build，HTML/CSS/JS 与此前验收产物完全一致；build-manifest.json 因既有 builtAt 时间戳正常变化。最终构建重新记录整包摘要；真实 Caddy / 可信 TLS 的安全、额度与进程恢复测试及 390/430/1280/1920px Private Beta 浏览器闭环通过，测试期间整包摘要未变化。日志保存在本地 artifacts/private-beta/regression/jobstore-*.log，未提交认证状态或临时 CA。

浏览器验收使用 Chromium 模拟；可信 TLS Staging 使用真实 Caddy、本地 CA 正常验证和实际 Gate / Discovery Engine，GitHub Transport 为固定 Mock。不是新增真实 GitHub API 成绩、OCI 部署或公开发布。WebKit、实体设备与断电恢复未在本轮验证。

最新提交的两套 ARM64 CI 必须单独检查；不沿用基线 M2 运行的成功结论。PR #1 保持 Open / Draft；main 与生产服务不修改，原未跟踪 tools 保留。
