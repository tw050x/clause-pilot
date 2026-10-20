#!/usr/bin/env bash
#
# Sets the repository secrets the release workflow needs to sign and notarize the macOS app
# (see docs/releasing.md). Asks for each value, checks it before anything is sent to GitHub:
#   - the .p12 opens with the password given, and holds a "Developer ID Application" certificate;
#   - Apple accepts the notarization credentials (xcrun notarytool signs in with them).
# Passwords and keys are read without echoing and go to GitHub on stdin, never as arguments to gh.
#
# Usage: scripts/set-release-secrets.sh [--dry-run] [owner/repo]
#   --dry-run  check everything, set nothing.

set -euo pipefail

DRY=0
REPO=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    -h | --help) sed -n '2,10p' "$0"; exit 0 ;;
    *) REPO="$arg" ;;
  esac
done

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; }
die() { fail "$*"; exit 1; }
ask() { local prompt=$1 default=${2:-} reply; if [ -n "$default" ]; then read -r -p "$prompt [$default]: " reply; echo "${reply:-$default}"; else read -r -p "$prompt: " reply; echo "$reply"; fi; }
ask_secret() { local reply; read -r -s -p "$1: " reply; echo >&2; echo "$reply"; }

# ---- tools and repository -----------------------------------------------------------------
command -v gh >/dev/null || die "The GitHub CLI (gh) is needed: brew install gh"
command -v openssl >/dev/null || die "openssl is needed."
command -v xcrun >/dev/null || die "Xcode's command line tools are needed (for notarytool): xcode-select --install"
gh auth status >/dev/null 2>&1 || die "Sign in to GitHub first: gh auth login"
if [ -z "$REPO" ]; then
  REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)
  REPO=${REPO:-tw050x/clause-pilot}
fi
bold "Release secrets for $REPO$([ $DRY = 1 ] && echo ' (dry run: nothing will be set)')"
echo

# ---- 1. the Developer ID certificate ------------------------------------------------------
bold "1. Developer ID certificate (.p12)"
P12=$(ask "Path to the .p12" "$HOME/Repository/openp41ge/secrets/DeveloperID.p12")
P12=${P12/#\~/$HOME}
[ -f "$P12" ] || die "No file at $P12"

# OpenSSL 3 needs -legacy for the older encryption Keychain Access exports with; LibreSSL (macOS's
# own openssl) has no such flag and doesn't need it.
p12() { openssl pkcs12 -in "$P12" -passin env:P12_PASS "$@" 2>/dev/null || openssl pkcs12 -legacy -in "$P12" -passin env:P12_PASS "$@" 2>/dev/null; }
for attempt in 1 2 3; do
  P12_PASS=$(ask_secret "Its password")
  export P12_PASS
  if p12 -noout; then break; fi
  fail "That password doesn't open it."
  [ $attempt = 3 ] && die "Giving up after three tries."
done
SUBJECT=$(p12 -nokeys -clcerts | openssl x509 -noout -subject 2>/dev/null || true)
case "$SUBJECT" in
  *"Developer ID Application"*) ok "Opens, and holds: ${SUBJECT#subject=}" ;;
  *) die "It opens, but holds no \"Developer ID Application\" certificate (${SUBJECT:-no certificate found})." ;;
esac
TEAM_FROM_CERT=$(printf '%s' "$SUBJECT" | sed -n 's/.*OU *= *\([A-Z0-9]\{10\}\).*/\1/p')
echo

# ---- 2. notarization credentials ----------------------------------------------------------
bold "2. Notarization"
echo "  a) App Store Connect API key (.p8)  — recommended"
echo "  b) Apple ID and an app-specific password"
METHOD=$(ask "Which" "a")
case "$METHOD" in
  a | A)
    P8=$(ask "Path to the .p8 file")
    P8=${P8/#\~/$HOME}
    [ -f "$P8" ] || die "No file at $P8"
    grep -q "BEGIN PRIVATE KEY" "$P8" || die "$P8 doesn't look like an App Store Connect key (no BEGIN PRIVATE KEY)."
    KEY_ID=$(ask "Key ID" "$(basename "$P8" | sed -n 's/^AuthKey_\([A-Z0-9]*\)\.p8$/\1/p')")
    [[ "$KEY_ID" =~ ^[A-Z0-9]{10}$ ]] || die "A Key ID is 10 letters and digits."
    ISSUER=$(ask "Issuer ID (shown above the keys in App Store Connect)")
    [[ "$ISSUER" =~ ^[0-9a-fA-F-]{36}$ ]] || die "An Issuer ID looks like 12345678-abcd-…-1234567890ab."
    echo "  Checking with Apple…"
    xcrun notarytool history --key "$P8" --key-id "$KEY_ID" --issuer "$ISSUER" >/dev/null 2>&1 || die "Apple didn't accept that key, Key ID and Issuer ID."
    ok "Apple accepts the API key."
    ;;
  b | B)
    APPLE_ID=$(ask "Apple ID (email)")
    TEAM_ID=$(ask "Team ID" "$TEAM_FROM_CERT")
    [[ "$TEAM_ID" =~ ^[A-Z0-9]{10}$ ]] || die "A Team ID is 10 letters and digits."
    for attempt in 1 2 3; do
      APP_PASS=$(ask_secret "App-specific password (appleid.apple.com → Sign-In and Security)")
      echo "  Checking with Apple…"
      if xcrun notarytool history --apple-id "$APPLE_ID" --password "$APP_PASS" --team-id "$TEAM_ID" >/dev/null 2>&1; then break; fi
      fail "Apple didn't accept that Apple ID, password and Team ID."
      [ $attempt = 3 ] && die "Giving up after three tries."
    done
    ok "Apple accepts the Apple ID."
    ;;
  *) die "Choose a or b." ;;
esac
echo

# ---- 3. to GitHub -------------------------------------------------------------------------
if [ $DRY = 1 ]; then
  bold "Everything checks out. Dry run: no secrets set."
  exit 0
fi
read -r -p "Set these secrets on $REPO now? [y/N]: " go
[[ "$go" =~ ^[yY] ]] || die "Nothing set."

put() { gh secret set "$1" -R "$REPO" >/dev/null && ok "$1"; }
bold "Setting secrets"
base64 -i "$P12" | tr -d '\n' | put MAC_CERTIFICATE_P12_BASE64
printf '%s' "$P12_PASS" | put MAC_CERTIFICATE_PASSWORD
if [[ "$METHOD" =~ ^[aA]$ ]]; then
  put APPLE_API_KEY_P8 < "$P8"
  printf '%s' "$KEY_ID" | put APPLE_API_KEY_ID
  printf '%s' "$ISSUER" | put APPLE_API_ISSUER
else
  printf '%s' "$APPLE_ID" | put APPLE_ID
  printf '%s' "$APP_PASS" | put APPLE_APP_SPECIFIC_PASSWORD
  printf '%s' "$TEAM_ID" | put APPLE_TEAM_ID
fi
unset P12_PASS APP_PASS
echo
bold "Done. The next release tag builds a signed, notarized macOS app."
