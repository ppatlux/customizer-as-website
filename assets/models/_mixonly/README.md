# Mix-only models

GLBs here are **standalone models for special ready-made mixes** — consoles,
robot arms, anything whose shape doesn't fit a normal part slot. They are:

- listed in `scripts/asset-manifest.js` under the `mixonly:` array (not a part
  category)
- referenced by filename from a preset's `extras: [...]` in `scripts/presets.js`
- shown **as authored** (their own materials — no paint swatch, no visibility
  row, no variant arrows) only while a mix that lists them is active
- included in the GLB / AR export of that build

They never appear in a part category, the variant grid, or the combo count.

## Adding one (Model Placer)

`tools/model-placer.html`:

1. Drop the piece, position it against the starter build (or other reference ghosts).
2. **Export** card → **Category: `mixonly`** → filename → **Save into repo**.
   Writes `assets/models/_mixonly/<file>.glb`, appends the manifest entry, and
   auto-adds it as a reference ghost.
3. Repeat for each piece; add any shared parts (`wheels`, …) as references too.
4. **Ready-made mix** card → key / label / description → **Save mix into
   presets.js**. `mixonly` references become the mix's `extras`; everything else
   becomes a build slot.

## Adding one by hand

```js
// scripts/asset-manifest.js
mixonly: [
  { file: 'Console_Body.glb', folder: '_mixonly', source: '' },
]
```
```js
// scripts/presets.js
console: {
  label: 'Retro Console',
  description: 'Beep boop',
  parts: {},
  visibility: { top: false, hat: false, middle: false, face: false, spacer: false,
                arms: false, bumper: false, bottom: false, wheels: false, tail: false },
  extras: ['Console_Body.glb'],
}
```
