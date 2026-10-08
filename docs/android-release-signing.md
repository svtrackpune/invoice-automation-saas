# Android release signing

## Package identity

- Application ID: `in.nilanga.moneymatters`
- Capacitor Android: 6.2.2
- Release artifact: `android/app/build/outputs/bundle/release/app-release.aab`

## Local release signing

Generate a release keystore outside source control. Example:

```bash
keytool -genkeypair -v \
  -keystore android/release-key.jks \
  -alias moneymatters-release \
  -keyalg RSA \
  -keysize 4096 \
  -validity 10000
```

Copy `android/key.properties.example` to `android/key.properties` and fill in the four values.

Build the signed production bundle:

```bash
npm run android:aab:release
```

The production release script passes `-PrequireReleaseSigning=true`, so it fails closed when signing material is missing or the keystore file is unavailable.

Debug AAB builds use Android's normal debug signing:

```bash
npm run android:aab:debug
```

## CI signing

Never commit the keystore or `key.properties`.

The GitHub Actions workflow `.github/workflows/android-release.yml` expects these repository or environment secrets:

- `ANDROID_KEYSTORE_BASE64` — base64-encoded release keystore
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

The workflow materializes the keystore under the runner's temporary directory, exposes only the signing values required by Gradle, builds the AAB, and publishes the AAB as a workflow artifact.

The Gradle configuration also accepts the four `ANDROID_*` signing variables for other CI/CD systems.

## Signing configuration precedence

For each setting, Gradle uses:

1. `android/key.properties`
2. Matching environment variable

| `key.properties` | Environment variable |
|---|---|
| `storeFile` | `ANDROID_KEYSTORE_PATH` |
| `storePassword` | `ANDROID_KEYSTORE_PASSWORD` |
| `keyAlias` | `ANDROID_KEY_ALIAS` |
| `keyPassword` | `ANDROID_KEY_PASSWORD` |

An environment value is used when its property is absent or blank.

## Security

The repository ignores `*.jks`, `*.keystore`, `android/key.properties`, and `key.properties` at both repository levels.

Do not place passwords, private keys, or encoded keystores in source files, committed documentation, logs, or other tracked files.

For Google Play distribution, retain the signing material securely and use the appropriate Play App Signing/upload-key process for the app's release lifecycle.
