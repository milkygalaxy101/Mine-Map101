# URCI Field — week-1 device spike (throwaway)

Purpose (eng review R13): prove on one cheap Android 8/9 phone, with timings, before the full build:
1. SAF folder pick with persisted permission
2. Camera capture at ≤2048 px (`takePhoto` target size) + canvas stamp with bundled IBM Plex Mono
3. Crash-safe replace on SAF (`.new` → `.old` → rename), including what names SAF actually creates
4. 20-photo PDF built in a Web Worker that reads photos from `https://localhost/_saf/…` (no base64 reads)
5. GPS: fused (Play Services) vs native `LocationManager`, fix at camera launch, clock drift vs GPS time
6. Folder listing speed and free space

## Get the APK
Every push touching `spike/` runs `.github/workflows/spike-apk.yml`, which builds a **debug APK** and attaches it
as the `urci-spike-debug-apk` artifact on the workflow run (GitHub → Actions → "Spike APK").

## Run the spike
1. Install the APK on the test phone ("install unknown apps" for your file manager/browser).
2. Turn on airplane mode, but keep **Location** on.
3. Tap steps 1 → 6 in order (take 2–3 photos in step 2, then try it once outdoors for GPS).
4. Tap **Simpan spike-results.json**; the file lands in the chosen folder under `spike/`.
5. Send `spike-results.json` back. Stop-and-replan rule: any red **GAGAL** line, `resizeHonored:false`,
   `finalNameStable:false`, or a PDF `longestMainThreadFrameGapMs` above ~1000 means re-plan before building.

Not production code: Java plugin and a single-file harness on purpose.
