# Android release signing

Release builds are signed with the Play **upload key**. Debug builds keep the debug keystore and
need nothing set up. `plugins/with-release-signing.js` writes this into `android/app/build.gradle`
at prebuild, since `android/` is generated and not tracked.

## Supplying the key

The keystore and its passwords never go in the repository. The build reads four values, each as a
Gradle property first and then as an environment variable:

| Name | Value |
|---|---|
| `GOTG_UPLOAD_STORE_FILE` | Absolute path to the upload keystore |
| `GOTG_UPLOAD_STORE_PASSWORD` | The keystore's password |
| `GOTG_UPLOAD_KEY_ALIAS` | The key's alias inside it |
| `GOTG_UPLOAD_KEY_PASSWORD` | The key's password |

On a developer machine, put them in `~/.gradle/gradle.properties`, which is outside every
checkout. On a build server, set them as environment variables from its secret store.

If any is missing, packaging a release (`assembleRelease`, `bundleRelease`,
`expo run:android --variant release`) stops and names what is missing. It does not fall back to the
debug key. To try a release-like build on a phone without the key, use a debug build.

## Making the key

Once, by whoever will hold it:

```sh
keytool -genkeypair -v -storetype PKCS12 -keyalg RSA -keysize 2048 -validity 10000 \
  -keystore gotg-upload.p12 -alias gotg-upload
```

Then enrol the app in Play App Signing and register this as its upload key. Google holds the key
that signs what users install. The upload key only proves an upload came from us, and Play support
can replace it if it is lost.

## Custody

Not decided yet. Where the keystore and passwords live, and who can get to them, must be written
here before the first Play upload. A keystore that exists on one laptop only is a single point of
failure for shipping at all.
