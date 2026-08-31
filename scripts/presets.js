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
    label: 'Emote + Sense/Interact',
    description: 'Hello World!',
    parts: {
      top: 'Top_sensor-duo.glb', middle: 'Middle-starter.glb', face: 'FaceUSOLED.glb',
      bottom: 'Bottom-starter.glb', wheels: 'Wheels-starter.glb',
      spacer: 'Spacer_Empty.glb', bumper: 'bumper_oriented.glb'
    },
    visibility: { top: true, middle: true, face: true, bottom: true, wheels: true, hat: false, arms: false, bumper: true, tail: false, spacer: true }
  },
  bricks: {
    label: 'Bricks',
    description: 'Click!',
    parts: {
      top: 'Top_Hats.glb', middle: 'Middle_Firefighter.glb', face: 'Face_Mustache.glb',
      bottom: 'Bottom_Bricks.glb', wheels: 'Wheels-starter.glb', hat: 'Hat_Bricks.glb',
      arms: 'Arm-angle.glb', bumper: 'bumper_oriented.glb'
    },
    visibility: { top: true, middle: true, face: true, bottom: true, wheels: true, hat: true, arms: false, bumper: false, tail: false, spacer: false }
  },
  duck: {
    label: 'Duck',
    description: 'Quack!',
    parts: {
      top: 'Top_Duck.glb', middle: 'Middle_NOlogo.glb', face: 'Face_Duck.glb',
      bottom: 'Bottom_Duck.glb', wheels: 'Wheels-starter.glb',
      arms: 'wings.glb'
    },
    visibility: { top: true, middle: true, face: true, bottom: true, wheels: true, hat: false, arms: true, bumper: false, tail: false, spacer: false }
  },
  thunder: {
    label: 'Thunder Mouse',
    description: 'Zap!',
    parts: {
      top: 'Top_Hats.glb', middle: 'Middle-starter.glb', face: 'Face_Pika.glb',
      bottom: 'Bottom_Pika.glb', wheels: 'Wheels-starter.glb', hat: 'Hat_Pika ears.glb',
      arms: 'Arm-angle.glb', 
    },
    visibility: { top: true, middle: true, face: true, bottom: true, wheels: true, hat: true, arms: false, bumper: false, tail: false, spacer: false }
  },
  race: {
    label: 'Racing ',
    description: 'Vroom vroooom',
    parts: {
      top: 'Top_lightsdiffuser.glb', middle: 'Middle-starter.glb', face: 'Face_Eyebrows.glb',
      bottom: 'Bottom-starter.glb', wheels: 'Wheel_Race.glb', hat: 'Hat_Race.glb', bumper: 'Bumper_Race.glb'
    },
    visibility: { top: true, middle: true, face: true, bottom: true, wheels: true, hat: true, arms: false, bumper: true, tail: false, spacer: false }
  },
  fast: {
    label: 'Fast & Otto',
    description: 'for family fun',
    parts: {
      top: 'Top_Race.glb', middle: 'Middle-starter.glb', face: 'Face_Angry.glb',
      bottom: 'Bottom_Race.glb', 
      arms: 'Arm-angle.glb', bumper: 'bumper_oriented.glb'
    },
    visibility: { top: true, middle: true, face: true, bottom: true, wheels: false, hat: false, arms: false, bumper: false, tail: false, spacer: false }
  },
  santa: {
    label: 'Merry Christmas',
    description: 'Merry Christmas and a Happy New Otto',
    parts: {
      top: 'Top_Hats.glb', middle: 'Middle_NOlogo.glb', face: 'FaceSanta.glb',
      bottom: 'Bottom-starter.glb', wheels: 'Wheels-starter.glb', hat: 'Hat_Santa.glb',
    },
    visibility: { top: true, middle: true, face: true, bottom: true, wheels: true, hat: true, arms: false, bumper: false, tail: false, spacer: false }
  },
  boat: {
    label: 'Boat',
    description: 'Row row row',
    parts: {
      top: 'Top_Hats.glb', middle: 'Middle_Boat.glb', face: 'Face_Angry.glb',
      bottom: 'Bottom_Boat.glb', hat: 'Hat_Viking.glb',
    },
    visibility: { top: true, middle: true, face: true, bottom: true, wheels: false, hat: true, arms: false, bumper: false, tail: false, spacer: false }
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
