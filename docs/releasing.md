# Releasing

Pushing a version tag builds installers for macOS, Windows and Linux and attaches them to a
**draft** GitHub release (`.github/workflows/release.yml`):

```sh
npm version 0.3.0 --no-git-tag-version
git commit -am "Release 0.3.0"
git tag v0.3.0
git push && git push origin v0.3.0
```

Check the draft on GitHub's Releases page, then publish it.

## macOS: signing and notarization

macOS only opens downloaded apps without a warning when they're signed with a **Developer ID**
certificate and **notarized** by Apple. The release workflow does both, from repository secrets.
Without them the macOS build stops with a message saying which secrets are missing, rather than
publishing an app macOS won't open. (Windows and Linux builds are unsigned.)

It needs an [Apple Developer Program](https://developer.apple.com/programs/) membership.

### 1. The Developer ID certificate

1. On a Mac, in Xcode → Settings → Accounts → your team → Manage Certificates, add a
   **Developer ID Application** certificate (or create one at
   developer.apple.com → Certificates).
2. In Keychain Access, find "Developer ID Application: …", right-click → Export, and save it as a
   `.p12` file with a password.
3. Encode it for GitHub: `base64 -i DeveloperID.p12 | pbcopy`

| Secret | Value |
|---|---|
| `MAC_CERTIFICATE_P12_BASE64` | the base64 text from step 3 |
| `MAC_CERTIFICATE_PASSWORD` | the password you set in step 2 |

### 2. Notarization credentials

Either an **App Store Connect API key** (recommended):

1. App Store Connect → Users and Access → Integrations → App Store Connect API → generate a key
   with the **Developer** role, and download the `.p8` file (it can only be downloaded once).

| Secret | Value |
|---|---|
| `APPLE_API_KEY_P8` | the contents of the `.p8` file (including the BEGIN/END lines) |
| `APPLE_API_KEY_ID` | the key's ID |
| `APPLE_API_ISSUER` | the Issuer ID shown above the keys |

Or your **Apple ID** with an app-specific password (appleid.apple.com → Sign-In and Security →
App-Specific Passwords):

| Secret | Value |
|---|---|
| `APPLE_ID` | your Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | the app-specific password |
| `APPLE_TEAM_ID` | your 10-character Team ID (developer.apple.com → Membership) |

Add the secrets under the repository's Settings → Secrets and variables → Actions, or with the
GitHub CLI, for example `gh secret set APPLE_API_KEY_P8 < AuthKey_XXXXXXXXXX.p8`.

### Checking a build

After downloading the `.dmg` and copying the app to Applications:

```sh
spctl -a -vvv -t install "/Applications/Clause Pilot.app"   # "source=Notarized Developer ID"
xcrun stapler validate "/Applications/Clause Pilot.app"
```
