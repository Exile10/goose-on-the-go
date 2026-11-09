#!/usr/bin/env bash
# Build the "Hey Goose" detector this app embeds on Android, from the pond-ear crate in the
# adjacent Pond checkout, into native/pondear/jniLibs/. The with-pond-wake config plugin copies
# it in at prebuild. Written for bash 3.2, which is what /usr/bin/env bash finds on a stock Mac.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/build-embedded-ear.sh [--emulator] [-h]

Builds native/pondear/jniLibs/<abi>/libpondear.so for arm64-v8a and armeabi-v7a (the ABIs the
app packages) from native/pondear, a JNI shim over the Pond checkout's crates/pond-ear. Cargo
rebuilds only what changed, so running it again is cheap.

Options:
  --emulator      also build x86_64, for the Android emulator
  -h, --help      show this help

Environment:
  POND_SOURCE_ROOT  the Pond checkout (default: goose-in-a-pond beside this repository)
  ANDROID_HOME      the Android SDK (default: ~/Library/Android/sdk, then ~/Android/Sdk)
  ANDROID_NDK_HOME  the NDK (default: the newest complete NDK in the SDK)
EOF
}

emulator=0
for arg in "$@"; do
  case "$arg" in
    --emulator) emulator=1 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown argument: %s\n\n' "$arg" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  bold=$'\033[1m' red=$'\033[31m' green=$'\033[32m' reset=$'\033[0m'
else
  bold='' red='' green='' reset=''
fi
step() { printf '%s==>%s %s%s%s\n' "$green" "$reset" "$bold" "$*" "$reset"; }
note() { printf '    %s\n' "$*"; }
die() {  # die <problem> [<what to do about it>...]
  printf '%serror:%s %s\n' "$red" "$reset" "$1" >&2
  shift
  for line in "$@"; do printf '       %s\n' "$line" >&2; done
  exit 1
}

mobile_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
shim="$mobile_root/native/pondear"
output="$shim/jniLibs"
default_pond="$(dirname "$mobile_root")/goose-in-a-pond"
pond_root="${POND_SOURCE_ROOT:-$default_pond}"
crate="$pond_root/crates/pond-ear"

# Everything a build needs is checked before anything slow starts.
[[ -f "$crate/Cargo.toml" ]] || die "No pond-ear crate at $crate" \
  "Clone jarida-io/goose-in-a-pond beside this repository, or set POND_SOURCE_ROOT to one."
command -v cargo >/dev/null || die "Rust is not installed" "Install it from https://rustup.rs"
command -v rustup >/dev/null || die "rustup is needed to add the Android targets" "Install Rust with https://rustup.rs"
command -v python3 >/dev/null || die "python3 is needed to check the 16 KB page alignment"

if [[ -z "${ANDROID_HOME:-}" ]]; then
  for sdk in "${ANDROID_SDK_ROOT:-}" "$HOME/Library/Android/sdk" "$HOME/Android/Sdk"; do
    if [[ -n "$sdk" && -d "$sdk" ]]; then export ANDROID_HOME="$sdk"; break; fi
  done
fi
[[ -d "${ANDROID_HOME:-}" ]] || die "No Android SDK found" "Install one with Android Studio, or set ANDROID_HOME to it."
if [[ -z "${ANDROID_NDK_HOME:-}" ]]; then
  for version in $(ls -1 "$ANDROID_HOME/ndk" 2>/dev/null | sort -rV || true); do
    if [[ -f "$ANDROID_HOME/ndk/$version/source.properties" ]]; then
      export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/$version"
      break
    fi
    note "Ignoring incomplete NDK $version; delete $ANDROID_HOME/ndk/$version to let Gradle fetch it again."
  done
fi
[[ -f "${ANDROID_NDK_HOME:-}/source.properties" ]] || die "No complete Android NDK found" \
  "npm run android downloads the one the app builds with, or install it from Android Studio's SDK Manager."
host_tag="$(uname -s | tr '[:upper:]' '[:lower:]')-x86_64"  # the NDK ships x86_64 host tools on Apple silicon too
clang_dir="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/$host_tag/bin"
[[ -d "$clang_dir" ]] || die "The NDK has no LLVM toolchain for this host at $clang_dir"

# abi rust-target clang-prefix: the app's minSdk is 24, so link against API 24.
targets="arm64-v8a:aarch64-linux-android:aarch64-linux-android24
armeabi-v7a:armv7-linux-androideabi:armv7a-linux-androideabi24"
[[ $emulator == 0 ]] || targets="$targets
x86_64:x86_64-linux-android:x86_64-linux-android24"

installed="$(rustup target list --installed)"
missing=''
while IFS=: read -r _ triple _; do
  grep -qx "$triple" <<<"$installed" || missing="$missing $triple"
done <<<"$targets"
if [[ -n "$missing" ]]; then
  step "Adding Rust targets:$missing"
  # shellcheck disable=SC2086  # one word per target
  rustup target add $missing
fi

# The shim's Cargo.toml names the sibling checkout; another one gets a copy of the manifest that
# points at it, so the tracked file never changes.
manifest="$shim/Cargo.toml"
staging=''
trap '[[ -z "$staging" ]] || rm -rf "$staging"' EXIT
if [[ "$(cd "$pond_root" && pwd)" != "$(cd "$default_pond" 2>/dev/null && pwd || true)" ]]; then
  staging="$(mktemp -d "${TMPDIR:-/tmp}/pondear.XXXXXX")"
  sed -e "s|^pond-ear = { path = \"[^\"]*\" }|pond-ear = { path = \"$crate\" }|" \
      -e "s|^path = \"src/lib.rs\"|path = \"$shim/src/lib.rs\"|" "$shim/Cargo.toml" >"$staging/Cargo.toml"
  cp "$shim/Cargo.lock" "$staging/Cargo.lock"
  manifest="$staging/Cargo.toml"
  note "Using pond-ear from $crate"
fi

model_sum="$(awk -F'"' '/HEY_GOOSE_SHA256: &str =/{getline; print $2; exit}' "$crate/src/wake/mod.rs")"
step "Building the detector (pond-ear at $(git -C "$pond_root" rev-parse --short HEAD 2>/dev/null || echo 'an untracked tree'), model sha256 ${model_sum:0:12})"

check_zip="$(mktemp -d "${TMPDIR:-/tmp}/pondear-check.XXXXXX")"
trap '[[ -z "$staging" ]] || rm -rf "$staging"; rm -rf "$check_zip"' EXIT
while IFS=: read -r abi triple clang; do
  linker_var="CARGO_TARGET_$(tr '[:lower:]-' '[:upper:]_' <<<"$triple")_LINKER"
  # 16 KB pages: Android 15 devices may use them, and Play requires 64-bit libraries to load there.
  # RUSTFLAGS is set whole, so the Mac's own target-cpu settings never reach an Android build.
  env "$linker_var=$clang_dir/$clang-clang" RUSTFLAGS="-C link-arg=-Wl,-z,max-page-size=16384" \
    cargo build --release --locked --manifest-path "$manifest" --target "$triple" \
    --target-dir "$shim/target" --quiet
  mkdir -p "$output/$abi" "$check_zip/jni/$abi"
  cp "$shim/target/$triple/release/libpondear.so" "$output/$abi/libpondear.so"
  cp "$output/$abi/libpondear.so" "$check_zip/jni/$abi/libpondear.so"
  note "$abi: $(wc -c <"$output/$abi/libpondear.so" | tr -d ' ') bytes"
done <<<"$targets"

(cd "$check_zip" && python3 -c 'import sys, zipfile, os
with zipfile.ZipFile("libs.zip", "w") as z:
    for root, _, files in os.walk("jni"):
        for f in files: z.write(os.path.join(root, f))')
alignment="$(python3 "$mobile_root/scripts/check-android-page-alignment.py" "$check_zip/libs.zip" 2>&1)" ||
  die "The detector failed its 16 KB page-alignment check" "$alignment"
note "$alignment"
step "Done: native/pondear/jniLibs is ready for the next prebuild"
