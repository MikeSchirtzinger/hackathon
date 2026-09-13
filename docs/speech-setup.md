# Local speech setup

Spark packages Nemotron transcription and Kokoro speech with the extension. A fresh clone can fetch the pinned assets directly:

```sh
npm ci
npm run setup:assets
npm run build
```

Use Node.js 22 or later and an installed `tar` command. Setup downloads public model and runtime files over HTTPS. It needs no API credentials and sends no captured content. It verifies archive sizes and SHA-256 hashes before extraction, then checks the extracted content against the committed asset manifest. Model licenses, notices and the runtime license are installed with the assets. Extension inference loads local files only.

The first download is estimated at 572 MB. Keep an estimated 2.5 GB of free disk space for the downloads, extracted staging files and installed assets. Verified archives remain in `.cache/speech-assets/` so interrupted setup can retry without downloading successful archives again. A completed installation is checked and reused. Replacements are staged before installation; failed downloads cannot replace a working model.

Load this repository's `extension/` folder with **Load unpacked** at `chrome://extensions`. Chrome requires the user to enable Developer mode and select that folder. The folder must stay in place. After upgrading files, click **Reload** for the extension.

Chrome also requires explicit microphone permission before microphone transcription. Capturing meeting-tab audio requires an extension invocation on that tab. Browser speech playback may require a user gesture. These browser permissions cannot be silently granted by setup. Speaker playback through Kokoro does not need BlackHole. Routing speech into another meeting participant's microphone remains a separate setup through `sh install.sh`, audio-device selection and participant verification.

## Check or repair an installation

```sh
npm run setup:assets -- --check
npm run setup:assets
```

The first command performs no writes or network requests. Missing assets, changed bytes, missing licenses and inconsistent runtime file lists return a failing exit status. The second command repairs an incomplete installation with verified downloads. A passing asset check confirms the installed files; successful transcription and synthesis require a browser run.

For a second checkout without another download:

```sh
node scripts/setup-speech-assets.mjs --cache-dir /path/to/first/checkout/.cache/speech-assets --offline
```

An empty or damaged offline cache fails explicitly. Use the same command without `--offline` to permit verified downloads. `--target /path/to/extension` selects a different installation directory without changing the checkout's extension. `--help` lists the options.

The existing importer is still available:

```sh
node scripts/import-assets.mjs /path/to/existing/extension
npm run prepare:assets
npm run setup:assets -- --check
```

`prepare:assets` builds runtime file lists from existing local files. It checks required model files and Kokoro language data; it does not download assets or establish model integrity. The setup check verifies integrity against [the pinned manifest](../scripts/speech-assets.json). Source URLs in that manifest identify the exact upstream distributions and preserve their license provenance.
