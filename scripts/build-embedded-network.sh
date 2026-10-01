#!/usr/bin/env bash
# Build the Pond network libraries this app embeds, from the pinned Go module in the adjacent
# Pond checkout, into native/pondnet/. The config plugins copy them in at prebuild.
# Written for bash 3.2, which is what /usr/bin/env bash finds on a stock Mac.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/build-embedded-network.sh [android|ios|all] [options]

Builds native/pondnet/pondnet.aar (android) and native/pondnet/Pondnet.xcframework (ios)
from the Pond checkout's native/pondnet Go module. With no platform, builds both. A
platform whose inputs have not changed since its last build here is skipped.

Options:
  -f, --force     rebuild even when nothing has changed
  -v, --verbose   list each package as gomobile compiles it
  -h, --help      show this help

Environment:
  POND_SOURCE_ROOT  the Pond checkout (default: goose-in-a-pond beside this repository)
  ANDROID_HOME      the Android SDK (default: ~/Library/Android/sdk, then ~/Android/Sdk)
  ANDROID_NDK_HOME  the NDK (default: the newest complete NDK in the SDK)
EOF
}

platform=all force=0 verbose=0
for arg in "$@"; do
  case "$arg" in
    android|ios|all) platform=$arg ;;
    -f|--force) force=1 ;;
    -v|--verbose) verbose=1 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown argument: %s\n\n' "$arg" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  bold=$'\033[1m' dim=$'\033[2m' red=$'\033[31m' green=$'\033[32m' reset=$'\033[0m'
else
  bold='' dim='' red='' green='' reset=''
fi
step() { printf '%s==>%s %s%s%s\n' "$green" "$reset" "$bold" "$*" "$reset"; }
note() { printf '    %s\n' "$*"; }
die() {  # die <problem> [<what to do about it>...]
  printf '%serror:%s %s\n' "$red" "$reset" "$1" >&2
  shift
  for line in "$@"; do printf '       %s\n' "$line" >&2; done
  exit 1
}
duration() { printf '%dm%02ds' $(($1 / 60)) $(($1 % 60)); }

script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
mobile_root="$(dirname "$(dirname "$script")")"
pond_root="${POND_SOURCE_ROOT:-$(dirname "$mobile_root")/goose-in-a-pond}"
module="$pond_root/native/pondnet"
output="$mobile_root/native/pondnet"
state="$output/.build"

# Everything a build needs is checked before anything slow starts.
[[ -f "$module/go.mod" ]] || die "No Pond checkout at $pond_root" \
  "Clone jarida-io/goose-in-a-pond beside this repository, or set POND_SOURCE_ROOT to one."
command -v go >/dev/null || die "Go is not installed" \
  "Install Go 1.21 or newer (brew install go); it fetches the toolchain go.mod pins by itself."

android=0 ios=0
case "$platform" in
  android) android=1 ;;
  ios) ios=1 ;;
  all) android=1 ios=1 ;;
esac
if [[ $ios == 1 && "$(uname -s)" != Darwin ]]; then
  [[ $platform == all ]] || die "The iOS library can only be built on macOS"
  note "Skipping iOS: it can only be built on macOS."
  ios=0
fi

if [[ $android == 1 ]]; then
  if [[ -z "${ANDROID_HOME:-}" ]]; then
    for sdk in "${ANDROID_SDK_ROOT:-}" "$HOME/Library/Android/sdk" "$HOME/Android/Sdk"; do
      if [[ -n "$sdk" && -d "$sdk" ]]; then export ANDROID_HOME="$sdk"; break; fi
    done
  fi
  [[ -d "${ANDROID_HOME:-}" ]] || die "No Android SDK found" \
    "Install one with Android Studio, or set ANDROID_HOME to it."
  if [[ -z "${ANDROID_NDK_HOME:-}" ]]; then
    for version in $(ls -1 "$ANDROID_HOME/ndk" 2>/dev/null | sort -rV || true); do
      if [[ -f "$ANDROID_HOME/ndk/$version/source.properties" ]]; then
        export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/$version"
        break
      fi
      # An interrupted SDK download leaves a directory holding only .installer.
      note "Ignoring incomplete NDK $version; delete $ANDROID_HOME/ndk/$version to let Gradle fetch it again."
    done
  fi
  [[ -f "${ANDROID_NDK_HOME:-}/source.properties" ]] || die "No complete Android NDK found" \
    "npm run android downloads the one the app builds with, or install it from Android Studio's SDK Manager."
  command -v python3 >/dev/null || die "python3 is needed to check the Android library's 16 KB page alignment"
fi

if [[ $ios == 1 ]]; then
  xcrun --sdk iphoneos --show-sdk-path >/dev/null 2>&1 || die "Xcode's iOS SDK is not available" \
    "Install Xcode, then select it: sudo xcode-select -s /Applications/Xcode.app"
fi

# One build at a time: two gomobile runs writing the same files corrupt each other.
mkdir -p "$state"
lock="$state/lock"
if ! mkdir "$lock" 2>/dev/null; then
  holder="$(cat "$lock/pid" 2>/dev/null || true)"
  if [[ -n "$holder" ]] && kill -0 "$holder" 2>/dev/null; then
    die "Another build (pid $holder) is already writing native/pondnet" "Let it finish, or stop it: kill $holder"
  fi
  rm -rf "$lock"
  mkdir "$lock" 2>/dev/null || die "Another build started at the same moment"
fi
echo $$ >"$lock/pid"

child='' ticker='' tool_dir='' staging=''
# kill_tree <pid>: stop it first, so it cannot start another child while its children are
# listed and killed; the TERM it is sent takes effect when it continues.
kill_tree() {
  local pid
  kill -STOP "$1" 2>/dev/null || return 0
  for pid in $(pgrep -P "$1" 2>/dev/null || true); do kill_tree "$pid"; done
  kill -TERM "$1" 2>/dev/null || true
  kill -CONT "$1" 2>/dev/null || true
}
cleanup() {
  [[ -z "$ticker" ]] || kill_tree "$ticker"
  [[ -z "$child" ]] || kill_tree "$child"
  for path in "$tool_dir" "$staging" "$lock"; do [[ -z "$path" ]] || rm -rf "$path"; done
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# A build from an older copy of this script, or a gomobile run by hand, takes no lock.
if other="$(pgrep -f "gomobile bind .*-o $output/" | head -1)" && [[ -n "$other" ]]; then
  die "A gomobile build (pid $other) is already writing native/pondnet" \
    "Let it finish, or stop it: pkill -f 'gomobile bind .*native/pondnet'"
fi

# run <label> <command...>: run a long step in the background, so a signal can stop it, and
# report every 30 seconds, so a compile that prints nothing does not look hung.
run() {
  local label=$1 started=$SECONDS status=0
  shift
  "$@" &
  child=$!
  (
    waited=0
    while sleep 30; do
      waited=$((waited + 30))
      printf '    %s%s: still working, %s%s\n' "$dim" "$label" "$(duration $waited)" "$reset"
    done
  ) &
  ticker=$!
  wait "$child" || status=$?
  kill_tree "$ticker"
  child='' ticker=''
  if [[ $status != 0 ]]; then
    die "$label failed after $(duration $((SECONDS - started)))" \
      "The libraries already in native/pondnet are untouched."
  fi
  note "$label: done in $(duration $((SECONDS - started)))"
}

cd "$module"
step "Resolving Go $(awk '/^go /{print $2; exit}' go.mod), which the Pond's go.mod pins"
go_version="$(go env GOVERSION)"  # fetches the pinned toolchain on first use
note "Using $go_version"

hash_files=(shasum -a 256)
command -v shasum >/dev/null || hash_files=(sha256sum)
# fingerprint <toolchain...>: a digest of everything one platform's library is built from.
fingerprint() {
  {
    cat "$script"
    printf '%s\n' "$go_version" "$@"
    if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      git ls-files -co --exclude-standard -z | xargs -0 "${hash_files[@]}" 2>/dev/null || true
    else
      find . -type f -print0 | sort -z | xargs -0 "${hash_files[@]}"
    fi
  } | "${hash_files[@]}" | cut -d' ' -f1
}
# current <output> <fingerprint>: whether that output was built from exactly these inputs.
current() {
  [[ $force == 0 && -e "$output/$1" && "$(cat "$state/$1.stamp" 2>/dev/null || true)" == "$2" ]]
}

aar_status='not requested' xcframework_status='not requested'
if [[ $android == 1 ]]; then
  android_fingerprint="$(fingerprint android "$(basename "$ANDROID_NDK_HOME")")"
  if current pondnet.aar "$android_fingerprint"; then
    note "pondnet.aar is up to date with the Pond sources (--force rebuilds it)."
    android=0 aar_status='up to date'
  fi
fi
if [[ $ios == 1 ]]; then
  ios_fingerprint="$(fingerprint ios "$(xcrun --sdk iphoneos --show-sdk-version)")"
  if current Pondnet.xcframework "$ios_fingerprint"; then
    note "Pondnet.xcframework is up to date with the Pond sources (--force rebuilds it)."
    ios=0 xcframework_status='up to date'
  fi
fi
if [[ $android == 0 && $ios == 0 ]]; then
  step "Nothing to build"
  exit 0
fi

# gomobile invokes gobind from PATH. Build that exact pinned tool into a temporary
# directory instead of silently using whichever global installation happens to exist.
step "Preparing the pinned gomobile toolchain"
tool_dir="$(mktemp -d "${TMPDIR:-/tmp}/pond-bind.XXXXXX")"
run "gobind" go build -mod=readonly -o "$tool_dir/gobind" golang.org/x/mobile/cmd/gobind
export PATH="$tool_dir:$PATH"

# Each library is built beside its destination and moved into place only once it is
# complete, so a failed or interrupted build leaves the previous one intact.
staging="$(mktemp -d "$state/staging.XXXXXX")"
gomobile_verbose=''
[[ $verbose == 0 ]] || gomobile_verbose='-v'

if [[ $android == 1 ]]; then
  step "Building pondnet.aar for Android: arm, arm64, 386 and amd64"
  note "NDK $(basename "$ANDROID_NDK_HOME"), API 24. Four ABIs of Tailscale is the slow part; Go caches it for next time."
  run "Android" go tool gomobile bind ${gomobile_verbose:+"$gomobile_verbose"} \
    -target=android/arm,android/arm64,android/386,android/amd64 -androidapi=24 \
    -ldflags="-extldflags=-Wl,-z,max-page-size=16384" -javapkg=io.jarida \
    -o "$staging/pondnet.aar" ./mobile
  alignment="$(python3 "$mobile_root/scripts/check-android-page-alignment.py" "$staging/pondnet.aar" 2>&1)" ||
    die "The Android library failed its 16 KB page-alignment check" "$alignment"
  note "$alignment"
  mv -f "$staging/pondnet.aar" "$output/pondnet.aar"
  [[ ! -f "$staging/pondnet-sources.jar" ]] || mv -f "$staging/pondnet-sources.jar" "$output/pondnet-sources.jar"
  printf '%s\n' "$android_fingerprint" >"$state/pondnet.aar.stamp"
  aar_status='built'
fi

if [[ $ios == 1 ]]; then
  step "Building Pondnet.xcframework for iOS: device and simulator"
  run "iOS" go tool gomobile bind ${gomobile_verbose:+"$gomobile_verbose"} \
    -target=ios,iossimulator -iosversion=16.4 -o "$staging/Pondnet.xcframework" ./mobile
  rm -rf "$output/Pondnet.xcframework"
  mv "$staging/Pondnet.xcframework" "$output/Pondnet.xcframework"
  printf '%s\n' "$ios_fingerprint" >"$state/Pondnet.xcframework.stamp"
  xcframework_status='built'
fi

notices_changed=0
if ! cmp -s "$module/THIRD_PARTY_NOTICES.txt" "$output/THIRD_PARTY_NOTICES.txt"; then
  cp "$module/THIRD_PARTY_NOTICES.txt" "$output/THIRD_PARTY_NOTICES.txt"
  notices_changed=1
fi

step "Done in $(duration $SECONDS)"
for entry in "pondnet.aar:$aar_status" "Pondnet.xcframework:$xcframework_status"; do
  name="${entry%%:*}"
  [[ -e "$output/$name" ]] || continue
  printf '    %-21s %6s  %s\n' "$name" "$(du -sh "$output/$name" | cut -f1)" "${entry#*:}"
done
[[ $notices_changed == 0 ]] || note "THIRD_PARTY_NOTICES.txt changed; commit it with this update."
note "Next: npx expo prebuild --clean, so ios/ and android/ pick up the new libraries."
