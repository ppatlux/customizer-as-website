// Ready-made "mixes" shown in the Mixes tab. Shared between the app
// (scripts/app.js) and the standalone colour authoring tool
// (tools/mix-colorizer.html) so both work from one definition.
//
// Each part is pinned to a variant by FILENAME, not by its position in
// modelSets. asset-manifest.js gets reordered/inserted into often enough that
// numeric indices silently drift onto the wrong model (or out of range, then
// clamped to the last entry) — which is why saved mixes "sometimes" loaded
// wrong. resolvePresetIndex() in app.js maps the filename back to its current
// index at apply time; an unknown filename falls back to the first variant
// with a console warning rather than a broken or silently-wrong mix.
//
// Presets pin part / variant / visibility only — never colour. Per-mix part
// colours live separately in assets/mix-colors.json (authored by
// tools/mix-colorizer.html) and are applied to the preview thumbnails only.
export const PRESETS = {
  starter: {
    label: 'Basic',
    description: 'from Starter kit',
    parts: {
      top: 'Top-HP-logo.glb', middle: 'Middle-starter.glb', face: 'Face-ultrasonic.glb',
      bottom: 'Bottom-starter.glb', wheels: 'Wheels-starter.glb', hat: 'Hat_Leprechaun.glb',
      arms: 'wings.glb', bumper: 'bumper_oriented.glb'
    },
    visibility: { top: true, middle: true, face: true, bottom: true, wheels: true, hat: false, arms: false, bumper: false, tail: false, spacer: false }
  },
  invent: {
    label: 'Walk & Roll',
    description: 'from Invent expansion',
    parts: {
      top: 'Top-HP-logo.glb', middle: 'Middle-starter.glb', face: 'Face-ultrasonic.glb',
      bottom: 'Bottom-starter.glb', wheels: 'Wheels-Walk-and-Roll.glb', hat: 'Hat_Leprechaun.glb',
      arms: 'Arm-angle.glb', bumper: 'bumper_oriented.glb'
    },
    visibility: { top: true, middle: true, face: true, bottom: true, wheels: true, hat: false, arms: false, bumper: false, tail: false, spacer: false }
  },
  sensor: {
    label: 'Racing Otto',
    description: 'Vroom vroooom',
    parts: {
      top: 'Top_Hats.glb', middle: 'Middle-starter.glb', face: 'Face_Angry.glb',
      bottom: 'Bottom_F1.glb', wheels: 'wheelF1.glb', hat: 'Spoiler_F1.glb',
      arms: 'Arm-angle.glb', bumper: 'bumper_oriented.glb'
    },
    visibility: { top: true, middle: true, face: true, bottom: true, wheels: false, hat: true, arms: false, bumper: false, tail: false, spacer: false }
  },
  showtime: {
    label: 'Duck',
    description: 'Quack!',
    parts: {
      top: 'Top_Duck.glb', middle: 'Middle_NOlogo.glb', face: 'Face_Duck.glb',
      bottom: 'Bottom_Duck.glb', wheels: 'Wheels-starter.glb', hat: 'Hat_Leprechaun.glb',
      arms: 'wings.glb', bumper: 'bumper_oriented.glb'
    },
    visibility: { top: true, middle: true, face: true, bottom: true, wheels: true, hat: false, arms: true, bumper: false, tail: false, spacer: false }
  },
  // Label is deliberately generic — the "Pika"/"Pikachu" strings in the part
  // filenames are internal asset names, but a user-facing preset name would be
  // a Nintendo trademark, so it's "Thunder Mouse" here.
  thunder: {
    label: 'Thunder Mouse',
    description: 'Zap!',
    parts: {
      top: 'Top_Hats.glb', middle: 'Middle-starter.glb', face: 'Face_Pika.glb',
      bottom: 'Bottom_Pikachu.glb', wheels: 'Wheels-starter.glb', hat: 'Hat_Pika ears.glb',
      arms: 'Arm-angle.glb', bumper: 'bumper_oriented.glb'
    },
    visibility: { top: true, middle: true, face: true, bottom: true, wheels: true, hat: true, arms: false, bumper: false, tail: false, spacer: false }
  },
  boat: {
    label: 'Viking Boat',
    description: 'Row row row',
    parts: {
      top: 'Top-HP-logo.glb', middle: 'Middle_Boat.glb', face: 'Face_Angry.glb',
      bottom: 'Bottom_Boat.glb', wheels: 'Wheels-starter.glb', hat: 'Hat_Leprechaun.glb',
      arms: 'Arm-angle.glb', bumper: 'bumper_oriented.glb'
    },
    visibility: { top: true, middle: true, face: true, bottom: true, wheels: false, hat: false, arms: false, bumper: false, tail: false, spacer: false }
  }
};

// Normalises one part entry of assets/mix-colors.json to a consistent
// { color, meshes } shape. An entry may be:
//   - a bare "#hex" string           -> whole-part colour
//   - { color?: "#hex", meshes?: { "<meshIndex>": "#hex" } }
// meshIndex is the part's mesh position in gltf.scene.traverse() order — the
// same counter loadModel()/renderPresetThumbnail() in app.js and the colour
// tool all walk, so an index authored in the tool lines up in the app.
export function normalizeMixPartColor(entry) {
  if (typeof entry === 'string') return { color: entry, meshes: {} };
  if (entry && typeof entry === 'object') return { color: entry.color || null, meshes: entry.meshes || {} };
  return { color: null, meshes: {} };
}
