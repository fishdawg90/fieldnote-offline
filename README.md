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
- **Export inspection** creates a ZIP with smaller photo copies, original audio, transcript text files, GPS JSON sidecars and a CSV index. Each photo appears once, with embedded GPS where possible.
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

The local worker uses pinned GDAL3.js 2.8.1 / OpenFileGDB, reprojects known coordinate systems to WGS84, and displays vector layers with Leaflet. Layer switches, touch pan/zoom, fit-to-layout, attribute popups and a device GPS accuracy circle are provided. Missing coordinate systems use an explicit local XY view with GPS disabled. An optional EPSG override is in troubleshooting; enter it only when known from the source. By default no remote basemap, GIS upload or network coordinate transformation service is used.  ArcGIS styling and raster layers are not imported.

**Prepare GIS offline** downloads about 40 MB of reader tools once from this app's own host. If browser storage is insufficient, import can run while online and reports that limitation; the data still stays local. Saved layouts can be reopened without the reader. Test import in airplane mode before onsite use. GDAL runs in a separate worker, which is released after conversion. Cancel leaves the previously saved layout intact.

This experimental viewer saves one reference layout separately from inspections. Importing another replaces that reference only. Inspection backups/exports do not include GIS geometry, so retain the original ZIP. Prototype limits: 100 MB compressed ZIP, 256 MB uncompressed, 20,000 ZIP members, 80 layers, 100,000 features and 48 MB converted GeoJSON. Complex or unsupported datasets may require a smaller GIS export. Diagnostics list archive contents, CRS/layer summaries and errors, without feature geometry or attributes; review filenames before sharing.

The automated test imports a synthetic projected three-layer File Geodatabase through the actual WASM reader and checks coordinates and attributes. It cannot establish compatibility with every private airfield database. Distributed GIS-SOURCES.txt and license files identify Leaflet (BSD-2-Clause), fflate (MIT) and unmodified GDAL3.js (LGPL-2.1-or-later); the latter links to its exact upstream source and package.

## Map-first capture layout

Capture opens the saved GIS layout, with selected-feature details above it and Photo / Voice fixed at the bottom. The area chip opens a picker or creates the first inspection; Records opens the current area journal and provides Back. Android Back closes a record detail before returning to the map. Existing saved captures, GPS, export, transcription queues and inspection grouping remain in the same stores.

Tap a feature to display its Location as the main heading and its Annex reference beneath. Asset is omitted; Area is labelled in m². Other requested AOS fields appear below. Null/blank fields are omitted; zero is retained. Condition cells use 0 grey, 1 red, 2–3 amber, 4–5 green, with values and labels in addition to colour. Overall RAG supplies subtle shape colours only for features with an Annex A6 label; all other shapes are grey. Annex references are drawn as zoom-scaled, collision-aware canvas labels (up to 400 visible labels). "Work in [reference]" selects or creates that inspection's corresponding area; merely inspecting a shape does not change the capture area.

GIS is the import/settings tab, including layers, projection, offline reader preparation and diagnostics. The saved GIS reference layout is shared across inspections and remains separate from inspection backup/export; keep its original ZIP.

## Continuous GPS

Use the top-left GPS switch to keep a high-accuracy location watch active while the app is visible. Its enabled preference is remembered on this device. The switch reports waiting, a recent fix, or paused; the accuracy is shown by the capture controls. Turning it off clears the watch and latest fix. Captures can still request a single location fix as before.

When the app is hidden, locked, or navigated away from, its watch is cleared and the old fix is discarded. Returning to the visible app restarts an enabled watch and requests a new fix. Callbacks from an earlier watch and positions older than one minute are ignored. Permission denial turns the preference off. The map's accuracy circle updates with fresh positions without automatically panning away from the inspection area.

A web app cannot guarantee GPS while the screen is locked or the browser is suspended. The toggle does not keep the screen awake or bypass phone/employer background policies. Test reacquisition outdoors on the work phone. Satellite integration has been removed; no remote basemap is used.

## Delete a working area

In the area picker, hold an existing area for about half a second (or use its context menu), then tap Delete area. The edit-area dialog also provides Delete area for keyboard/accessibility users. Empty areas delete after that explicit action; areas containing records require a second warning listing the photos and voice notes that will be permanently deleted. Export first if those files are needed.

