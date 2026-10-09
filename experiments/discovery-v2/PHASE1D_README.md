# Phase 1D：真实固定快照探针

本阶段只验证公开 API、仓库身份、固定对象和 Phase 1A 比较器的组合。生产分析器没有接入 Discovery。三个公开 MIT 样本的 revision、文件和许可证沿用 `fixtures/manifest.json`；只读取各自 `index.js`，不执行仓库源码。

## 离线重放

在 WSL2 Ubuntu、仓库根目录运行：

```sh
node --test test/discovery/*.test.ts
node experiments/discovery-v2/run-phase1d.ts
node experiments/discovery-v2/run-phase1d-failures.ts
```

输出分别在 `artifacts/discovery-v2/phase1d-mock/` 和 `artifacts/discovery-v2/phase1d-failures/`。失败场景均显式标注为 synthetic Mock。Phase 1C 的旧数字 ID 子路由重放需要显式 `historicalRoutes: true` 和注入 transport；默认 provider 禁止数字 ID Git 子路由。旧 `run-phase1c-live.ts` 已转交本阶段入口，不再向真实 API 使用旧实验路径。历史固定 Sidecar 不变。

## 单次真实探针

```sh
node experiments/discovery-v2/run-phase1d-live.ts --live
```

默认测试不会执行此入口。它只检查已保存的 Phase 1C 拒绝收据和本阶段最近收据的 rate-limit reset；若仍在零余额窗口，发出任何请求前停止。运行使用匿名 GitHub API，不读取环境 Token、其他程序凭据、历史或 `.env`。不自动重试或更换身份。共享 IP 的实时余量可能变化，因此不能保证下一次同样成功。

固定对象：`sindresorhus/p-limit`、`jucke/p-limit`、`sindresorhus/p-throttle`。显式名称只用于 bootstrap；随后 `/repositories/{id}` 返回的 Metadata 必须匹配 ID，后续 owner/repo 来自它。提交请求使用 manifest 完整 SHA，Tree 和 Blob 使用固定对象 SHA。最后 `/repos/{canonical-name}` 必须仍对应同一 ID 和名称。任何身份冲突、重定向或消失均返回 inconclusive，清除快照和绑定，不重启或混合对象。

输出 `artifacts/discovery-v2/phase1d-live/{sidecar,receipt}.json`。已成功运行的原始静态副本为 `phase1d-live-sidecar.json` 和 `phase1d-live-receipt.json`，内容摘要为 `03f08f5d399e45d950705813c5eae90c09389a33d6875b59299173edad5b399e`。两份文件分开保存确定性内容及时间、CPU 观察值、配额头；新收据不保存源码内容或认证信息。收到的 Blob 经 Git SHA-1、SHA-256 和旧 manifest SHA-256 三者校验后送入原有比较 worker。

离线检查静态收据：

```sh
node --input-type=module <<'JS'
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {validatePinnedProbe} from '../../src/discovery/pinned-probe.ts';
import {stableJSON} from '../../src/discovery/offline.ts';
import {sha256} from '../../src/discovery/snapshot.ts';
const c=JSON.parse(await readFile('phase1d-live-sidecar.json','utf8'));
const r=JSON.parse(await readFile('phase1d-live-receipt.json','utf8'));
validatePinnedProbe(c);assert.equal(sha256(stableJSON(c)),r.contentDigest);
console.log(r.contentDigest);
JS
```

上述检查命令在本 README 所在目录执行；联网和测试命令在仓库根目录执行。摘要校验验证保存内容一致性，不替代重新获取或 GitHub 签名认证。

## 边界

最多三个控制仓库、三个候选、每仓库八文件、128 KiB/文件、2 MiB 源码；24 attempts、并发 2、30 秒；每响应保留/解析 32 KiB、累计保守预留 1 MiB。实际收到、保留、预留和 overflow 单独计量。CPU 没有 hard budget，流取消不能保证实际线路字节绝对上限。树摘要通过 Git tree 序列化重算，Blob 摘要通过 Git blob header 重算；commit→tree 来自 GitHub API，未重建原始 commit 或验证签名。

所有比较仍为 `verification: pending` / `lineageClaim: none`。Known Fork 只描述 metadata 观察；未知对照没有人工标签。文件选择很小，结果不能用于 Recall@K、Precision@K 或仓库整体相似度。完整报告见 `../../docs/DISCOVERY_V2_PHASE1D_REPORT.md`。
