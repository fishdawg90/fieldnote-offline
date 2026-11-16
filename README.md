# Fieldnote Offline — proof of concept

A mobile field notebook for named areas (A4, A5, etc.), original photos, audio notes, GPS and **on-device Whisper transcription**. Designed to be opened in Chrome on Android through GitHub Pages, then used offline from the home screen.

## First use on the work phone

1. Open the published GitHub Pages URL in Chrome, not an embedded preview.
2. While on Wi-Fi, tap **Prepare for offline use**. Keep the page open. The app/runtime is about 12 MB and Whisper files about 43 MB. Completed downloads are reused after interruption.
3. Tap **Run local sample test**. Expect a transcript including “my fellow Americans”.
4. In Chrome's menu choose **Install app / Add to home screen** (the installation button also appears if the browser offers it).
5. Turn on airplane mode, close and reopen the app from the home screen, and repeat the sample test.
6. Make a short 5–15 second voice note in A4. Stop recording, wait for the transcript, check playback, and export it.

## Recording and transcription

- Records original audio before starting Whisper. The speech model never competes with the recorder for the microphone.
- Uses **Xenova/whisper-tiny.en**, an 8-bit English Whisper model, revision `79fb389fc764e7c395bd330e9531d9d32ada7049`.
- Runs Transformers.js 3.8.1 and ONNX Runtime WebAssembly inside a worker on this phone; CPU, one thread, no WebGPU dependency.
- No Python, account, API key, subscription or speech service.
- After initial setup, model loading and transcription have no remote-model fallback. The worker rejects requests outside this app's origin/path. Missing offline model files cause a visible error, never an online transcription upload.
- The sample test starts a fresh worker, so it checks model/runtime loading from device storage rather than relying on an already-loaded model. It also verifies that the actual speech sample is recognised.
- This proof of concept limits clips to two minutes. Prefer short observations. Technical terminology, numbers and names need review. Small models can hallucinate on silence/noise; very quiet clips are rejected before processing.
- If processing fails, original audio remains saved and **Transcribe on this phone** can retry later.

## Data, GPS and exports

- IndexedDB stores observations and original media on the current browser/device. No sync, telemetry or media upload is implemented. The public repository/site contains app code, not captured records.
- Photos are stored byte-for-byte, preserving EXIF that the camera/browser supplies. Browsers can omit camera EXIF; a separate device location fix, time and accuracy is also saved where available.
- Camera location is approximate and not shutter-synchronised. Imported photos are not assigned the import location. Native-recorder attachment locations are explicitly labelled as recorder-launch / attachment locations, not guaranteed audio start positions.
- GPS may take longer without mobile data. Map links require internet. These are not survey coordinates.
- **Export files + GPS** creates a ZIP of original media, transcript text files, GPS JSON sidecars, a CSV index and separate geotagged JPEG copies where possible.
- **Full backup** creates a JSON backup including media. **Restore backup** merges by record ID and also accepts backups from the earlier standalone Fieldnote HTML.
- Export regularly. Clearing site/browser data removes records, offline runtime and model. Persistent storage is requested but is subject to browser/employer policies.
- Use device file sharing/email to send exported files; there is no cloud upload path in the app.

## GitHub Pages

The included workflow builds and deploys `dist/` on pushes to `main`. The first run attempts to enable Pages. If the configure-pages job reports Pages is disabled, open **Settings → Pages → Build and deployment → Source → GitHub Actions**, then rerun the workflow. Repository administrator permission may be needed.

The app uses relative URLs so it works under a repository subpath. Source and dependencies are public. App files are served from GitHub Pages; model downloads come from Hugging Face during initial preparation only. A work network must allow those initial downloads.

## Development

```sh
npm ci
npm test
npm run build
```

Serve `dist/` over HTTPS, or localhost for development. This is intentionally an offline web application rather than a single local HTML file: browser microphone permissions, service workers and cached model/runtime assets need a suitable web origin. No production server or database is needed.

`src/journal.js` contains area/media storage, metadata, exports and backup/restore. `src/offline.js` contains download preparation, integrity checks, audio decoding/resampling, inference orchestration and the sample test. `src/whisper-worker.js` performs inference. `src/sw-template.js` supplies the offline app shell and model cache routes. `scripts/build.mjs` vendors the pinned runtime and generates content-versioned shell cache lists and icons.

## Limits and phone acceptance check

Desktop browser checks do not establish work-phone compatibility. Employer policies can restrict microphone, location, installation, storage or downloads. Keep the app visible during recording/transcription; Android may suspend background pages. Transcription speed depends on the phone and may be slower than real time. Downloaded model files can be evicted by browser storage pressure. Test in airplane mode before relying on it onsite.

## Sources and licensing

App source: MIT. Transformers.js: Apache-2.0, https://github.com/huggingface/transformers.js . ONNX Runtime: MIT, https://github.com/microsoft/onnxruntime . Whisper: MIT, https://github.com/openai/whisper . ONNX model conversion: https://huggingface.co/Xenova/whisper-tiny.en . The six-second test sample is an excerpt of the public-domain JFK inaugural address, originally sourced from https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav and converted to mono 16 kHz PCM. The app's distributed `NOTICE.txt` and license files provide attribution.
