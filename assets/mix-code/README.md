# Per-mix code (showcase mixes)

A showcase mix (all parts hidden, geometry in `extras`) can show a **"Code for
this mix"** panel under the ready-made-mix carousel — a Python listing with a
Copy button.

## Adding code to a mix

1. Drop `<codeId>.py` here (plain Python).
2. In `scripts/presets.js`, add `codeId: '<codeId>'` to that mix:

   ```js
   console: {
     label: 'Retro Console',
     // …
     extras: ['Console_Body.glb'],
     codeId: 'console'
   }
   ```

The panel only appears for showcase mixes. A missing `<codeId>.py` just hides
it. Files are fetched `no-store`, so edits show on a normal reload.

`console.py` is a PLACEHOLDER pending the real code.
