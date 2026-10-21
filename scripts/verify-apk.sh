#!/usr/bin/env bash
# Verify installability metadata and signing identity for every APK.
set -euo pipefail
if [[ $# -lt 3 ]]; then
  echo "Usage: bash scripts/verify-apk.sh <apk> <expected-package> <version-code> [cert-sha256]" >&2
  exit 2
fi
APK="$1"; EXPECTED_ID="$2"; EXPECTED_CODE="$3"; EXPECTED_CERT=""
if [[ $# -ge 4 ]]; then EXPECTED_CERT="$4"; fi
test -s "$APK"
SDK="$(printenv ANDROID_HOME || printenv ANDROID_SDK_ROOT || :)"
if [[ -z "$SDK" || ! -d "$SDK/build-tools" ]]; then
  echo "::error::Android SDK build-tools missing" >&2; exit 1
fi
TOOLS="$(find "$SDK/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)"
test -x "$TOOLS/aapt"
test -x "$TOOLS/apksigner"
BADGING="$("$TOOLS/aapt" dump badging "$APK")"
echo "$BADGING" | grep -F "package: name='$EXPECTED_ID'" >/dev/null || {
  echo "::error::Package ID mismatch, expected $EXPECTED_ID" >&2; exit 1;
}
echo "$BADGING" | grep -F "versionCode='$EXPECTED_CODE'" >/dev/null || {
  echo "::error::versionCode mismatch, expected $EXPECTED_CODE" >&2; exit 1;
}
"$TOOLS/apksigner" verify --verbose "$APK"
CERT_INFO="$("$TOOLS/apksigner" verify --print-certs "$APK")"
# apksigner output wording varies by Android build-tools version.
# The JAR X.509 certificate can also be read independently by keytool.
CERT="$(keytool -printcert -jarfile "$APK" | sed -n 's/.*SHA256:[[:space:]]*//p' | head -1 | tr -d ':' | tr '[:lower:]' '[:upper:]')"
if [[ ! "$CERT" =~ ^[A-F0-9]{64}$ ]]; then
  CERT="$(printf '%s\n' "$CERT_INFO" | sed -n -E 's/.*(SHA-256|SHA256) digest:[[:space:]]*([0-9a-fA-F:]{64,95}).*/\2/Ip' | head -1 | tr -d ':' | tr '[:lower:]' '[:upper:]')"
fi
if [[ ! "$CERT" =~ ^[A-F0-9]{64}$ ]]; then
  echo "::error::APK certificate SHA-256 not detected" >&2; exit 1
fi
if [[ -n "$EXPECTED_CERT" && "$CERT" != "$EXPECTED_CERT" ]]; then
  echo "::error::Signing certificate mismatch. Build cannot update the designated package." >&2
  exit 1
fi
echo "Verified package $EXPECTED_ID; versionCode $EXPECTED_CODE; cert SHA256 $CERT"
