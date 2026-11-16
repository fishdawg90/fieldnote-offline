# Fieldnote Offline — proof of concept

A mobile field notebook for named areas (A4, A5, etc.), original photos, audio notes, GPS and **on-device Whisper transcription**. Designed to be opened in Chrome on Android through GitHub Pages, then used offline from the home screen.

## First use on the work phone

1. Open the published GitHub Pages URL in Chrome, not an embedded preview.
2. While on Wi-Fi, open **Settings → Offline speech** and tap **Download / check model**. Keep the page open. The app/runtime is about 12 MB and Whisper files about 43 MB. Completed downloads are reused after interruption.
3. Tap **Test sample**. Expect a transcript including “my fellow Americans”.
4. In Chrome's menu choose **Install app / Add to home screen** (the installation button also appears if the browser offers it).
5. Turn on airplane mode, close and reopen the app from the home screen, and repeat the sample test.
6. Make a short 5–15 second voice note in A4. Stop recording, wait for the transcript, check playback, and export it.

## Inspections

Use the small inspection selector above the area buttons to create, rename and switch between named inspections. Every new inspection starts with no areas; create only the areas you need. Area names can repeat in different inspections. The selected inspection and last area are remembered on this phone.

Existing records migrate into **Previous inspection** without changing their area/media IDs or audio/photo bytes. The original untouched A4/A5 starter pair is removed only when it is the entire area list and has no captures. Other existing areas are retained. No new A4 or A5 defaults are created.

**Export inspection** exports only the currently selected inspection and adds its name to the CSV, media metadata and ZIP filename. The ZIP includes an inspection manifest. **Full backup** includes every inspection, area and record (backup format v2). Restore accepts both v2 and older v1 backups; older ungrouped areas receive a restored-inspection group, while matching existing area IDs keep their inspection membership.

## Quick capture interface

The home screen is areas, Photo, Voice and the journal. Settings contains General, Offline speech and Data tabs; the initial setup panel is no longer on the home screen.

- **Photo:** in-app camera; press the shutter once to capture, save and return. There is no accept/review step. Chrome uses ImageCapture where supported, otherwise a video-frame JPEG. Camera fallback and existing-photo imports remain in Settings. A system camera may still have its own review button, which a website cannot remove.
- **Voice:** recording starts immediately after permission is available. Stop closes the recorder immediately; the original audio is saved and transcription is queued. You can keep taking photos or record another voice note while Whisper works. A small home status and each pending card show progress.
- Jobs are persisted with their original model choice. Unfinished jobs resume after reopening. Processing is in an app worker while the app is open, not a guaranteed Android background service when the app is closed/locked.
- Failed media writes retain an in-memory draft and show Retry save; keep the page open until saved. GPS fixes can attach after capture without delaying the journal, with location timestamps retained.
- Optional **Whisper Base English** is available in Settings → Offline speech. Its quantized files total about 79 MB (~91 MB with the runtime), compared with 43 MB of Tiny model files (~55 MB with runtime). It is expected to improve recognition, with slower processing. Download while online and test on your phone. Tiny remains cached if already downloaded, so keeping both uses extra space.

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

`src/capture.js` contains the in-app camera, immediate-save behavior and failed-save recovery. `src/boot.js` starts the app after event handlers are installed. `src/journal.js` contains area/media storage, metadata, exports and backup/restore. `src/offline.js` contains download preparation, integrity checks, audio decoding/resampling, inference orchestration and the sample test. `src/whisper-worker.js` performs inference. `src/sw-template.js` supplies the offline app shell and model cache routes. `scripts/build.mjs` vendors the pinned runtime and generates content-versioned shell cache lists and icons.

## Limits and phone acceptance check

Desktop browser checks do not establish work-phone compatibility. Base English revision is `95bf40a508535962c6483ead40270b2e32267508`. Employer policies can restrict microphone, location, installation, storage or downloads. Keep the app visible during recording/transcription; Android may suspend background pages. Transcription speed depends on the phone and may be slower than real time. Downloaded model files can be evicted by browser storage pressure. Test in airplane mode before relying on it onsite.

## Sources and licensing

App source: MIT. Transformers.js: Apache-2.0, https://github.com/huggingface/transformers.js . ONNX Runtime: MIT, https://github.com/microsoft/onnxruntime . Whisper: MIT, https://github.com/openai/whisper . ONNX model conversion: https://huggingface.co/Xenova/whisper-tiny.en . The six-second test sample is an excerpt of the public-domain JFK inaugural address, originally sourced from https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav and converted to mono 16 kHz PCM. The app's distributed `NOTICE.txt` and license files provide attribution.

