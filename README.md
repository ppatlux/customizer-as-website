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
