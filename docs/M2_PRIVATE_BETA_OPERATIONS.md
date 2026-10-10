# M2 Private Beta operations

These instructions apply to a dedicated private service only after separate deployment authorization. The current deliverable is a loopback WSL staging test. Do not run them against production or alter the public Caddy/systemd/DNS setup as part of this task.

## Reproduce local staging

Use Ubuntu 24.04, Linux Node 24, OpenSSL, curl, apt package metadata, dpkg-deb and Chromium's NSS dependencies. Install locked project dependencies, finish the production build, then install Playwright Chromium if absent. Run:

```sh
npm ci
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:private-beta-tls
```

The script downloads Caddy 2.10.2 for the host architecture and verifies its official SHA-512 checksum. It downloads/extracts `libnss3-tools` without installing it. Caddy, CA, private leaf key, administrator hashes, proxy marker, sessions and state stay in owner-private temporary directories. Only sanitized receipts, screenshots and test Sidecars are written to `artifacts/private-beta-staging`. The CA is trusted in an ephemeral browser HOME/NSS database and explicitly by Node HTTPS clients, never by disabling certificate verification. The script supports x86_64 and ARM64. It does not call GitHub repository APIs: its GitHub provider is a fixed transport fixture.

Dependencies need normal outbound download access. If download/checksum/trust setup fails, stop and diagnose; never replace trusted HTTPS with an insecure client. Do not execute a build concurrently with browser acceptance.

The script checks two identities, provider 429, quotas, cancellation/timeout, duplicate-instance refusal, real child SIGKILL, manual confirmed-exit stale-lock recovery and graceful restart. It also runs four browser widths. Its temporary process recovery removes only its own known test lock after awaiting child exit. Do not copy that deletion into an unconditional service startup script.

## Prepare a future private service

1. Record the approved commit, previous executable build/dependency lock, service UID, independent upstream port and fixed HTTPS origin. Keep the existing public service unchanged.
2. Provision dedicated owner-only configuration and data directories outside the checkout. Beta state is 0700, files 0600, owned by the service UID; caches/jobs are independent of production. Validate actual paths and symlink resolution before starting.
3. Provision administrator salts/scrypt hashes and a random 64-hex-character proxy marker offline. Use protected configuration injection for both processes, never command-line arguments or checked-in files. Do not log environment/configuration, passwords, Cookie/Set-Cookie or adapted Caddy output.
4. Issue a trusted certificate for the fixed origin using an approved certificate lifecycle. The test's one-day ephemeral CA is not an OCI/public certificate deployment plan. Certificate private keys remain outside source control and public directories.
5. Adapt the dedicated Caddy template: exact authority appears in both site address and matcher; upstream stays 127.0.0.1. Explicit Beta origin and upstream port differ. Validate syntax without printing secrets.
6. Start the Beta process using only the explicit private entry, then its dedicated proxy. Ensure listener addresses are loopback for local staging. A remote listener/firewall plan needs separate review.
7. Verify trusted TLS, `/healthz`, `/api/contract`, public Graph access, anonymous task rejection, login/secure cookie, Origin/CSRF/Host/forwarding refusal, task ownership, a bounded comparison/download and logout. Confirm public production startup still has Deep Search disabled.

## Stop and monitor

Use the service's known PID/unit only. Graceful SIGTERM lets Gate close tasks/save state and release its instance lock. Confirm the process has exited and listener is closed. Do not kill broad Node/Caddy process groups.

Monitor health, response status/latency, reserved/active counts and sanitized error reasons. Watch persistence failure, provider rate exhaustion, auth failure spikes, stale lock and partial tasks. State usage is shown only to authorized users; do not publish it as a public metrics endpoint. Avoid request/response body logging and header logging. The staging receipt records paths/status/latency only; no access log containing cookies was enabled.

Budget is nonrefundable: new search reserves 24 attempts; cancellation/timeout/failed requests still consume reservation. Do not relogin, swap identity, restart or delete state to evade it. Wait for the normal hourly window/provider recovery. Quota cannot be recovered by restoring an older backup.

CPU and memory readings are observations, not CPU enforcement. There is no hard CPU budget or absolute wire-byte guarantee. OS-level resource containment and alarms remain a future separately reviewed step.

## Credentials and sessions

Rotate one administrator hash using protected provisioning, then gracefully restart the dedicated Beta service; sessions are memory-only and all prior sessions expire on restart. Preserve state/quota. Rotate the proxy marker in both protected configurations in a coordinated stopped-service window. Never temporarily disable marker enforcement to avoid mismatches. For certificate rotation use the established dedicated process procedure, retaining trusted chain validation. No production certificate/TLS configuration is touched by these instructions.

## Abnormal exit and instance lock recovery

A stale `instance.lock` is intentional fail-closed behavior. A second instance must not run on the same store.

1. Stop automatic restart attempts for the dedicated private instance. Identify the original PID from service management and lock, and check its executable/service identity. PID reuse is possible; a lock PID alone is not proof of ownership.
2. Confirm the original process is dead and no replacement/second instance or upstream listener uses the store. If uncertain, do not remove the lock.
3. Make an owner-private, stopped-state backup; preserve `state.json` and reserved quotas. Remove only that verified store's stale `instance.lock`. Do not remove the store/state or unrelated temporary files.
4. Restart the same approved service once. Running records become partial with a restart reason; saved reservation remains. Old sessions are invalid. A new bounded task needs normal admission.
5. Check store/file owner and permissions, healthy public Graph, authorization, retained quota and recovered partial state. If persistence failed, stop and repair storage before admitting new tasks. Do not bypass the failure latch by clearing state.

The test demonstrates process interruption and recovery only. It does not prove behavior under a power cut, storage-controller failure or a filesystem that does not honor fsync/atomic rename.

## Backup and rollback

Gracefully stop the dedicated instance, confirm no writer remains, then make a protected backup of state and configuration using the approved secret-storage system. Keep data owner/permissions and physical separation when restoring. Treat backups as private because they contain task ownership and result data. Never copy a state backup into Canonical cache/jobs.

Prefer rollback to the recorded approved code/build while keeping the latest compatible state and reservation. Compare state schema compatibility before starting. If older code cannot read current state, remain stopped; do not reset budget or silently restore stale quota. An operator-approved reconciliation must conservatively retain current reservations/provider blocking. Recheck locks, permissions, TLS, auth and health before admitting requests. This task did not install a private production service or exercise OCI rollback.
