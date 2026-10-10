# Phase 1C：固定快照与有界比较

本目录只输出实验 Sidecar；生产分析器没有导入 `src/discovery/`。默认测试不联网，不写 Graph / Standard AnalysisCache，不执行下载的项目源码。

## 离线复现

在 WSL2 Ubuntu、Node >=22.18 内，从仓库根目录执行：

```bash
node --test 'test/discovery/*.test.ts'
node experiments/discovery-v2/run-phase1c.ts
```

输出 `artifacts/discovery-v2/phase1c-mock/{sidecar,receipt}.json`。提交的结果为 `phase1c-mock-sidecar.json` 与 `phase1c-mock-receipt.json`。预期确定性内容 SHA-256：

`a996cb856efd956807c8758432181bb9cb8dfce2477a8228505d0db8be594b84`

`phase1c-mock.ts` 使用固定时间、实际 Git 对象哈希构造的 commit/tree/blob、固定 Search/Metadata/Commit/Tree/Blob 响应。ID 2 是构造的共同历史正例，ID 3 是构造负例，ID 4 是未判定候选。三个都不是实际 GitHub Repository ID；这些标签不能作为真实 Precision / Recall 的依据。真实项目的 Phase 0 / 1A 固定语料保持原义。

失败场景通过 `test/discovery/e2e.test.ts` 独立注入响应，再核对实际 Sidecar：包括改名/转移、漂移、错误对象、截断、过滤、预算、取消和 Worker 超时。`boundary.test.ts` 用 Node 文件权限限制验证 E2E 的三组比较确实完成，并核对 Graph/cache sentinel 字节。

## 显式公开探测

```bash
node experiments/discovery-v2/run-phase1c-live.ts --live
```

这是单次、最多三个手工选择的公开仓库接口探测，不是 Repository Search：`sindresorhus/p-limit`、`jucke/p-limit`、`sindresorhus/p-throttle`。只有显式 `--live` 才联网，不自动读取凭据。已保存的 2026-10-09 探测在第一次 metadata bootstrap 收到 403/core remaining=0 后停止；未取得 ID、SHA、源码或测量。提交文件 `phase1c-live-sidecar.json`、`phase1c-live-receipt.json` 保留这一失败，不能声称真实链路通过。

数字 ID 的 `/repositories/{id}/commits/{ref}` 与 `/repositories/{id}/git/{trees|blobs}/{sha}` 路由仍需成功的 live 验证。失败时不回退至移动 HEAD、不跟随重定向。进入 Phase 2 前必须取得这段链路的成功收据；若 API 不支持，先设计 metadata-ID 再核实的 owner/name 固定 SHA 适配并单独 Review。

## 合同与预算

`discovery-candidate@2` → `repository-snapshot@1` → 校验每个来源绑定/内容摘要 → 原有 `discovery-candidate@1`。E2E 外层为 `discovery-e2e-sidecar@1`；它不能作为 Canonical Graph 输入。

固定 target 必须与输入的完整 SHA 一致；候选只解析一次 default branch，随后沿固定 commit tree 和 blob 哈希读取。每个选择路径保存原因；默认只选择 `index.js`。允许调用者给出最多八条、最多四层的明确路径，逐层非递归 tree 读取，没有全仓遍历。完整 tree 重算 Git SHA-1，blob 重算 Git SHA-1 与 SHA-256，文件绑定 ID/revision/path/bytes/parser/filter。截断 tree 保留可见路径的观察，但总体 partial，不能声称全量扫描。

最严上限：3 个候选、8 文件/仓库、128 KiB/文件、总源码 2 MiB、24 HTTP attempts（含 Search）、4 Search attempts、并发 2、30 秒总 wall-clock。默认响应预留 32 KiB/请求、1 MiB 累积预留；沿用 NetworkLedger 的硬 ceiling，不能扩大到超过 256 KiB/响应。32 KiB 的默认 JSON 响应限额会使 base64 源码实际可读上限低于 128 KiB；超限保留原因，不升级预算。响应取消后的线路字节无法完全测量，delivered 指应用 reader 实际收到的 chunk，retained 是保留的 chunk，reserved 不是实际下载量。

Search 与 metadata/tree/blob/worker 共用一个 Ledger；无需请求的拒绝收据不会计为实际 HTTP attempt。CPU hard budget 为 `unsupported`，收据 CPU/耗时是观察量。所有测量都保持 verification pending / lineage claim none；未知项目的 1.0 相似性也不能生成关系边。时钟、请求耗时、rate-limit headers 在 receipt 中，内容哈希不包含这些变化字段。

完整结果和回归见 `../../docs/DISCOVERY_V2_PHASE1C_REPORT.md`。
