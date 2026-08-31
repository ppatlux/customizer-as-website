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

The per-part "Print" buttons in `index.html` open the part directly with a bare
`prusaslicer://open?file=<url>` or `orcaslicer://open?file=<url>` link — no local setup needed,
same as the original WordPress version. Which scheme is used depends on the "Preferred Slicer"
choice in the Settings modal (`#settings-overlay` in `index.html`, gear icon in the bottom
toolbar — also home to the Camera projection toggle, GLB/STEP downloads, and the Quick Guide
launcher; see `.settings-section` in `app.css` for adding more groups there later), backed by
`scripts/slicer-preference.js`.

**PrusaSlicer is NOT actually live yet.** Its `prusaslicer://` handler only accepts download URLs
from a short, manually reviewed allowlist. `hprobots.com` was rejected from it (see
[PrusaSlicer#13752](https://github.com/prusa3d/PrusaSlicer/issues/13752), closed "not planned"),
but Prusa has since agreed to add it after a direct request — the change ships in a future
PrusaSlicer release (ETA a month or two out as of writing), not immediately. Until it ships,
`prusaslicer://` links from this domain 404 for anyone on the current PrusaSlicer release.
OrcaSlicer's `orcaslicer://` has no such allowlist and works regardless.

This is gated behind one flag, `PRUSA_SLICER_LIVE` in `scripts/slicer-preference.js`, currently
`false`. Everything downstream of it (`getPreferredSlicer()`, the Settings menu's PrusaSlicer
option, the `role === 'print'` branch in `scripts/app.js`) already funnels through that flag, so
**this whole feature is safe to commit, merge, and deploy right now alongside unrelated work** —
while the flag is `false`, behavior is identical to the old OrcaSlicer-only build: Print always
uses OrcaSlicer, and PrusaSlicer shows up in the Settings menu only as a disabled "coming soon"
preview. Flipping `PRUSA_SLICER_LIVE` to `true` and redeploying is the entire "go live" step once
the PrusaSlicer release is confirmed out — no other changes needed.

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
