# 浏览器拦截观察（2026-10-15）

用户截图显示 AdGuard 的「日语过滤器」拦截了 `gitlineage.duckdns.org`，命中的是 DuckDNS 域名规则，而非截图中可见的站点内容检测结果。

只读核对上游 [JapaneseFilter/sections/specific.txt](https://github.com/AdguardTeam/AdguardFilters/blob/master/JapaneseFilter/sections/specific.txt)：其「Duck DNS phishing domains」段包含以下规则：

```text
/^https?:\/\/[0-9a-z-]{5,12}\.duckdns/$document,domain=duckdns.org
```

`gitlineage` 为 10 个小写字母，符合该规则。上游还为其他平台提供同类规则。因此该截图可由共享域名过滤解释；它本身不能证明 GitLineage 存在恶意内容，也不能代替完整安全审计。其他网络或插件的告警尚未获得可复现的证据，不能一并归因。

本轮没有修改域名、DNS、TLS、Caddy、过滤器或安全设置。后续可单独评估向过滤器维护者申诉或使用独立域名；本轮不执行这些操作。
