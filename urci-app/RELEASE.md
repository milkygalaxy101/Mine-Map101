# Releasing URCI Field

## Once: the signing key

Android only installs an update if it is signed with the same key as the installed app. **If the key is lost,
every phone must uninstall the app to get updates** (inspections in the data folder survive; app settings do not).
Keep the `.jks` file and its password in two safe places (a password manager and an offline USB drive).

On a computer with a JDK (for `keytool`), `openssl` and the GitHub CLI (`gh`, logged in with admin rights on the repo):

```bash
cd urci-app
scripts/make-keystore.sh ~/urci-release.jks
```

It creates the key and sets the four repository secrets the release workflow needs:
`URCI_KEYSTORE_BASE64`, `URCI_KEYSTORE_PASSWORD`, `URCI_KEY_ALIAS`, `URCI_KEY_PASSWORD`.
(They can also be added by hand: GitHub, repository Settings, Secrets and variables, Actions.)

## Each release

1. Raise the version in **three** places (a test fails if they differ):
   - `urci-app/release.json`: `versionName` (x.y.z) and `versionCode` (must be higher than the last release)
   - `urci-app/package.json`: `version`
   - `urci-app/www/version.js`: `URCI_VERSION`
2. Commit and push; wait for the `urci-tests` and `URCI Field APK` checks to pass.
3. Tag and push the tag:
   ```bash
   git tag urci-v1.0.0
   git push origin urci-v1.0.0
   ```
4. The **URCI Field release** workflow checks the version, runs all tests, builds the signed APK, verifies the
   signature and publishes a GitHub Release with `URCI-Field-<version>.apk` and its `.sha256`.
5. `release.json` pins the signing certificate (`signingCertSha256`, set when the key was created on 2026-11-03);
   a release signed with any other key fails before it is published.

## On the phones

- Download the APK from the release page, allow "Install unknown apps" when asked, install.
- Compare the SHA-256 if the APK was passed around (WhatsApp, USB).
- Open Settings, tap the version number 5 times: the self-test must say **LULUS / PASS**.
