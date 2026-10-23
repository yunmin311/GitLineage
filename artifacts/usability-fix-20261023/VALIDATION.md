# 本地验收记录

基线 main: `6b73e6f6b62c10daab1df8e8db615961164a725a`。WSL2 Ubuntu，Node 24.21.0，Chromium。最终浏览器测试使用同一生产 Bundle，`bundle.sha256`及本地`bundle-check.log`确认没有测试中重建。

| 命令/检查 | 最终结果 |
|---|---|
| `npm run typecheck` | PASS |
| `npm test` | 651 total / 648 pass / 0 fail / 3 existing live integration skips (`GITLINEAGE_LIVE`未启用) |
| `npm run build` | PASS |
| 缓存/History预算/Public Exploration/Registry针对性单测 | 17/17 PASS |
| `test:canvas` | PASS，113/113 |
| `test:landing`, `test:analysis`, `test:preflight` | PASS；Preflight 36/36 |
| `test:stale`, `test:ui-contract`, `test:responsive` | PASS；UI Contract 75/75，Responsive 71/71 |
| `test:mobile`, `test:site-continuity` | PASS；包含新Express真实点击及History Return |
| `test:exploration`, `test:unification` | PASS；按需父提交/分支后保留原交互检查 |
| `test:deep-search` | PASS，21场景 |
| `test:spatial-routing` | PASS |
| `test:discovery-v3-browser`, `test:discovery-v4-browser`, `test:discovery-admission-browser` | PASS |
| 六真实缓存样本 × 1280/390/430px | 18/18完成，0页面异常、0横向溢出、0外部浏览器请求；非空样本入口均真实可点击 |
| `node artifacts/usability-fix-20261023/cost.ts after` | PASS；A14/2432B、B16/2640B、C19/2835B；原始逐请求记录保留 |
| `git diff --check` | PASS |

原始失败：缓存20/20被429；Express390px More被工具栏挡住；Registry失败与无元数据混淆、重复依赖误报截断。见`RED_FAILURES.md`转录和本地未改写原始日志。已有Exploration/History Controls/Motion检查原先依赖初始化预取多条History，改为真实点击继续/分支读取后原断言保留；本地`exploration-eager-red.log`、`history-eager-red.log`、`history-motion-eager-red.log`保留首次失败，最终整套回归通过。

本轮未重新执行实时GitHub网络评测，复用历史真实收据；没有将固定传输当成实时GitHub结果。未执行WebKit、实体手机或用户本人试用。未部署、重启或改变线上/Beta。远端ARM64精确提交结果以PR检查及最终交付报告为准，不能用本地通过替代。
