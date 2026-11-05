# HP Robots Customizer

A browser app for designing your own HP Robots Otto robot: pick a variant for each part, paint it,
save and share the result, and send it straight to a 3D-printing slicer. It's a static site — plain
HTML, CSS and JavaScript with Three.js — so it needs no build step and no backend of its own.

## What it does

- **Build a robot.** The robot is made of stacked parts (top, middle, face, bottom, motion, hat,
  arms, spacer, bumper). Each part has several variants; flip through them, open the grid of all
  variants, or randomize the whole robot.
- **Ready-made mixes.** Curated combinations to start from. Some mixes add extra pieces such as
  circuit boards or displays that are only shown with that mix.
- **Paint.** Colour whole parts, or paint any single piece of a part.
- **Compatibility warnings.** Parts that physically clash get a red badge, and clicking it highlights
  the overlap. Combinations that can't be attached at all are prevented automatically.
- **My builds.** Save, name, rename and reload builds. They're stored in this browser for now.
- **Share.** Copy a link or QR code that opens the exact same build.
- **View in AR** on a phone.
- **Print.** Send one part or the whole build to PrusaSlicer, OrcaSlicer or EasyPrint (phones and
  tablets always use EasyPrint). The app splits each part into its separately printed pieces, lays
  them flat on the bed and passes the chosen colours along as filament slots.
- **Download** parts as STL, GLB or STEP.
- **Engraving tool** (`engrave.html`): add text or a shape to a part and download it as an STL.

## Project layout

| Path | What's there |
| --- | --- |
| `index.html`, `styles/app.css`, `scripts/app.js` | The customizer itself |
| `scripts/asset-manifest.js` | The list of every part variant and its model file |
| `scripts/presets.js` | The ready-made mixes |
| `scripts/saved-builds.js` | Storage for "My builds" |
| `scripts/print-build.js` | Prepares parts for printing (splitting, laying flat, colours, 3MF) |
| `scripts/prusa-export.js`, `scripts/slicer-preference.js` | Sending files to a slicer |
| `engrave.html`, `scripts/engrave.js`, `styles/engrave.css` | The engraving tool |
| `assets/models/<part>/` | Model files, one folder per part (`motion/` holds the wheels) |
| `assets/compatibility.json` | Which part pairs clash (written by the compatibility checker) |
| `assets/mix-colors.json` | Colours used for the mix thumbnails |
| `tools/compat-checker.html` | Internal tool for finding and confirming clashing part pairs |
| `tools/model-placer.html` | Tool for positioning a new 3D model against the robot and saving it as a customizer part |

## Adding a model

1. Put the viewer model at `assets/models/<part>/<Name>.glb`.
2. Optionally add `<Name>.stl` (used for printing and STL download instead of the viewer mesh),
   `<Name>.step` and `<Name>.3mf` next to it, with the same name.
3. Add an entry for it to `scripts/asset-manifest.js`.
4. Run the compatibility checker to see whether it clashes with other parts.

## Model Placer

`tools/model-placer.html` turns a 3D file into a part the customizer can use.

1. Start the local server (see below) and open <http://localhost:8000/tools/model-placer.html>
   in Chrome or Edge.
2. Drop in a `.step`, `.stp`, `.iges`, `.stl`, `.3mf`, `.obj` or `.glb` file.
3. Under **Reference parts**, load the starter build or any existing variant. They show as
   see-through ghosts, so you can line the new model up against the real robot.
4. Position it with the on-model arrows, the number fields or the quick-align buttons.
5. Pick its **Category** (top, hat, face...) and a file name, then either:
   - **Connect repo folder** and **Save into repo**: writes `assets/models/<part>/<name>.glb`,
   adds it to `scripts/asset-manifest.js` and saves a `.placement.json` next to it so the
   placement can be edited again later (Chrome/Edge only), or
   - download the `.glb` and add it by hand (see "Adding a model").
6. Reload the customizer: the new variant appears under its part.

Models are in millimetres, Y-up, without the customizer's 30 mm lift; the tool takes care of
this as long as the model is lined up against the reference parts. The **Ready-made mix** card
saves the reference parts on screen as a new mix in `scripts/presets.js`.

## Running locally

The app has to be served over HTTP (browsers block loading models from `file://`):

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>.

## Deploying

Copy the folder to any static web host. On Apache, `.htaccess` blocks other sites from embedding
the app in a frame, makes browsers check for new versions of the code, and compresses model files.
Bump the `?v=` number on `app.js` / `app.css` in `index.html` when you deploy.
