# Lesson content — styling guide

Every `assets/lessons/<id>.html` is a **plain HTML fragment** (no `<html>` /
`<head>` / `<body>`). `app.js` fetches it and injects it as `innerHTML` into the
right pane of lesson mode (`.lesson-scroll`). The first `<h1>` becomes the pane
title. All the styling below lives in the `.lesson-scroll` block of
`styles/app.css` — author lessons with these classes so every lesson looks the
same.

Keep a lesson to **one `<h1>`**, then a short lead `<p>` (it gets a slightly
larger lead style automatically), then the sections.

---

## Colour — used sparingly

Sections, vocabulary and plain tips are **neutral grey**. Colour is reserved for
the few things that need to stand out:

| Meaning | Class | Colour |
|---|---|---|
| A task for the student | `lesson-challenge` | blue |
| Caution (⚠️) | `lesson-note lesson-note--warn` | amber |
| "All done" (✅) | `lesson-note lesson-note--done` | green |

Don't add more colours or per-section tints — keep the page calm.

---

## Sections (collapsible)

Wrap each top-level section in a `<details class="lesson-section" open>`.
`open` = expanded on load; drop it to start collapsed. `<summary>` is the
header bar; put the body in a `.lesson-section-body` div.

```html
<details class="lesson-section" open>
  <summary>Materials required</summary>
  <div class="lesson-section-body">
    <ul>…</ul>
  </div>
</details>
```

### Numbered test section

Same section, with a number badge in the summary.

```html
<details class="lesson-section" open>
  <summary><span class="lesson-test-num">1</span>Test #1: Circuit board &amp; Buzzer</summary>
  <div class="lesson-section-body">
    …
  </div>
</details>
```

---

## Vocabulary

A nested collapsible glossary (neutral grey) — put it near the top of a
section. Starts **collapsed** (no `open`).

```html
<details class="lesson-vocab">
  <summary>Vocabulary</summary>
  <dl>
    <dt>Term</dt>
    <dd>Definition.</dd>
    <dt>Another term</dt>
    <dd>Definition.</dd>
  </dl>
</details>
```

---

## Challenge

A blue card for a task the student has to do. Heading text is always
`Challenge`; the 🎯 is added by CSS. Figures placed inside pick up the blue
frame.

```html
<div class="lesson-challenge">
  <h3>Challenge</h3>
  <p><strong>Do this…</strong></p>
  <figure><img src="assets/lessons/img/solution.png" alt="…"></figure>
</div>
```

---

## Teacher notes

One-line callouts. Lead with the emoji.

```html
<p class="lesson-note">💡 A tip for teaching this bit.</p>
<p class="lesson-note lesson-note--warn">⚠️ Something to watch out for.</p>
<p class="lesson-note lesson-note--done">✅ All done — optional extension…</p>
```

---

## Figures

Images are **vendored** in `assets/lessons/img/` (download them, don't hotlink).
`src` is relative to the site root: `assets/lessons/img/<file>`.

```html
<!-- single -->
<figure>
  <img src="assets/lessons/img/thing.png" alt="what it shows">
  <figcaption>Optional caption.</figcaption>
</figure>

<!-- full-bleed (wide diagram) -->
<figure class="figure--wide">
  <img src="assets/lessons/img/wiring-diagram.png" alt="…">
</figure>

<!-- side-by-side row -->
<div class="figure-row">
  <figure><img src="…" alt="…"><figcaption>…</figcaption></figure>
  <figure><img src="…" alt="…"><figcaption>…</figcaption></figure>
</div>
```

---

## Inline elements

| Want | Markup |
|---|---|
| Eyebrow above the title | `<span class="eyebrow">Kit / course name</span>` (before the `<h1>`) |
| Sub-heading in a section | `<h2>`, `<h3>`, `<h4>` (styled, no class needed) |
| Bulleted / numbered list | `<ul>` / `<ol>` |
| Inline code / a block name | `<code class="inline">set ring colour</code>` |
| Code / pseudo-code block | `<pre>…<span class="cmt"># comment</span></pre>` |
| Pin / connector table | `<table class="pins"><thead>…</thead><tbody>…</tbody></table>` |
| Meta chips under the title | `<div class="chip-row"><span class="chip">⏱ 45 min</span>…</div>` |
| Small label before a step | `<span class="step-tag">STEP 1</span>` (inline, brand-yellow pill) |
| External link | plain `<a href="https://…" target="_blank" rel="noopener">` |
| Jump link within the lesson | `<a href="#wiring">` → targets any element with `id="wiring"`; if it's a `<details>` it auto-expands before scrolling |

`.callout` / `.callout--do` also exist (older amber / green boxes, used by the
Python lessons). For new lessons prefer `.lesson-challenge` and `.lesson-note`
instead — don't mix both systems in one lesson.

---

## Editor pane

Set per lesson in `scripts/presets.js`:

```js
lessons: [
  { id: 'my-lesson', title: 'My Lesson', editor: 'word' },   // block editor
  { id: 'other',     title: 'Other',     editor: 'python', code: 'other' }  // text editor + Copy-code button
]
```

`editor: 'word'` → no `code` (block projects have nothing to paste).

---

## Skeleton

```html
<span class="eyebrow">Kit / course name</span>
<h1>Lesson Title</h1>
<p>One-paragraph intro.</p>

<details class="lesson-section" open>
  <summary>Materials required</summary>
  <div class="lesson-section-body"> … </div>
</details>

<details class="lesson-section" open>
  <summary><span class="lesson-test-num">1</span>Test #1: …</summary>
  <div class="lesson-section-body">
    <p>…</p>
    <details class="lesson-vocab"><summary>Vocabulary</summary><dl>…</dl></details>
    <figure><img src="assets/lessons/img/…" alt="…"></figure>
    <div class="lesson-challenge"><h3>Challenge</h3><p>…</p></div>
  </div>
</details>

<p class="lesson-note lesson-note--done">✅ …</p>

<details class="lesson-section" open>
  <summary>Lesson Evaluation</summary>
  <div class="lesson-section-body"><ul>…</ul></div>
</details>
```
