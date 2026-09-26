#!/usr/bin/env bash
# JVM native-client checks through the production CONNECT proxy, with no device mutation.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
pond="${POND_SOURCE_ROOT:-$(dirname "$root")/goose-in-a-pond}"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/pond-android-proxy.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT
(cd "$pond/native/pondnet" && go build -mod=readonly -o "$fixture/proxyfixture" ./internal/proxyfixture)
export POND_PROXY_FIXTURE_BIN="$fixture/proxyfixture"
cd "$root/android"
./gradlew :app:testDebugUnitTest --tests io.jarida.pondtls.PondProxyTest --rerun --console=plain
