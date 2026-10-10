#!/usr/bin/env bash
set -euo pipefail
# No system installation or trust changes. Dependencies and CA stay in temporary directories.
staging_dependencies=$(mktemp -d /tmp/gitlineage-tls-deps-XXXXXX)
trap 'rm -rf "$staging_dependencies"' EXIT
staging_arch=$(uname -m)
case "$staging_arch" in x86_64) staging_arch=amd64;; aarch64) staging_arch=arm64;; *) exit 1;; esac
curl -fsSL --max-time 90 "https://github.com/caddyserver/caddy/releases/download/v2.10.2/caddy_2.10.2_linux_${staging_arch}.tar.gz" -o "$staging_dependencies/caddy.tar.gz"
curl -fsSL --max-time 30 https://github.com/caddyserver/caddy/releases/download/v2.10.2/caddy_2.10.2_checksums.txt -o "$staging_dependencies/checksums.txt"
(cd "$staging_dependencies"; awk -v name="caddy_2.10.2_linux_${staging_arch}.tar.gz" '$2==name {print $1 "  caddy.tar.gz"}' checksums.txt | sha512sum --check; tar -xzf caddy.tar.gz caddy; apt-get download libnss3-tools; for package in libnss3-tools*.deb; do dpkg-deb -x "$package" nss; done)
export GITLINEAGE_STAGING_CADDY="$staging_dependencies/caddy"
export GITLINEAGE_STAGING_CERTUTIL="$staging_dependencies/nss/usr/bin/certutil"
export GITLINEAGE_STAGING_TLS=1
node test/staging/security.ts
node test/web/private-beta-acceptance.ts
