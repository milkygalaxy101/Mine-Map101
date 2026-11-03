#!/usr/bin/env bash
# Creates the URCI Field release signing key ONCE and stores it as GitHub repository secrets for
# .github/workflows/urci-release.yml. Needs: keytool (any JDK 11+), gh (logged in, admin on the repo), openssl.
#
# KEEP THE .jks FILE AND THE PASSWORD SAFE (two places, e.g. a password manager + an offline USB drive).
# If the key is lost, phones cannot install updates any more: every crew member would have to uninstall the app
# and choose the data folder again (inspections in the folder survive, app settings do not).
#
# Usage: scripts/make-keystore.sh [output.jks]
set -euo pipefail
OUT="${1:-urci-release.jks}"
ALIAS="urci-field"
REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
if [ -e "$OUT" ]; then echo "$OUT already exists; not overwriting." >&2; exit 1; fi
PASS="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)"

keytool -genkeypair -v -keystore "$OUT" -storetype PKCS12 -alias "$ALIAS" -keyalg RSA -keysize 4096 -validity 10000 \
  -storepass "$PASS" -keypass "$PASS" -dname "CN=URCI Field, O=URCI Field, C=ID"

base64 -w0 "$OUT" | gh secret set URCI_KEYSTORE_BASE64 -R "$REPO"
printf '%s' "$PASS" | gh secret set URCI_KEYSTORE_PASSWORD -R "$REPO"
printf '%s' "$PASS" | gh secret set URCI_KEY_PASSWORD -R "$REPO"
printf '%s' "$ALIAS" | gh secret set URCI_KEY_ALIAS -R "$REPO"

echo
echo "Secrets set on $REPO. Signing certificate SHA-256 (goes into release.json after the first release):"
keytool -list -v -keystore "$OUT" -storepass "$PASS" -alias "$ALIAS" | grep -m1 'SHA256:' | sed 's/.*SHA256: //'
echo
echo "Keystore: $OUT"
echo "Password: $PASS"
echo "Store both safely now. Do not commit the .jks file."