The area and its records are removed in one transaction. Other inspections/areas remain intact. A changed record list aborts deletion for review. Deletion waits until current recording, camera capture, unsaved drafts and transcription work finish. Entry writes check the parent area in the same transaction, so a delayed GPS or transcription callback cannot recreate records in a deleted area.

Photos captured using the built-in camera are stored as blobs in browser IndexedDB. Fieldnote does not write them to Android's shared camera roll or upload them. The optional Phone camera fallback is a separate Android camera flow and may save a gallery copy; Google Photos, OneDrive or other configured backup tools may back up that copy. Exports can also leave app storage. This app cannot control phone-wide or employer backup policies.

## Records while transcribing

Records are rendered only while the Records view is open and load in batches of 12. During active/starting transcription, cards show text and metadata without decoding original photos. Photo/audio detail previews also pause; they can be loaded explicitly when transcription ends. Closing the journal/detail releases its image/audio URLs and playback resources. An idle Whisper worker is released before displaying gallery media; queued clips can still share a worker while transcription continues.

This addresses a suspected memory-pressure failure when combining original-resolution image decoding with WASM inference on iPhone. The behaviour has automated coverage, but the exact iPhone/browser combination needs a device retest. Originals are unchanged. An interrupted processing entry retries automatically once; a second interruption leaves the recording saved with a manual retry action instead of creating a reload/retry loop. An explicit transcription retry resets that interruption counter.

## Linked GIS working areas

Loading a layout creates one working area for each unique prefix before the underscore in Annex A6 labels, reusing existing names in the selected inspection. For example, A6_01 and A6_02 both use A6. Other inspections have their own areas. Opening an existing saved layout after upgrading also creates its areas once; if no inspection is selected, creation waits until one is named/selected. A per-inspection import marker prevents a deleted area from being recreated merely by reopening the app. Reimporting the GIS or explicitly tapping a deleted labelled shape can create it again.

Tapping a labelled shape selects its prefix working area for subsequent photos/voice notes. Selecting an area in the picker highlights its matching feature and displays its data, centring the view there; a manual area with no matching shape clears the feature panel. Unlabelled shapes remain grey and do not change the working area. A recording already in progress keeps the area captured when it started.

## Move multiple records to a reference area

In Records, long-press a card (or use Select) to enter selection mode. Tap additional photo/voice cards, then Change area, choose a destination in the current inspection, and Move records. Select shown selects the currently loaded batch; Load more lets the selection span further batches. Done or leaving Records clears selection. Changing inspection, area filter, type filter or search also clears selection.

The move validates all selected records and the destination, then updates the group in one IndexedDB transaction. Original media, GPS and transcript fields are retained; stale/deleted or cross-inspection selections abort the whole move. Background transcription and late GPS now patch the latest stored record in a transaction so they cannot undo a reference-area move. Capture's current working area is not changed by moving existing records.

Regression tests use fake-indexeddb to check mixed-media moves, rollback and competing transcript/GPS updates in both transaction orders. Browser QA exercised long-press selection and moving a synthetic photo and voice note from A4 to A5 through the visible interface.

## Prefix areas and merging existing references

Existing asset-code areas such as A6_01 / A6_02 merge into A6 automatically at startup and after restoring a backup. The migration updates areas, record assignments and saved navigation in one transaction, preferring an existing A6 area ID. It is idempotent and never combines different inspections. Descriptive manual names such as North_apron are left intact. All original media, GPS, notes and transcript fields remain; former suffixed reference names are retained in each affected record's previousAreaReferences metadata.

GIS imports now create prefix areas, and taps on individual assets select that prefix for capture. The full Annex label and individual asset attributes remain on the map. Picking a prefix shared by several shapes frames its assets and shows a group summary; tapping a shape shows its individual details. No GIS reimport is required to merge existing areas.

## Capture locations on the GIS map

The Capture map displays small blue camera badges for photos and purple microphone badges for voice notes in the current inspection. The non-interactive overlay follows pan/zoom and refreshes after saves, late GPS attachment, moves, deletion and inspection changes. It reads location metadata only and does not decode media. Each capture stays at its exact saved position as an individual 12 CSS-pixel icon at every map zoom level. There is no clustering, count badge or positional offset; captures at identical coordinates can overlap.

