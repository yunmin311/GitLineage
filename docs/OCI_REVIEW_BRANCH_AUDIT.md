# OCI review branch audit — 2026-10-09

结论：**SAFE**。已检查实际部署入口及已知更新机制，推送独立的 `review/gitlineage-development` 不会触发当前生产部署。未执行任何生产写入、重启或部署。

## 直接读取的生产证据

通过既有 SSH 连接，只读执行 systemctl show/status、ps、readlink、git rev-parse/status、相关配置读取及构建摘要校验。未读取私钥内容或生产环境变量。

- `gitlineage.service` active/running，MainPID `94451`，启动时间 `2026-10-08 05:16 UTC`。
- WorkingDirectory `/srv/gitlineage/app`；ExecStart `/usr/bin/node src/web/serve.ts --client /srv/gitlineage/app/dist/web`；运行身份 gitlineage。
- app 中 src/dist/node_modules/package 链接到 `/srv/gitlineage/app/repo`。实际仓库为独立 checkout，detached HEAD `a4ff353275925860e02c7c69d165a1a4701a5698`，工作树干净。
- 进程实际 cwd 为 `/srv/gitlineage/app`，只在 `127.0.0.1:8080` 提供应用服务。
- `/etc/caddy/Caddyfile` 负责现有域名 HTTPS 和反向代理 `127.0.0.1:8080`，没有代码拉取逻辑。
- 生产 app.js、app.css、fonts.css、index.html 对现有 release `candidate-assets.sha256` 校验全部 OK。

## 更新入口审计

- ubuntu/root/gitlineage crontab 均无任务；`/etc/crontab`、cron.d/hourly/daily/weekly 的相关任务为系统维护，无 GitLineage 拉取、构建或重启任务。
- 18 个 systemd timer 和 5 个 path unit 为系统/Oracle 维护；相关服务无 webhook、Actions runner、容器自动更新或 GitLineage 自动部署入口。
- 实际监听端口及当前服务未出现 GitHub 事件监听服务；没有 docker/watchtower 部署机制。
- `/srv/gitlineage` 相关目录和项目既有 release 脚本表明：此前通过人工执行 release/switch 脚本发布固定 SHA。rollback 脚本是手动入口，无定时触发。
- GitHub Actions 仅 `arm64-validate.yml`，push 触发只针对 main，也可手动运行；只做验证，无 SSH 发布步骤。
- GitHub 仓库 webhook、deployments、environments 查询为空；Pages 未启用。GitHub App 安装权限 403 不用于阻止独立分支同步。

没有查询 OCI 控制面的全部未知自动化；本结论针对已核实的实际部署路径和已知触发入口，不宣称世界上不存在任何未知任务。未要求用户再次提供可正常使用的凭据。

## GitHub 同步边界

本地起点 `3195ffaa36ca3e3b6b5a39392f25c39e6c9fcfc7`，origin/main `a4ff353275925860e02c7c69d165a1a4701a5698`，21 笔领先提交。对这批历史新增的 173 个可达文件内容做过敏感信息检查，唯一命中的 GitHub Token 模式为既有安全测试中的故意伪造常量。未跟踪 tools/ 未暂存。

初次 push 已将上述 HEAD 发布到独立审查分支，远端 SHA 一致。Draft PR：[GitLineage #1](https://github.com/yunmin311/GitLineage/pull/1)。远端 main、生产 checkout 和服务均不由该操作更新。