## GIS layout import

Choose **GIS → Load GIS ZIP** and select the complete original ZIP on the phone. Keep all `.gdbtable`, `.gdbtablx`, `.spx`, `.atx` and other geodatabase companions together; individual binary files cannot display a layout. Nested `.gdb` folders and flat geodatabase ZIPs are detected. A synthetic **Try demo** ZIP exercises the same real OpenFileGDB import path. GeoJSON is also accepted inside a ZIP.

The local worker uses pinned GDAL3.js 2.8.1 / OpenFileGDB, reprojects known coordinate systems to WGS84, and displays vector layers with Leaflet. Layer switches, touch pan/zoom, fit-to-layout, attribute popups and a device GPS accuracy circle are provided. Missing coordinate systems use an explicit local XY view with GPS disabled. An optional EPSG override is in troubleshooting; enter it only when known from the source. By default no remote basemap, GIS upload or network coordinate transformation service is used. Optional online satellite imagery is described below. ArcGIS styling and raster layers are not imported.

**Prepare GIS offline** downloads about 40 MB of reader tools once from this app's own host. If browser storage is insufficient, import can run while online and reports that limitation; the data still stays local. Saved layouts can be reopened without the reader. Test import in airplane mode before onsite use. GDAL runs in a separate worker, which is released after conversion. Cancel leaves the previously saved layout intact.

This experimental viewer saves one reference layout separately from inspections. Importing another replaces that reference only. Inspection backups/exports do not include GIS geometry, so retain the original ZIP. Prototype limits: 100 MB compressed ZIP, 256 MB uncompressed, 20,000 ZIP members, 80 layers, 100,000 features and 48 MB converted GeoJSON. Complex or unsupported datasets may require a smaller GIS export. Diagnostics list archive contents, CRS/layer summaries and errors, without feature geometry or attributes; review filenames before sharing.

The automated test imports a synthetic projected three-layer File Geodatabase through the actual WASM reader and checks coordinates and attributes. It cannot establish compatibility with every private airfield database. Distributed GIS-SOURCES.txt and license files identify Leaflet (BSD-2-Clause), fflate (MIT) and unmodified GDAL3.js (LGPL-2.1-or-later); the latter links to its exact upstream source and package.

## Map-first capture layout

Capture opens the saved GIS layout, with selected-feature details above it and Photo / Voice fixed at the bottom. The area chip opens a picker or creates the first inspection; Records opens the current area journal and provides Back. Android Back closes a record detail before returning to the map. Existing saved captures, GPS, export, transcription queues and inspection grouping remain in the same stores.

Tap a feature to display the requested Annex/AOS asset fields. Null/blank fields are omitted; zero is retained. Condition cells use 0 grey, 1 red, 2–3 amber, 4–5 green, with values and labels in addition to colour. Overall RAG supplies subtle shape colours. Annex references are drawn as zoom-scaled, collision-aware canvas labels (up to 400 visible labels). "Work in [reference]" selects or creates that inspection's corresponding area; merely inspecting a shape does not change the capture area.

GIS is the import/settings tab, including layers, projection, offline reader preparation and diagnostics. The saved GIS reference layout is shared across inspections and remains separate from inspection backup/export; keep its original ZIP.

Satellite imagery is optional online Esri World Imagery, off by default on every app launch. Enter a suitably scoped ArcGIS API key with basemap access under GIS → Satellite imagery, save it, then enable Satellite in Capture. The key stays in this browser's settings and is excluded from inspection backups, exports and diagnostics. Restrict its allowed referrers to the app domain/path using the provider's key controls. Provider account terms, limits and charges apply. The app makes no tile prefetch/offline download; imagery requests reveal viewed tile locations to Esri, not feature geometry, attributes, media or transcripts. It falls back to the local map if offline or tile requests fail. Satellite alignment requires a geographic layer with a known source CRS.

Sources for the imagery integration: https://developers.arcgis.com/rest/basemap-styles/service-data/ and https://developers.arcgis.com/esri-leaflet/maps/display-multiple-basemap-layers/ . Provider attribution remains visible on the map. Actual imagery access requires a user key and has to be tested on the phone.