Photo EXIF GPS takes precedence, with separate device GPS as a fallback; voice notes use their saved device location. Invalid/missing coordinates are omitted rather than assigning an area-centre or current-device position. GPS badges are disabled in local XY mode, which cannot be aligned to latitude/longitude. No basemap requests or uploads are added.


## GPS working-area check

The area button is pale green when a recent GPS accuracy circle fits inside the selected Annex prefix area, pale red when it fits inside a different prefix area, and white when uncertain. A6_01 and A6_02 both compare as A6. This uses the saved geographic polygon layout offline, including hidden polygon layers; lines/points and local XY layouts cannot establish containment.

Confidence requires a fix less than 15 seconds old, reported accuracy of 25 metres or better, and the entire accuracy radius plus a 3 metre margin inside a labelled polygon. Boundary positions, holes, overlapping different references, unlabelled coverage and locations outside the layout remain neutral. The check is deliberately conservative at seams between polygons, including same-prefix polygons. GPS accuracy is an estimate, not a survey guarantee. Status expires automatically and clears while the app is hidden.

Tapping Photo with a confident different area offers to switch to the matching existing area in the current inspection before opening the camera. Accepting updates the capture reference and GIS details; declining retains the selected area and continues capture. The same check applies to Phone camera from Settings; switching from an already open in-app camera retains that camera session's reference. No background GPS permissions or uploads are added.


## Smaller photo exports and progress

Inspection ZIP exports resize photos to at most 2048 pixels on the long edge, preserving aspect ratio and using JPEG quality 0.82. Small photos are never enlarged. A recompressed copy is used only when it is smaller; unsupported/unreadable images fall back to the original, with the fallback count displayed. This affects export only: stored originals and Full backup are unchanged. Audio is unchanged.

There is one exported photo per record rather than an original plus a duplicate geotagged image. GPS is reinserted into JPEG copies, preferring original EXIF coordinates over device GPS, and the JSON sidecars preserve both original sources, timestamps and accuracy. Sidecars report original/export sizes and exported filename/MIME, and CSV filenames follow the exported extension. Compressed copies may omit other original EXIF metadata; Full backup retains original bytes.

A progress bar in Settings → Data shows photo preparation, ZIP creation and download readiness. Photos process sequentially and release the decoded image and canvas after each record. ZIP creation reads CRC data in 256 KB slices and retains Blob references rather than complete byte arrays per file, yielding between slices so progress can paint. Completion reports the reduction in photo bytes. The browser's download UI handles the final disk-save step.

Validation includes ZIP binary/Unicode/empty-file round trips, progress monotonicity, resolution rules and export filename/sidecar/GPS consistency. Browser QA exported three synthetic 4032×3024 JPEGs: each reduced from 15,545,938 to 1,575,147 bytes at 2048×1536. The downloaded ZIP passed CRC validation and retained the test EXIF coordinates. Savings vary with the source photo.

## Saved-record GPS area suggestions

Records now display a small pin button labelled “Move to A7” when their saved photo/recording location confidently falls in a different Annex prefix area in the loaded geographic GIS layout. The target reference is visible on the button. A7_01 and A7_02 both count as A7. Missing/weak GPS, boundaries, ambiguous overlaps and destinations absent from the record's inspection do not produce a suggestion. This uses saved coordinates; it never assigns records using the current phone position or ages out historical capture fixes. Photo EXIF takes precedence; when EXIF has no accuracy field, a conservative 25 metre boundary buffer plus the usual 3 metre margin is required.

Tapping the suggestion moves just that record immediately. The database transaction reads the latest record and areas, rechecks the suggested destination, and preserves all original media, GPS, text and transcription fields. A changed/deleted suggestion aborts without moving anything. Capture's working area stays unchanged; when viewing one area's records, a corrected record leaves that filtered list. Suggestions are separate buttons outside the record-opening button and are hidden during multiselection. Detection uses metadata only and preserves the existing transcription/gallery memory limits.

Tests cover historical GPS and EXIF precedence, grouped references, uncertainty, inspection isolation, stale suggestions and competing transcription updates in either order. Browser QA loads synthetic labelled polygons and corrects a saved record through its visible suggestion button.
