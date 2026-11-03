# URCI Field: week-1 device spike results (eng R13 / E-T1)

## Run 1 (2026-11-02)

**Phone:** realme 13 5G (RMX3951), realme UI 7.0, Android 16 (SDK 36), WebView 156, 12 GB RAM.
**Raw file:** `docs/designs/spike-results/2026-11-02-realme-RMX3951-android16.json`. It holds no coordinates, only
accuracies.

Two earlier attempts failed before any step ran. The page never loaded `@capacitor/core`, so
`registerPlugin` was missing. That is fixed now, and `spike/test/bridge-smoke.cjs` guards against it in CI.

| Step | Result | Stop rule | Verdict |
|---|---|---|---|
| 1. SAF folder pick | `Documents/urci`, picker shown, about 2.8 s per pick | no GAGAL | **pass** |
| 2. Photo ≤ 2048 px + stamp | camera file **3072 × 4080**; stamp 1.4–4.3 s; JPEG 2.0–2.6 MB | `resizeHonored` must be true | **FAIL** (fix below) |
| 2. First photo | `OS-PLUG-CAMR-0003` on the first try, then OK | — | first-time camera permission; handle it |
| 2. Display via `/_saf/` URL handler | 174–484 ms | works | **pass** |
| 3. Safe replace `.new → .old → rename` | 33 runs: `finalNameStable` always true, no SAF auto-rename; 0.34–1.02 s per write | `finalNameStable` true | **pass** |
| 4. 20-photo PDF in a Worker | build 3.8–4.4 s, write 1.6–3.3 s, 6.9 MB; main-thread gap 20–30 ms (606 ms when two runs overlapped) | gap < ~1000 ms | **pass** |
| 5. GPS native (`LocationManager`) | fix 59–685 ms, ±3–6 m, clock drift 0 s | — | **pass** |
| 5. GPS fused (Play Services) | fix 0.2–1.1 s, ±6–15 m | — | **pass** |
| 5. Fix at camera launch | available, ±11–34 m, 2.6–7.7 s old | — | **pass** (OV-5 works) |
| 6. Folder list / free space | 56–81 ms, 32.5 GB free | — | **pass** |

### The one failure: the camera ignores the target size

`@capacitor/camera` 8.2.6 maps `targetWidth`/`targetHeight` into its settings (`shouldResize = true`). But
the file it returns at `uri` is the full sensor image. Decoding and stamping a 12.5 MP image in the WebView is
the memory risk R7 was meant to remove, and stamping alone took up to 4.3 s on this fast phone.

**Fix, same decision (R7 "downscale at capture"), different mechanism:**
- `UrciStorage.downscale(uri, maxEdge = 2048)` runs natively.
  1. Read bounds only.
  2. Decode with a power-of-two `inSampleSize`, so 4080 px decodes straight to 2040 px (about 12 MB instead
     of 48 MB) and the full image is never in memory.
  3. Apply the EXIF rotation and write a JPEG to app-private cache.
- JS stamps only the downscaled file.
- The same method serves gallery import (E-T4 "gallery downscale").
- Added to the spike plugin for confirmation, as run 2.

### Other findings for the build
- **Camera permission:** request it before launching the camera. Map `OS-PLUG-CAMR-0003` to an ID/EN
  "izinkan kamera" message instead of a raw code.
- **Safe-replace cost:** about 0.6 s per JSON save on SAF (3 provider calls). That is fine for Save. Batch
  imports should not run one safe replace per index update; write the index once at the end (already the
  design in store.js).
- **Double taps:** the PDF and save buttons were tapped while a run was active, and overlapping runs doubled
  the main-thread gap. UX-1 "Save disabled while in flight" applies to every long action (PDF, export, import).
- **Coverage gap:** this is a fast, recent phone. The design's device matrix (Android 9/10, 11, 13, 14 and a
  phone without Play Services) is still needed, above all for stamping and PDF memory on a 2–3 GB phone.

## Run 2 (2026-11-02): downscale confirmed. Spike gate passed.

**Raw file:** `docs/designs/spike-results/2026-11-02-realme-RMX3951-android16-run2.json` (same phone).

| Measure | Run 1 (camera file) | Run 2 (native `downscale`) |
|---|---|---|
| Image stamped | 3072 × 4080 | **1536 × 2040** (`inSampleSize` 2, EXIF rotation 0) |
| `resizeHonored` | false | **true** (3/3) |
| Downscale | — | 232–307 ms |
| Decode in WebView | 216–229 ms | 34–61 ms |
| Stamp + JPEG encode | 1.4–4.3 s | 3.1 s first, then 1.5 s, 0.8 s |
| Stamped JPEG | 2.0–2.6 MB | **0.55–0.61 MB** |
| Write via SAF | 0.33–0.61 s | 0.70–0.79 s |

- **`OS-PLUG-CAMR-0003` again on the first photo after a fresh install.** This confirms it is the camera
  permission prompt. The app requests camera permission up front and maps this code to an ID/EN message.
- **The first stamp is the slowest (3.1 s):** a cold canvas and fonts. The build warms the stamp canvas and
  fonts when the Inspect screen opens, alongside the GPS warm-up.
- Safe replace, GPS and listing re-ran and pass again.

- **Squeezed photos in the PDF (owner report after run 2):** `pdf.worker.js` placed every photo in a fixed
  180 × 135 mm (4:3 landscape) box, so portrait photos and their stamps were squashed. Fixed by fitting each
  image inside the page area using its real pixel size (`fitBox`), checked on a rendered page. **Rule for
  `export.js`:** never give `addImage` a fixed width and height; always fit by the image's own aspect ratio.

**Gate result:** every R13 stop rule passes with native downscale. The production `UrciStorage` gets
`downscale(uri, maxEdge)` (camera and gallery). `stamp.js` works only on downscaled images. The low-end
device matrix (E-T8) still applies before release.

**Owner decision (2026-11-03): the low-end / no-Play-Services device test (E-T8, TEST-1 matrix) is not
required for the first release.** Accepted risk: memory and speed on 2–3 GB phones are untested. Mitigations
already in the app: native downscale before JS (R7), PDF built in a Web Worker (R3), OOM error codes surfaced
to the user, and the on-phone self-test (Settings, 5 taps on the version) for calculation correctness.
