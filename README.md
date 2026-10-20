# HP Robot Customizer Standalone

This project extracts the robot customizer from the original WordPress shortcode into a standalone static web app.

## Structure

- `index.html` - standalone app entry point
- `styles/app.css` - app styling
- `scripts/app.js` - app behavior and Three.js setup
- `scripts/asset-manifest.js` - local model asset mapping
- `assets/models/` - model files, grouped into one subfolder per part: `top/`, `middle/`, `face/`, `bottom/`, `motion/`, `hat/`, `arms/`, `spacer/`, `bumper/`
- `assets/asset-manifest.json` - source-to-local asset reference list
- `customizer.php` - original WordPress source kept for reference

## Important

The app now expects model files to be hosted locally under `assets/models/<part>/`, where `<part>` is the part's folder name (e.g. `assets/models/top/Top-MP3.glb`). The `wheels` part (labeled "Motion" in the UI) uses the `motion/` folder.

For each `.glb` listed in `scripts/asset-manifest.js`, also place matching `.step` and `.3mf` files in the same folder if you want STEP and 3MF downloads to work. Each manifest entry has a `folder` field pointing at its subfolder.

## Send to Slicer

The per-part "Print" buttons send the current part to the "Preferred Slicer" chosen in the
Settings modal (`#settings-overlay` in `index.html`, gear icon in the bottom toolbar — also home to
the Camera projection toggle, GLB/STEP downloads, and the Quick Guide launcher; see
`.settings-section` in `app.css` for adding more groups there later), backed by
`scripts/slicer-preference.js`. PrusaSlicer is the default.

- **PrusaSlicer / EasyPrint** (`scripts/prusa-export.js`, same approach as
  [3D-Ghost-Generator](https://github.com/gzeus/3D-Ghost-Generator)): the part's STL (hosted `.stl`
  if one exists, otherwise exported from the loaded mesh) is POSTed from the browser to Prusa's
  anonymous `https://slicer.printables.com/import` endpoint (CORS `*`, no backend of ours). Prusa
  returns an EasyPrint page (opened in a new tab) and a `prusaslicer://open?file=…` link pointing at
  *its own* temporary copy. Because that copy lives on Prusa's domain, PrusaSlicer's download
  allowlist doesn't matter — `hprobots.com` doesn't need to be on it
  ([PrusaSlicer#13752](https://github.com/prusa3d/PrusaSlicer/issues/13752)). `#prusa-overlay`
  shows upload progress with Cancel, and keeps a real link as a fallback when the browser blocks the
  new tab or the protocol launch. Uploads are capped at 100 MB; Prusa's links expire after
  30 minutes, so a repeat click on the same part within 25 minutes reuses the earlier upload.
  Every returned URL is checked to really point at printables.com / slicer.printables.com before
  it's followed. The endpoint isn't publicly documented — if it changes, this is the one file to fix.
- **Phones and tablets** (`canOpenDesktopSlicer()` in `slicer-preference.js`, by platform — touch
  laptops still count as desktop) always print with EasyPrint, which runs in the mobile browser; the
  Preferred Slicer choice is hidden there. The part rows show the EasyPrint button and the "…" menu
  has "Print build with EasyPrint". After the upload the dialog shows a "Continue to EasyPrint"
  button instead of auto-opening a tab: mobile browsers block `window.open` after an async upload,
  and only a link the user taps can be handed to an installed app that claims printables.com links.
- **OrcaSlicer**: a bare `orcaslicer://open?file=<url>` link to our own hosted STL (or STEP
  fallback). Its handler has no allowlist, so no upload is needed.

**Print whole build** (print icon in the bottom toolbar, `printWholeBuild()` in `app.js` +
`scripts/print-build.js`) builds one 3MF in the browser from the meshes in the scene: one named
object per visible part (plus the active mix's `extras`, minus manifest entries marked
`print: false` — PCBs, displays, encoders), welded, turned Z-up, grounded and laid out side by side
around the MK3/MK4 bed centre. It goes through the same Prusa upload; OrcaSlicer gets Prusa's
temporary file URL too, since a browser-built file has no URL of ours. Parts keep their
assembly orientation — rotate any that print better another way in the slicer.

Scene exports (`exportPartAsStlBlob`, Model Placer's STL save) are rotated Y-up → Z-up so parts
land upright in a slicer; hosted CAD STLs already are. `firstExistingUrl()` skips 0-byte files.

The engraving tool (`engrave.html`) only offers a plain "Download STL" button — no local setup,
no custom protocol, no helper scripts. Send the downloaded file to your slicer manually.

## Part Compatibility Checker

`tools/compat-checker.html` screens every cross-category pair of parts in
`scripts/asset-manifest.js` for geometric overlap (bounding-box prefilter, then a
BVH-accelerated voxel-sampled volume-overlap estimate via `three-mesh-bvh`) and lets you
visually confirm or reject the ones it flags. Decisions are written to
`assets/compatibility.json`, which `scripts/app.js` reads at startup
(`loadCompatibilityMap`/`findConflictFor`) to flag incompatible combinations in the live
app — a red warning badge appears on both conflicting parts (click either one to toggle a
translucent red glowing overlay on both, in place, showing the clash), but neither part is
hidden or changed; the user decides what to do with it. This is deliberately different from the two hand-coded structural
rules (Arms/Bumper, Race-bottom/Motion), which stay untouched and still auto-hide/auto-switch
since those are physical "can't both be attached" facts rather than soft geometry overlaps.

Open it through the same local server as the main app (see Local Run below), e.g.
`http://localhost:8000/tools/compat-checker.html`. "Scan new pairs" only analyzes pairs
introduced since the last run (new files added to the manifest show up automatically),
"Rescan auto results" re-runs the geometry check on everything not yet manually decided.
Use "Connect save file…" (Chromium browsers) to autosave decisions straight to
`assets/compatibility.json`, or "Download JSON" as a fallback to save it by hand.

## Mix Thumbnail Colours

The ready-made mixes live in `scripts/presets.js` (shared with `scripts/app.js`) and pin
part/variant/visibility only. Their preview-thumbnail colours are stored separately in
`assets/mix-colors.json` and applied **to the Mixes-tab thumbnails only** — clicking a mix
in the app still loads every part in the default colour. With no `mix-colors.json` (or an
empty one) every thumbnail falls back to the default part colour, matching the live app.
That file is authored with an internal-only tool that is not part of this repo.

## Local Run

Use a static file server instead of opening `index.html` directly.

Examples:

```bash
npx serve .
```

or

```bash
python -m http.server 8000
```

Then open the local URL in your browser.
