# HP Robot Customizer Standalone

This project extracts the robot customizer from the original WordPress shortcode into a standalone static web app.

## Structure

- `index.html` - standalone app entry point
- `styles/app.css` - app styling
- `scripts/app.js` - app behavior and Three.js setup
- `scripts/asset-manifest.js` - local model asset mapping
- `assets/models/` - place all `.glb`, `.step`, and `.3mf` files here
- `assets/asset-manifest.json` - source-to-local asset reference list
- `customizer.php` - original WordPress source kept for reference

## Important

The app now expects model files to be hosted locally under `assets/models/`.

For each `.glb` listed in `scripts/asset-manifest.js`, also place matching `.step` and `.3mf` files in the same folder if you want STEP and 3MF downloads to work.

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
