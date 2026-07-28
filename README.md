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

## Send to Slicer (engraving tool)

The "Send to OrcaSlicer" / "Send to PrusaSlicer" buttons on `engrave.html` need a **one-time**
setup on each Windows machine that has the slicer installed (the engraved STL only exists
in-browser, so something local has to hand it to the desktop app):

```powershell
powershell -ExecutionPolicy Bypass -File tools/install-slicer-protocol.ps1
```

That registers a `hprobotslicer://` URL protocol (under `HKCU`, no admin rights needed) pointing
at `tools/slicer-open-handler.vbs` in the same folder. No terminal window or background process
needs to stay open afterwards — Windows launches the handler on demand, the same way a `mailto:`
or `vscode://` link works.

Clicking the button downloads the engraved STL, then opens `hprobotslicer://open?...`. The first
time, the browser shows a one-time "Open HP Robot Slicer Bridge?" confirmation — check **"Always
allow"** so later clicks skip the prompt entirely. From then on, clicking the button shows nothing
but the slicer itself opening: the registered command runs through a hidden `.vbs` wrapper
(`slicer-open-handler.vbs`) that launches the actual PowerShell logic (`slicer-open-handler.ps1`)
with a real hidden window style, instead of `powershell.exe -WindowStyle Hidden` directly — the
latter still flashes a console window briefly because it hides itself *after* creating it. The
handler finds the just-downloaded file in your Downloads folder and launches whichever slicer
(OrcaSlicer/PrusaSlicer) is registered on the machine with that file, exactly like double-clicking
it in Explorer. If something goes wrong (slicer not installed, file not found), a message box
explains why — that's the only other UI you'd ever see.

This deliberately avoids fetching to `127.0.0.1` from the page: PrusaSlicer's and OrcaSlicer's own
`prusaslicer://` / `orcaslicer://` handlers only accept files from their official model repos
(printables.com / Makerworld), and current Chromium browsers (142+) block/gate plain `fetch`
requests from a public `https://` page to `localhost` behind a separate "Local Network Access"
permission. A custom protocol registered on the machine sidesteps both restrictions.

To uninstall, delete the `HKCU:\Software\Classes\hprobotslicer` registry key.

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
