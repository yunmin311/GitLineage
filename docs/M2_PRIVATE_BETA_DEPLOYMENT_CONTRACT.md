# M2 Private Beta deployment contract

Status: contract for a future separately authorized private deployment. This change enables no production route. The evidence in the companion report is loopback WSL staging with a fixed Mock GitHub transport, not OCI acceptance or public release.

## Process and trust boundary

Run a dedicated Caddy process/configuration and a dedicated Beta process. The existing public service, Caddyfile, IP attribution/rate limiting, TLS/DNS, Canonical Graph, cache and jobs remain untouched. Local staging listens only on loopback. A future remote listener requires separate authorization, a fixed HTTPS origin and a normally trusted certificate chain; this report does not authorize opening it.

The Beta process binds `127.0.0.1` only. The explicit entry is `npm run preview:private-beta`, never `npm start`. Default public startup does not install a Beta handler. Configure:

| Setting | Contract |
| --- | --- |
| `GITLINEAGE_PRIVATE_BETA` | Explicit `1` only in the dedicated service. Otherwise entry refuses startup. |
| `GITLINEAGE_BETA_ORIGIN` | One exact HTTPS origin, including nonstandard port. No aliases or proxy-derived origin. |
| `GITLINEAGE_BETA_UPSTREAM_PORT` | Separate loopback HTTP port; local template uses 8083. |
| `GITLINEAGE_BETA_PROXY_KEY` | Required by the explicit HTTPS entry: 32 random bytes encoded as 64 lowercase hex characters, shared only with the dedicated Caddy process. Gate's optional marker preserves existing direct local preview compatibility. |
| `GITLINEAGE_BETA_ADMINISTRATORS` | JSON array of fixed `id`, random `salt`, and scrypt `passwordHash` generated using Gate's `passwordHash`. No plaintext passwords. Store in an owner-only service configuration, never in argv, HTML or exports. |
| `GITLINEAGE_BETA_STORE` | Absolute independent persistent directory, service UID owned, 0700. State and lock are 0600. Must be physically separate from checkout/cache/jobs, including symlink aliases. |
| `GITLINEAGE_CACHE_DIR`, `GITLINEAGE_JOB_STORE_DIR` | Dedicated staging/private Graph cache and job paths, separate from production. Never point to production data. |

Use the sanitized `docs/config/private-beta-staging.Caddyfile` template. Certificate and key placeholders must be replaced locally; neither private keys nor state are source artifacts. Do not print an adapted configuration containing the proxy marker. Administrators and server configuration are trust inputs; do not grant those files to browsers or untrusted users.

## Proxy contract

[Caddy's documented reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) normally creates `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host`. This was observed with a real default proxy and is incompatible with Gate's intentionally strict context check.

The dedicated route checks the exact incoming authority, refuses client-supplied standard forwarding fields and proxy marker, preserves a fixed Host, removes only Caddy's standard forwarding fields and injects its private marker. Other `X-Forwarded-*` fields are passed to Gate and rejected there; removing every such field would hide forged client input. Gate retains its rejection of all forwarding fields, exact Host/Origin, cross-site fetch checks, JSON and CSRF header requirements. The dedicated service checks this marker and rejects forwarding fields before routing any request, including public Graph HTML and health endpoints. A direct loopback request without the marker is rejected before routing/auth/task/resource admission. The Gate also checks the marker on its own routes. The marker is additional proxy authentication, not a replacement for administrator authentication. It is not a defense against an attacker who already controls the service UID or host.

POST requires exact `Origin: GITLINEAGE_BETA_ORIGIN`, `Content-Type: application/json` and `X-Gitlineage-CSRF: 1`. TLS sessions use `__Host-gl_beta`, Secure, HttpOnly, SameSite=Strict, Path=/ and no Domain. Login rotates prior sessions for the identity; logout/expiry/restart revoke access. A session authenticates one identity, not arbitrary task ownership. Beta login and Explorer HTML have `frame-ancestors 'none'` and `X-Frame-Options: DENY`.

Do not use `ignoreHTTPSErrors`, insecure curl, disabled SSL checks or forged proxy headers as a compatibility workaround. Local test trust is installed only in a temporary NSS browser HOME and explicit Node HTTPS CA option. No OS-wide CA mutation is needed.

## Admission and resource contract

Production defaults stay closed. Authenticate and validate request context before creating tasks, reserving budget or starting provider/Worker work. Existing limits remain:

- At most two active tasks globally, one per identity; 90 requests/minute per identity, 10 login attempts/minute globally, two searches/hour per identity.
- 96 reserved HTTP attempts/hour service-wide. Each new search reserves all 24 attempts durably before engine work. Sessions, identities, cancellation, timeout and restart do not refund reservations. Provider rate exhaustion blocks other identities too.
- Combined search/source/compare session uses existing composition ledger: at most three candidates, eight source files/repository, 128 KiB/file, 2 MiB source total, 24 HTTP attempts, concurrency two, 30 seconds per bounded task, default 32 KiB retained response and 1 MiB conservative network reservation. Repeated stages cannot create fresh unbounded coverage.
- Received/retained/reserved/overflow remain distinct measurements. There is no CPU hard budget or guarantee of an absolute wire-byte cap. The provider's stricter timeout may end a hung request before 30 seconds.
- Request body: 4 KiB hard cap and absolute five-second read deadline.

The future service should be provisioned with OS limits as a separate reviewed operations step; no such strong isolation is claimed by this staging test. The current implementation is single-instance, not distributed. It has no OAuth, billing or general account management.

## Storage, recovery and graph isolation

State saves write a private temporary file, fsync it, rename atomically, then fsync the parent directory. Failed persistence latches admission closed. An instance lock refuses another process or a stale abnormal-exit lock. A restart marks unfinished tasks partial and keeps the reserved quota; sessions are deliberately not persisted. See operations for manual stale-lock recovery.

Tests demonstrate graceful restart and real SIGKILL recovery, not power-loss durability. Filesystem, mount and hardware guarantees remain deployment prerequisites. No power-cut simulation was performed. Do not reset/delete state to reclaim budget.

Task ownership, sampled source choices, measurements and exports belong to independent Beta state. Canonical Graph/cache is not a target for those writes. `verification=pending` and `lineageClaim=none` remain mandatory; a known Fork control and high similarity do not promote measurements to proof. Exports contain search provenance and pinned objects but no passwords, proxy marker or session token.

## Future deployment prerequisites

A separately approved private origin, trusted certificate lifecycle, dedicated service UID and owner-only secret provisioning, isolated state/cache/jobs, firewall/listener review, retained budget-aware backups, monitoring/rotation procedure and an OCI-specific proxy/service smoke test are still required. This contract does not replace those checks or authorize deployment, public access, DNS changes or PR merge.
