// Learn more: https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

/**
 * AppleDouble sidecars are not modules.
 *
 * macOS keeps extended attributes -- `com.apple.provenance` on anything an editor has
 * saved, `com.apple.quarantine` on anything downloaded -- inside the file on APFS and
 * HFS+. On a filesystem with nowhere to put them it writes them beside the file instead,
 * as `._<original>`. A checkout on an exFAT or FAT32 volume therefore grows a `._foo.tsx`
 * next to every `foo.tsx`, and Metro resolves it as a route: the Babel parser reads the
 * sidecar's binary header and fails with `Unexpected character` at 1:0, naming a file
 * nobody wrote. They reappear on save, so deleting them is not a fix.
 *
 * Nothing reads these but Finder, and only to restore attributes a copy would lose.
 */
const APPLE_DOUBLE = /(^|[\\/])\._[^\\/]*$/;

const existing = config.resolver.blockList;
config.resolver.blockList = Array.isArray(existing)
  ? [...existing, APPLE_DOUBLE]
  : existing
    ? [existing, APPLE_DOUBLE]
    : [APPLE_DOUBLE];

module.exports = config;
