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
`orcaslicer://open?file=<url>` link — no local setup needed, same as the original WordPress
version. OrcaSlicer only, for now: PrusaSlicer's own `prusaslicer://` handler only accepts
download URLs from a short, manually reviewed allowlist (currently printables.com,
thingiverse.com, cults3d.com) and rejects everything else, including files hosted here (see
[PrusaSlicer#13752](https://github.com/prusa3d/PrusaSlicer/issues/13752), closed "not planned").
The only real fix is asking Prusa to add `hprobots.com` to that allowlist after their security
review — until that happens (or is confirmed a dead end), the slicer picker (`#slicer-group` in
`index.html`) is hidden and the Print button always targets OrcaSlicer. To bring PrusaSlicer back
here: un-hide `#slicer-group`, then in `scripts/app.js`'s `role === 'print'` handler branch on
`getPreferredSlicer()` again (fall back to a plain STEP download when it's `'prusa'`).

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
rules (Arms/Bumper, F1-bottom/Motion), which stay untouched and still auto-hide/auto-switch
since those are physical "can't both be attached" facts rather than soft geometry overlaps.

Open it through the same local server as the main app (see Local Run below), e.g.
`http://localhost:8000/tools/compat-checker.html`. "Scan new pairs" only analyzes pairs
introduced since the last run (new files added to the manifest show up automatically),
"Rescan auto results" re-runs the geometry check on everything not yet manually decided.
Use "Connect save file…" (Chromium browsers) to autosave decisions straight to
`assets/compatibility.json`, or "Download JSON" as a fallback to save it by hand.

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
