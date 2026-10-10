# M2 Private Beta Gate — 本地验收记录

基线 `f20f5ccbd278571449ade71852c84ef4f76e6c00`；审查分支 `review/gitlineage-development`。生产 main 基线 `1c31c1ccbb4657c8c0773e29faeb0b87203f8e4d`。未部署、未合并、未修改生产配置；保留 tools。

## 实际交付

独立入口 `npm run preview:private-beta`，仅绑定 loopback，需要显式开启、固定 Origin、管理员 scrypt 哈希配置以及代码/cache/jobs 之外的私有目录。正常生产启动即使收到开启环境变量，也不安装这个入口。管理员登录后复用已有搜索、固定源码树、文件选择和比较流程；可以下载并重新校验原有独立 Sidecar。登录、登出及任务路由不进入普通 HTTP 访问日志。

授权、存储及操作条件见 [合同](M2_PRIVATE_BETA_GATE.md)。服务上限：全局 2 个活动任务，每身份 1 个；每小时预留 96 个 GitHub attempts，每身份 2 次搜索；搜索预留 24 attempts，不因取消、失败、重新登录或重启返还。同一 Search/Sources/Compare 使用既有组合账本。身份频率 90/min；全局登录尝试 10/min。会话上限 15 分钟，重新登录撤销旧会话，退出和重启使会话失效。

## 2026-10-10 本地验收

全部在 WSL2 Ubuntu-24.04 / Linux Node 24 执行，Unit/Build 完成后才执行浏览器，浏览器期间未重建 dist。

| 检查 | 结果 |
|---|---|
| Typecheck / Build | PASS |
| Unit | 584 项：581 PASS，3 个既有 SKIP，0 FAIL |
| Discovery 离线 | 128 PASS，0 FAIL |
| Phase 0 测试与 Benchmark / Phase 1A–1D 离线入口 | PASS |
| 生产默认关闭 / 独立入口默认关闭 | PASS |
| Canvas / Landing / Analysis / Preflight / Stale A→B | PASS |
| UI Contract / Responsive / Mobile | PASS（Responsive 71/71；Mobile 133/133） |
| Deep Search / Discovered Candidates | PASS |
| Private Beta 浏览器 | 390 / 430 / 1280 / 1920px 全部 PASS |
| 正式构建一致性 | dist/web 全文件 SHA-256 前后相同 |

新增 10 个安全测试覆盖默认关闭、匿名与错误认证、CSRF/Origin/转发头、重复 Cookie、会话轮换/过期/退出、跨身份结果隔离、共享额度及重复登录、活动并发、取消、实际 provider 超时、重启与私有目录权限。身份频率耗尽后仍可成功退出并撤销会话，前端检查退出响应；非法选择与拒绝请求不增加真实 HTTP 调用；provider 限流跨身份阻断；秘密不进入保存结果及导出。

四种尺寸分别实际完成登录 → Graph → Deep Search → 搜索 → 源码选择 → 比较 → 证据 → 下载并重新校验 → 返回 Graph → 退出授权。每种尺寸固定 Mock 14 次请求，verification=pending / lineageClaim=none；Graph URL/viewBox 与缓存摘要保持一致，无页面异常。[截图与浏览器收据](screenshots/private-beta/index.html)。本轮未执行真实 GitHub 实验，以上不是公开仓库 Benchmark 成绩。WebKit、实体设备和公网/TLS 运行未验收。

M2 ARM64 工作流新增私有授权浏览器验收；稳定 UI ARM64 工作流保持原有断言，Unit 与生产禁用检查覆盖本次入口。远端运行链接及对应最终 SHA 在本轮交付报告单独提供，不把旧 SHA 的通过结果当作本次验收。

## 仍需的上线操作条件

本地/CI 通过不授权发布。未来私有部署需要独立批准的 TLS/反向代理路径、固定 Origin 与转发头策略、受保护的管理员配置与轮换、独立持久化目录和备份、单实例锁恢复流程、额度监控与管理员访问审查。异常退出时锁保留并拒绝启动，操作员确认旧进程停止后才能清除私有锁；重启明确标记未完成任务 partial，不能恢复旧 Preview 上下文。有效被盗 Cookie 仍是 bearer 凭据。无 CPU hard budget，也不声称线路字节绝对上限。公开、多用户和分布式部署不在本次交付范围。
