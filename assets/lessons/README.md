# Lessons

Any mix can ship a **lesson** — a showcase mix (geometry in `extras`) or a
normal build like the Starter kit ("Basic"). A floating **"Lesson"** chip then
appears next to the dock on desktop; clicking it drops the customizer into a
3-pane layout:

```
+---------------+-----------------------+
| Python editor |                       |
| app.hprobots  |   this file           |
+---------------+   (right pane, fixed) |
| the 3D model  |                       |
+---------------+-----------------------+
```

The two left panes each collapse to a bar so the other can fill the column.
The 3D pane is the live customizer canvas, resized in place.

## Adding lesson(s) to a mix

1. Drop `<id>.html` here — a **plain HTML fragment** (no `<html>`/`<head>`
   /`<body>`). It's injected as `innerHTML` into the right pane. The first
   `<h1>` becomes the pane title. **Author it with the shared lesson components
   — see [STYLE.md](STYLE.md)** (collapsible `.lesson-section` variants,
   `.lesson-vocab`, `.lesson-challenge`, `.lesson-note`, figures). Vendor any
   images into `img/`, don't hotlink.
2. In `scripts/presets.js`, add a `lessons` array to that mix (next to `codeId`):

   ```js
   lessons: [
     { id: 'cube-ring-chase', title: 'Ring Chase',  code: 'ringchase' },
     { id: 'cube-simon-says',  title: 'Simon Says',  code: 'simonsays' }
   ]
   ```

   - `title` shows on the chip and in the lesson header.
   - `code` (optional) is a filename in `assets/mix-code/` — a **Copy code**
     button in the lesson header copies `assets/mix-code/<code>.py` to the
     clipboard to paste into the editor pane.
   - More than one entry → the chip and the in-lesson header grow `‹ ›` arrows
     (with an `n / total` counter) to page between the lessons.
   - `lessonId: '<id>'` is still accepted as shorthand for a single lesson.

Files are fetched `no-store`, so edits show on a normal reload. A missing file
leaves the chip in place but the pane reads "no content yet".

The editor pane just embeds `app.hprobots.com` (`?type=python` or `?type=word`
per the lesson's `editor` field); if that host refuses framing the pane shows an
"open in a new tab" fallback.

## Styling

`STYLE.md` in this folder is the guide for authoring lesson HTML — the colour
code, every component (collapsible sections, vocabulary, challenge cards, notes,
figures) with copy-paste snippets, and a full skeleton. All the CSS lives in the
`.lesson-scroll` block of `styles/app.css`; the section tint variables sit on
`.lesson-scroll` itself.
