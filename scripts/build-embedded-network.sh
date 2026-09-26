#!/usr/bin/env bash
# Reproduce native libraries from the adjacent Pond repository's pinned Go module.
set -euo pipefail
mobile_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pond_root="${POND_SOURCE_ROOT:-$(dirname "$mobile_root")/goose-in-a-pond}"
platform="${1:-all}"
case "$platform" in android|ios|all) ;; *) printf 'Expected android, ios, or all\n' >&2; exit 2;; esac
output="$mobile_root/native/pondnet"
mkdir -p "$output"
cp "$pond_root/native/pondnet/THIRD_PARTY_NOTICES.txt" "$output/THIRD_PARTY_NOTICES.txt"
cd "$pond_root/native/pondnet"
# gomobile invokes gobind from PATH. Build that exact pinned tool into a temporary
# directory instead of silently using whichever global installation happens to exist.
tool_dir="$(mktemp -d "${TMPDIR:-/tmp}/pond-bind.XXXXXX")"
trap 'rm -rf "$tool_dir"' EXIT
go build -mod=readonly -o "$tool_dir/gobind" golang.org/x/mobile/cmd/gobind
export PATH="$tool_dir:$PATH"
# go.mod pins Go, gomobile and module versions; go.sum verifies downloaded sources.
if [[ "$platform" == android || "$platform" == all ]]; then
  : "${ANDROID_HOME:?Set ANDROID_HOME to the Android SDK}"
  go tool gomobile bind -target=android/arm,android/arm64,android/386,android/amd64 -androidapi=24 -ldflags="-extldflags=-Wl,-z,max-page-size=16384" -javapkg=io.jarida -o "$output/pondnet.aar" ./mobile
  python3 "$mobile_root/scripts/check-android-page-alignment.py" "$output/pondnet.aar"
fi
if [[ "$platform" == ios || "$platform" == all ]]; then
  go tool gomobile bind -target=ios,iossimulator -iosversion=16.4 -o "$output/Pondnet.xcframework" ./mobile
fi
printf 'Embedded network libraries built for %s\n' "$platform"
