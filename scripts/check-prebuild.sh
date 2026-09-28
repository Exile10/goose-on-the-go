#!/usr/bin/env bash
# Run expo prebuild in a scratch copy, so a config plugin that no longer applies is caught
# without clearing this checkout's own ios/ and android/. Nothing in CI runs prebuild.
#
#   scripts/check-prebuild.sh [android|ios|all]    the working tree as it stands
#   PREBUILD_REF=<commit> scripts/check-prebuild.sh  a commit, as pre-push sends it
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
platform="${1:-all}"
case "$platform" in android|ios|all) ;; *) printf 'Expected android, ios, or all\n' >&2; exit 2;; esac
scratch="$(mktemp -d "${TMPDIR:-/tmp}/gotg-prebuild.XXXXXX")"
trap 'rm -rf "$scratch"' EXIT

# The plugins read these, and none of them is tracked: Firebase config is per-developer and
# the Pond network libraries are build outputs of scripts/build-embedded-network.sh.
untracked=(google-services.json GoogleService-Info.plist native/pondnet/pondnet.aar native/pondnet/Pondnet.xcframework)
if [[ -n "${PREBUILD_REF:-}" ]]; then
  git -C "$root" archive "$PREBUILD_REF" | tar -x -C "$scratch"
else
  rsync -a --exclude /node_modules --exclude /ios --exclude /android --exclude /.expo --exclude /.git \
    --exclude /native/pondnet/.build --exclude /native/pondnet/pondnet.aar --exclude /native/pondnet/Pondnet.xcframework \
    "$root/" "$scratch/"
fi
for input in "${untracked[@]}"; do
  if [[ -e "$root/$input" && ! -e "$scratch/$input" ]]; then ln -s "$root/$input" "$scratch/$input"; fi
done
ln -s "$root/node_modules" "$scratch/node_modules"

cd "$scratch"
if ! log="$(CI=1 npx expo prebuild --no-install --platform "$platform" 2>&1)"; then
  # Keep the message, drop the stack: every frame is inside @expo/config-plugins.
  printf '%s\n' "$log" | grep -Ev '^[[:space:]]+at ' | awk '!seen[$0]++' >&2
  printf 'Prebuild failed for %s.\n' "$platform" >&2
  exit 1
fi
printf 'Prebuild passed for %s.\n' "$platform"
