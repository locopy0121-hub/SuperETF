#!/usr/bin/env bash
# Optional computer-assisted Android Debug -> newly signed app data migration.
# Requires Android Platform Tools (adb), USB debugging, and an installed debuggable legacy app.
# Deliberately never uninstalls the app. Preserve the archive privately (contains API keys).
set -euo pipefail
PACKAGE="com.locopy.superetf"
ACTION="$(printf '%s' "$1")"
FILE="$(printf '%s' "$2")"
if [[ "$ACTION" != "backup" && "$ACTION" != "restore" ]] || [[ -z "$FILE" ]]; then
  echo "Usage: bash scripts/migrate-debug-data.sh backup|restore <private-archive.tar>" >&2
  exit 2
fi
command -v adb >/dev/null || { echo "adb is required" >&2; exit 2; }
adb get-state | grep -qx device || { echo "Connect one unlocked USB-debuggable Android device first" >&2; exit 2; }
adb shell pm path "$PACKAGE" | grep -q package: || {
  echo "$PACKAGE not installed on device" >&2; exit 2;
}
adb shell am force-stop "$PACKAGE" >/dev/null
if [[ "$ACTION" == "backup" ]]; then
  [[ ! -e "$FILE" ]] || { echo "Refusing to overwrite existing backup" >&2; exit 3; }
  TEMP="$FILE.partial"
  trap 'rm -f "$TEMP"' EXIT
  adb exec-out run-as "$PACKAGE" tar -cf - app_webview shared_prefs > "$TEMP"
  [[ -s "$TEMP" ]] || { echo "Backup is empty; DO NOT uninstall the old app" >&2; exit 1; }
  tar -tf "$TEMP" >/dev/null
  mv "$TEMP" "$FILE"
  trap - EXIT
  chmod 600 "$FILE"
  echo "Backup verified: $FILE. Keep it private and do NOT uninstall until this succeeds."
else
  [[ -f "$FILE" ]] || { echo "Backup missing" >&2; exit 2; }
  tar -tf "$FILE" >/dev/null
  echo "Restoring data to $PACKAGE (must be your NEW release install)."
  echo "This does not change the Android app signature and must run AFTER old app removal/new installation."
  adb shell -T run-as "$PACKAGE" tar -xf - < "$FILE"
  adb shell am force-stop "$PACKAGE" >/dev/null
  echo "Restore complete. Launch SuperETF and verify holdings/API settings."
fi
