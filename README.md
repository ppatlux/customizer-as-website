# HP Robot Customizer Standalone

This project extracts the robot customizer from the original WordPress shortcode into a standalone static web app.

## Structure

- `index.html` - standalone app entry point
- `styles/app.css` - app styling
- `scripts/app.js` - app behavior and Three.js setup
- `scripts/asset-manifest.js` - local model asset mapping
- `scripts/saved-builds.js` - storage for "My builds" (local today, swappable for an account later; see Saved Builds)
- `assets/models/` - model files, grouped into one subfolder per part: `top/`, `middle/`, `face/`, `bottom/`, `motion/`, `hat/`, `arms/`, `spacer/`, `bumper/`
- `assets/asset-manifest.json` - source-to-local asset reference list
- `customizer.php` - original WordPress source kept for reference

## Important

The app now expects model files to be hosted locally under `assets/models/<part>/`, where `<part>` is the part's folder name (e.g. `assets/models/top/Top-MP3.glb`). The `wheels` part (labeled "Motion" in the UI) uses the `motion/` folder.

For each `.glb` listed in `scripts/asset-manifest.js`, also place matching `.step` and `.3mf` files in the same folder if you want STEP and 3MF downloads to work. Each manifest entry has a `folder` field pointing at its subfolder.

## Send to Slicer

The per-part "Print" buttons send the current part to the "Preferred Slicer" chosen in the
Settings modal (`#settings-overlay` in `index.html`, "⋮" → Settings in the top bar — also home to
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
  Preferred Slicer choice is hidden there. The part rows show the EasyPrint button and the top bar's "⋮" menu
  has "Print build with EasyPrint". After the upload the dialog shows a "Continue to EasyPrint"
  button instead of auto-opening a tab: mobile browsers block `window.open` after an async upload,
  and only a link the user taps can be handed to an installed app that claims printables.com links.
- **OrcaSlicer**: `orcaslicer://open?file=<url>` with Prusa's temporary file URL (its handler has
  no allowlist), so it gets the same print-ready 3MF.

**Separate print bodies.** Many models combine several separately printed bodies in one file
because that's how they look assembled (both wheels, an arm pair, a top + its diffuser, a hat +
its brim — 30 of the 107 models at the time of writing). Everything that leaves the app for
printing — per-part send, whole build, per-part STL download and the STL zip — goes through
`scripts/print-build.js`, which takes the part's hosted `.stl` if there is one (else the viewer
mesh) and:
- welds it and splits it into connected bodies; exact duplicate triangles (some exports carry a
  surface 2-4x) are dropped and each body's winding made consistent;
- keeps an inside-out shell inside a much bigger body as a cavity, flips other inside-out bodies,
  and attaches open fragments to the body they touch;
- lays a body flat on its flattest big side when it stands on an edge (wheels, arms, face plates);
- spreads the bodies out on the bed: separate named objects in the 3MF sent to slicers
  ("Motion (2/4)"), one spread-out STL for downloads (PrusaSlicer: "Split to objects").
OrcaSlicer also goes through the Prusa upload now, so it receives the split 3MF too.

**Colours.** Every 3MF sent to a slicer carries the customizer colours as filament slots (most-used
colour = slot 1). Each body's main colour sets its object filament; a body painted in several
colours (per-mesh paint) gets the rest as per-triangle MMU painting. Written for PrusaSlicer /
EasyPrint (`Metadata/Slic3r_PE_model.config` extruder + `slic3rpe:mmu_segmentation`, verified by
slicing with PrusaSlicer 2.9.2 CLI, slots 1-5) and for Bambu Studio / OrcaSlicer
(`model_settings.config` + `paint_color`, slot colours in `project_settings.config`; not verified).
The slicer takes the actual filament colours from the user's loaded filaments, so the dialog lists
"Slot N: colour" and object names carry the colour ("Top – Blue"). Single-filament printers ignore
the slots. A part painted in several colours prints from the viewer mesh (a hosted STL can't carry
the paint); otherwise from its hosted STL in the part colour. STL downloads have no colour.
Pieces are skyline-packed onto a 250 × 210 mm (MK4) bed; if they don't fit, the dialog says to use
Arrange or print in batches — command-line/server-side slicing skips pieces off the bed.

**Print whole build** (print icon in the top bar, `printWholeBuild()` in `app.js` +
`scripts/print-build.js`) builds one 3MF in the browser from every visible part (plus the active
mix's `extras`, minus manifest entries marked `print: false` — PCBs, displays, encoders), each split
into its bodies as above and laid out around the MK3/MK4 bed centre. It goes through the same Prusa
upload. Bodies that aren't standing on an edge keep their assembly orientation — rotate any that
print better another way in the slicer.

Viewer meshes are rotated Y-up → Z-up for printing (Model Placer's STL save too); hosted CAD
STLs already are Z-up. `firstExistingUrl()` skips 0-byte files.

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

## Saved Builds

"My builds" (the home button in the top bar) lets people name and save the robot on screen
and come back to it later: load it, rename it, share a link to it, delete it, or update it
after changing it. The top bar shows the loaded build's name, and its save button saves
straight into that build (a dot marks unsaved changes) or asks for a name first. Each saved build has a small thumbnail rendered
from the visible parts.

- **What's saved** is `getShareState()` in `scripts/app.js`, the same data a share link
  carries, plus the active mix key. Loading goes through `applySavedState()` like a share
  link does, then `applyBuildState()` reloads only the parts whose variant changed.
- **Where it's saved** is decided by `scripts/saved-builds.js`, never by `app.js`. Today
  that's always this browser's `localStorage` (`hp_robot_saved_builds`, up to 60 builds of
  a few KB each), so builds stay on one device and one browser.

### Adding sign-in later

The storage module is built so accounts can be added without touching the UI. A
server-backed store only needs the same async methods as `createLocalBuildStore()`:
`list()`, `get(id)`, `put(record)`, `remove(id)`, plus an optional `subscribe(fn)` and
`kind: 'remote'`. After the user signs in, call `setBuildStore(remoteStore)`; on sign-out,
call `setBuildStore(getLocalBuildStore())`. The panel re-renders on its own, and its
footer switches to "Saved to your account".

Records already carry what syncing needs: a client-generated UUID `id` (a build keeps its
identity when uploaded) and `updatedAt` (last write wins when the local and remote copies
differ). On first sign-in, upload the local builds the account doesn't have yet.

For the HP Robots account used by app.hprobots.com (Firebase Authentication, project
`com-moravia-consulting-otto`), the remote store would either:
- call new endpoints on `https://api.app.hprobots.com/v1` with
  `Authorization: Bearer <Firebase ID token>`, the same way the coding app calls its
  `/project` endpoints. The API's CORS currently allows only `https://app.hprobots.com`,
  so the customizer's origin must be added; or
- read and write Firestore under `users/{uid}/builds/{id}`, with security rules limiting
  each user to their own documents.

The Firebase project also needs the customizer's domain in Authentication → Authorized
domains. Firebase keeps sign-in per origin, so on a different domain users sign in once
in each app. Hosting the customizer under `app.hprobots.com/...`, or handing over a
custom token from the coding app, avoids that.

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
