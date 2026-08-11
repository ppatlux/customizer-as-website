/**
 * Shortcode: [hp_robot_customizer]
 * Complete, modern, glass UI for Three.js robot customizer
 * Version: 1.0.4
 * Notes:
 * - Adds sign-in promo overlay for logged-out users
 * - Blocks download/print for logged-out users with CTA + state save
 * - Persists customizer state in localStorage and restores after login
 */
 add_shortcode('hp_robot_customizer', function () {
  ob_start();
  ?>
  <!-- rest of your code stays exactly the same -->


  <!-- HP Robot Customizer Viewer (Full Build) -->
  <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">

  <style>
/* ==========================================================================
   Global Design Tokens (Light & Dark), Glass UI, and Utilities
   ========================================================================== */

/* Root tokens — tweak brand to your hex if you like */
:root{
  --brand: #0A84FF;              /* Accent color (Apple blue-like) */
  --brand-ink: #005ec4;          /* Deeper brand for pressed states */
  --brand-ghost: color-mix(in srgb, var(--brand) 12%, transparent);

  --text: #111316;               /* Primary text on light */
  --muted: rgba(17,19,22,0.62);  /* Secondary text on light */

  --bg-start: #FFFFFF;
  --bg-end:   #FFFFFF;        /* Background gradient bottom */

  --glass-bg: #FFFFFF;
  --glass-hover: #F6F7F9;
  --glass-strong: #FFFFFF;
  --glass-press: #EDF1F5;

  --stroke: rgba(0,0,0,0.08);
  --stroke-strong: rgba(0,0,0,0.12);

  --blur: 0px;
  --radius: 14px;
  --radius-lg: 16px;
  --radius-xl: 18px;

  --shadow-xs: 0 1px 2px rgba(0,0,0,0.06);
  --shadow-sm: 0 4px 12px rgba(0,0,0,0.10);
  --shadow: 0 8px 24px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06);
  --shadow-lg: 0 18px 50px rgba(0,0,0,0.16), 0 6px 16px rgba(0,0,0,0.08);

  --transition: 180ms cubic-bezier(.2,.8,.2,1);
  --transition-fast: 120ms cubic-bezier(.2,.8,.2,1);
  --transition-slow: 260ms cubic-bezier(.2,.8,.2,1);

  --focus-ring: 0 0 0 2px color-mix(in srgb, var(--brand) 64%, white),
                 0 0 0 6px color-mix(in srgb, var(--brand) 18%, transparent);

  --ok: #15C66D;
  --warn: #FFB02E;
  --err: #E5484D;

  --z-toolbar: 60;
  --z-panels: 55;
  --z-toasts: 7000;
  --z-floating: 10000;           /* Palettes, dropdowns */
  --z-max: 2147483647;           /* Safety cap if needed */
}


/* CSS Reset-ish essentials */
*{ box-sizing: border-box; }
html, body { height: 100%; }
body{
  margin: 0;
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, Roboto, Segoe UI, system-ui, Arial, sans-serif;
  background: #FFFFFF;
}

/* Utilities (used in a few places) */
.u-hidden{ display: none !important; }
.u-flex{ display:flex; }
.u-center{ display:flex; align-items:center; justify-content:center; }
.u-abs{ position:absolute; }
.u-fixed{ position:fixed; }
.u-w-100{ width:100%; }
.u-h-100{ height:100%; }
.u-radius{ border-radius: var(--radius); }
.u-radius-lg{ border-radius: var(--radius-lg); }
.u-radius-xl{ border-radius: var(--radius-xl); }
.u-glass{
  background: var(--glass-bg);
  -webkit-backdrop-filter: blur(var(--blur)) saturate(140%);
  backdrop-filter: blur(var(--blur)) saturate(140%);
  border: 1px solid var(--stroke);
}

/* ==========================================================================
   Viewer Container (hosts WebGL canvas + UI layers)
   ========================================================================== */

#viewer-container{
  width: 100%;
  height: var(--viewer-h, 85vh); /* uses dvh/svh if available (set below) */
  min-height: 320px;             /* guard on very short viewports */
  position: relative;
  overflow: visible;
  background: #FFFFFF;
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow);
  isolation: isolate;
}


/* Three.js canvas will be appended inside #viewer-container by script */

/* ==========================================================================
   Toolbar (bottom-left): info, fullscreen, reset, randomize, downloads
   ========================================================================== */

#info-container{
  position: absolute;
  bottom: calc(14px + env(safe-area-inset-bottom, 0px));
  z-index: var(--z-toolbar);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  background: var(--glass-bg);
  -webkit-backdrop-filter: blur(var(--blur)) saturate(140%);
  backdrop-filter: blur(var(--blur)) saturate(140%);
  border: 1px solid var(--stroke);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  transition: background var(--transition), transform var(--transition);
}

/* Material Icons consistent baseline + center */
.material-icons{
  font-variation-settings: 'wght' 500;
  font-size: 20px;
  line-height: 1;
  display: block;          /* prevent inline baseline wiggle */
  pointer-events: none;    /* clicks go to button */
}

/* Info tooltip bubble */
#info-tooltip{
  display: none;
  position: absolute;
  bottom: calc(100% + 10px);
  left: 8px;
  background: var(--glass-strong);
  color: var(--text);
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--stroke-strong);
  box-shadow: var(--shadow);
  font-size: 12px;
  white-space: nowrap;
  z-index: var(--z-floating);
  animation: fadePop var(--transition-fast) ease-out both;
}
#info-tooltip a{ color: var(--brand); text-decoration: none; }
#info-tooltip a:hover{ text-decoration: underline; }

/* Action group container (fullscreen, reset, randomize, download) */
#action-buttons{ display: flex; align-items: center; gap: 10px; }

/* Download segmented control (primary left + toggle right) */
#download-group{
  display: flex; position: relative;
  width: 96px; height: 40px;
  border-radius: 12px;
  overflow: visible;
  border: 1px solid var(--stroke);
  background: var(--glass-bg);
  -webkit-backdrop-filter: blur(var(--blur));
  backdrop-filter: blur(var(--blur));
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.04);
  user-select: none;
}

#download-primary, #download-toggle{
  border: none; outline: none;
  background: transparent; cursor: pointer;
  transition: background var(--transition);
}
#download-primary{ flex: 1; }
#download-toggle{ width: 40px; border-left: 1px solid var(--stroke); }
#download-group:hover :where(#download-primary,#download-toggle){ background: var(--glass-hover); }

/* Download dropdown menu */
#download-menu{
  display: none;
  position: absolute;
  bottom: calc(100% + 10px);
  right: 0;
  background: var(--glass-strong);
  border: 1px solid var(--stroke-strong);
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  animation: menuPop var(--transition-fast) ease-out both;
  min-width: 200px;
  z-index: var(--z-floating);
}
#download-menu button{
  width: 100%;
  padding: 10px 12px;
  background: transparent;
  border: none;
  text-align: left;
  cursor: pointer;
  font-size: 13px;
  color: var(--text);
  transition: background var(--transition);
}
#download-menu button:hover{ background: var(--glass-hover); }

.color-palette,
#download-menu {
  z-index: var(--z-max);
  pointer-events: auto;
}

#info-container {
  z-index: calc(var(--z-max) - 1);
}


/* ---- Unified buttons ---- */
.btn{
  display:flex; align-items:center; justify-content:center;
  cursor:pointer; user-select:none;
  border:1px solid var(--stroke);
  background: var(--glass-bg);
  border-radius: 12px;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06);
  transition: transform var(--transition), background var(--transition), box-shadow var(--transition);
}
.btn:hover{ background: var(--glass-hover); transform: translateY(-1px); }
.btn:active{ transform: translateY(0); background: var(--glass-press); }

/* sizes */
.btn--lg{ width:40px; height:40px; }        /* toolbar + download split */
.btn--sm{ width:32px; height:32px; border-radius:10px; } /* arrows, visibility, print */

/* variant: ghost (starts transparent like your part buttons) */
.btn--ghost{ background: transparent; }
.btn--ghost:hover{ background: var(--glass-hover); }
.btn--ghost:active{ background: var(--glass-press); }



/* ==========================================================================
   Preset Menu (top-left): quick configurations
   ========================================================================== */

#preset-menu{
  position: absolute;
  top: calc(16px + env(safe-area-inset-top, 0px));
  left: 16px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  z-index: var(--z-toolbar);
  transform: none;
}

.preset-toggle{
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  min-width: 200px;
  background: var(--glass-bg);
  border: 1px solid var(--stroke);
  border-radius: var(--radius-lg);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.04), var(--shadow-sm);
  color: var(--text);
  font: 600 13px/1 -apple-system, BlinkMacSystemFont, Inter, system-ui;
  cursor: pointer;
  transition: background var(--transition), transform var(--transition), box-shadow var(--transition);
}

.preset-toggle:hover{
  background: var(--glass-hover);
  transform: translateY(-1px);
}

.preset-toggle:active{
  background: var(--glass-press);
  transform: translateY(0);
}

.preset-toggle .material-icons{
  pointer-events: none;
}

.preset-toggle .caret{
  margin-left: auto;
  font-size: 18px;
}

.preset-label{
  flex: 1;
  text-align: left;
}

.preset-options{
  display: none;
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  min-width: 220px;
  background: var(--glass-strong);
  border: 1px solid var(--stroke-strong);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  padding: 6px;
  backdrop-filter: blur(var(--blur));
  -webkit-backdrop-filter: blur(var(--blur));
  z-index: var(--z-floating);
}

#preset-menu.open .preset-options{
  display: block;
}

.preset-option{
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  padding: 10px;
  background: transparent;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  color: var(--text);
  transition: background var(--transition), transform var(--transition), box-shadow var(--transition);
  text-align: left;
}

.preset-option:hover{
  background: var(--glass-hover);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06);
  transform: translateY(-1px);
}

.preset-option.active{
  background: linear-gradient(180deg, var(--brand), color-mix(in srgb, var(--brand) 82%, black));
  color: white;
  box-shadow: 0 8px 18px color-mix(in srgb, var(--brand) 38%, transparent);
}

.preset-option .option-title{
  font: 600 12px/1 -apple-system, BlinkMacSystemFont, Inter, system-ui;
  letter-spacing: .05em;
  text-transform: uppercase;
}

.preset-option .option-desc{
  font: 500 11px/1.3 -apple-system, BlinkMacSystemFont, Inter, system-ui;
  color: var(--muted);
}

.preset-option.active .option-desc{
  color: color-mix(in srgb, white 86%, transparent);
}

@media (max-width: 900px){
  #preset-menu{
    left: 50%;
    transform: translateX(-50%);
  }
}

@media (max-width: 520px){
  .preset-toggle{
    min-width: 180px;
  }
}

/* ==========================================================================
   Toggle Bar (right side): ESSENTIAL / ADVANCED segmented control
   ========================================================================== */

#controls-toggle{
  position: absolute;
  top: calc(17% + env(safe-area-inset-top, 0px));
  right: 14px;
  transform: translateY(-50%);
  display: inline-flex;
  gap: 0;
  z-index: var(--z-toolbar);
  padding: 6px;
  background: white;
  border: 1px solid var(--stroke);
  border-radius: 10px;
  box-shadow: var(--shadow-sm);
}
.toggle-btn{
  padding: 8px 16px;
  background: transparent;
  border: none; cursor: pointer;
  font: 600 12px/1 -apple-system, BlinkMacSystemFont, Inter, system-ui;
  color: var(--muted);
  border-radius: 999px;
  transition: background var(--transition), color var(--transition), transform var(--transition);
}
.toggle-btn:hover{ background: var(--glass-hover); color: var(--text); }
.toggle-btn.active{
  background: linear-gradient(180deg, var(--brand), color-mix(in srgb, var(--brand) 88%, black));
  color: white;
  box-shadow: 0 6px 16px color-mix(in srgb, var(--brand) 45%, transparent);
  transform: translateY(-1px);
}


/* ==========================================================================
   Part Panels (right column): sections per part with color/visibility/print
   ========================================================================== */

.model-controls{
  position: absolute;
  top: calc(17% + 56px);
  right: 14px;
  display: none;
  flex-direction: column;
  gap: 8px;
  background: var(--glass-bg);
  -webkit-backdrop-filter: blur(var(--blur)) saturate(140%);
  backdrop-filter: blur(var(--blur)) saturate(140%);
  padding: 10px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--stroke);
  box-shadow: var(--shadow);
  width: 260px;                 /* a bit wider for comfort */
  max-height: calc(85vh - 140px);
  overflow: visible;            /* palette floats outside anyway */
  z-index: var(--z-panels);
  animation: fadeSlide var(--transition) ease-out both;
}

.model-controls.essential{ display: flex; }
.model-controls.advanced { display: none; }

.model-section{
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: #FFFFFF;
  -webkit-backdrop-filter: blur(1px); backdrop-filter: blur(1px);
  padding: 8px;
  border-radius: 12px;
  border: 1px solid var(--stroke);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.35);
  transition: transform var(--transition), box-shadow var(--transition);
}
.model-section:hover{ transform: translateY(-1px); box-shadow: var(--shadow-sm); }

.model-controls h4{
  margin: 0 0 6px;
  font: 700 13px/1 -apple-system, BlinkMacSystemFont, Inter, system-ui;
  text-transform: uppercase;
  letter-spacing: .08em;
  color: var(--muted);
}
.model-controls-row{ display: flex; align-items: center; gap: 6px; }

.model-label{
  flex: 1;
  text-align: center;
  font: 700 12px/1 -apple-system, BlinkMacSystemFont, Inter, system-ui;
  text-transform: uppercase; letter-spacing: .12em;
  user-select: none;
  color: var(--text);
}

/* Pill row: color swatch + visibility + print */
.pill-container{
  display: flex; align-items: center; gap: 8px; align-self: center;
}

/* ⬆️ Taller, easier to hit */
.color-pill{
  width: 76px;
  height: 12px;                /* was 6px */
  border-radius: 999px;
  cursor: pointer;
  border: 1px solid var(--stroke);
  background: linear-gradient(90deg, #fff8, #fff0), var(--pill-color, #d9d9d9);
  position: relative; overflow: hidden;
  transition: transform var(--transition), box-shadow var(--transition);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.40);
}
@media (pointer: coarse){
  .btn--sm{ width: 40px; height: 40px; border-radius: 12px; }
  #download-group{ height: 44px; }
  .toggle-btn{ padding: 10px 18px; }
}

/* keep your sheen effect looking good on the taller pill */
.color-pill::after{
  content:""; position:absolute; inset:-50% -20% auto auto;
  width: 60%; height: 240%;     /* was 200%, keeps specular line pleasant */
  transform: rotate(25deg) translateX(120%);
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent);
  pointer-events:none;
}
.color-pill:hover{ transform: translateY(-1px); }
.color-pill:hover::after{ animation: sheen 900ms ease-out; }



/* ==========================================================================
   Color Palette Popup (now floating on viewport; never clipped)
   ========================================================================== */

.color-palette{
  /* default (when closed) — we still render in DOM but hide */
  display: none;
  position: absolute; /* when closed, position is irrelevant */
  top: calc(100% + 8px); left: 50%;
  transform: translateX(-50%);
  background: var(--glass-strong);
  border: 1px solid var(--stroke-strong);
  border-radius: 12px;
  padding: 8px;
  gap: 6px;
  box-shadow: var(--shadow-lg);
  z-index: var(--z-floating);
  animation: menuPop var(--transition-fast) ease-out both;
}
.color-palette.open{
  /* when opened, we switch to fixed and set coords via JS */
  display: grid !important;
  grid-template-columns: repeat(4, 24px);
  gap: 10px;
}

.color-swatch{
  width: 24px; height: 24px; border-radius: 50%; border: 1px solid var(--stroke);
  cursor: pointer; transition: transform var(--transition), box-shadow var(--transition);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.35);
}
.color-swatch.white{ border: 1px solid #0008; }
.color-swatch:hover{ transform: translateY(-1px); box-shadow: var(--shadow-xs); }


/* ==========================================================================
   Toaster (top-center) for quick messages, success/errors
   ========================================================================== */

.toast-stack{
  position: absolute;
  top: calc(12px + env(safe-area-inset-top, 0px));
  left: 50%; transform: translateX(-50%);
  z-index: var(--z-toasts);
  display: flex; flex-direction: column; gap: 8px;
  pointer-events: none;
}

.toast{
  min-width: 240px; max-width: 60vw;
  padding: 10px 12px;
  background: var(--glass-strong);
  border: 1px solid var(--stroke-strong);
  border-radius: 12px;
  box-shadow: var(--shadow);
  color: var(--text);
  font-size: 13px;
  display: flex; align-items: center; gap: 8px;
  pointer-events: auto;
  animation: fadePop var(--transition-fast) ease-out both;
}
.toast.ok{ border-left: 3px solid var(--ok); }
.toast.warn{ border-left: 3px solid var(--warn); }
.toast.err{ border-left: 3px solid var(--err); }

/* ==========================================================================
   Skeleton loader for first paint (optional visual polish)
   ========================================================================== */

#skeleton{
  position: absolute; inset: 0; z-index: 10;
  pointer-events: none;
  background:
    linear-gradient(90deg, rgba(255,255,255,0.08), rgba(255,255,255,0.18), rgba(255,255,255,0.08));
  animation: shimmer 1600ms infinite linear;
  opacity: .8;
  border-radius: var(--radius-xl);
}
@keyframes shimmer{
  0%{ background-position: -200% 0; }
  100%{ background-position: 200% 0; }
}

:where(.btn, .toggle-btn, #download-primary, #download-toggle, #download-menu button){ outline: none; }
:where(.btn, .toggle-btn, #download-primary, #download-toggle, #download-menu button):focus-visible{ box-shadow: var(--focus-ring); }


/* ==========================================================================
   Responsive: keep panels visible & scrollable on smaller screens
   ========================================================================== */

@media (max-width: 640px){
  .model-controls{
    left: 12px;
    right: 12px;
    width: auto;
    top: auto;
    bottom: calc(12px + env(safe-area-inset-bottom, 0px));
    max-height: min(50dvh, 60svh, 480px);
    overflow: auto;                 /* internal scroll */
    padding-bottom: 10px;           /* a little breathing room above home bar */
  }
}
@media (max-width: 1024px), (max-height: 720px){
  #controls-toggle{
    top: calc(12px + env(safe-area-inset-top, 0px));
  }
  .model-controls{
    top: 56px; right: 12px; bottom: 12px;
    width: min(44vw, 320px);
    overflow: auto;             /* safe scrolling inside panel */
    max-height: none;
  }
}
@media (max-width: 640px){
  #info-container{
    top: calc(12px + env(safe-area-inset-top, 0px));
    left: 12px;
    bottom: auto;
  }
}

/* ==========================================================================
   Keyframe Animations
   ========================================================================== */

@keyframes fadeSlide{
  from{ opacity: 0; transform: translateY(6px); }
  to  { opacity: 1; transform: translateY(0); }
}
@keyframes fadePop{
  from{ opacity: 0; transform: translateY(6px) scale(.98); }
  to  { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes menuPop{
  from{ opacity: 0; transform: translateY(6px) scale(.98); }
  to  { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes sheen{
  from{ transform: rotate(25deg) translateX(120%); }
  to  { transform: rotate(25deg) translateX(-220%); }
}

/* Reduced motion preference */
@media (prefers-reduced-motion: reduce){
  *{ animation: none !important; transition: none !important; }
}
.color-palette,
#download-menu {
  z-index: var(--z-max);
  pointer-events: auto;
}

#info-container {
  z-index: calc(var(--z-max) - 1);
}
.color-palette.open{
  display: grid !important;
  grid-template-columns: repeat(4, 24px);
  gap: 10px;
}

/* ================================
   Guided tour (glass tooltip + ring)
   ================================ */
.tour-tip{
  position: fixed;
  max-width: 320px;
  background: var(--glass-strong);
  -webkit-backdrop-filter: blur(var(--blur)) saturate(140%);
  backdrop-filter: blur(var(--blur)) saturate(140%);
  border: 1px solid var(--stroke-strong);
  border-radius: 14px;
  padding: 12px;
  box-shadow: var(--shadow-lg);
  z-index: var(--z-max);
}
.tour-tip h5{
  margin: 0 0 6px;
  font: 700 13px/1 -apple-system, BlinkMacSystemFont, Inter, system-ui;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--muted);
}
.tour-body{ font: 500 13px/1.35 -apple-system, BlinkMacSystemFont, Inter, system-ui; }
.tour-actions{
  display:flex;
  flex-direction: column;  /* stack rows */
  gap:6px;
  margin-top:10px;
}
.tour-row{ display:flex; gap:6px; align-items:center; }
.tour-row .tour-spacer{ flex:1; }  /* pushes Back/Next to the right */

.tour-meta{
  display:flex;
  gap:6px;
  align-items:center;
  justify-content:flex-end;  /* align links under Back/Next */
}

.tour-link{
  all: unset;                     /* nuke theme button styles */
  font-family: -apple-system, BlinkMacSystemFont, Inter, system-ui;
  font-weight: 500;
  font-size: 10px !important;
  line-height: 1.2;
  color: var(--muted);
  text-decoration: underline;
  cursor: pointer;
}
.tour-link:hover{ color: var(--text); }
.tour-dot{ color: var(--muted); font-size:11px; line-height:1; }
.tour-spacer{ flex:1; }
.tour-btn{
  padding: 8px 12px;
  background: var(--glass-bg);
  border: 1px solid var(--stroke);
  border-radius: 10px;
  cursor: pointer;
  font: 600 12px/1 -apple-system, BlinkMacSystemFont, Inter, system-ui;
  transition: background var(--transition), transform var(--transition), color var(--transition), box-shadow var(--transition);
}
.tour-btn:hover{ background: var(--glass-hover); transform: translateY(-1px); }
.tour-btn.primary{
  background: linear-gradient(180deg, var(--brand), color-mix(in srgb, var(--brand) 88%, black));
  color: white;
  box-shadow: 0 6px 16px color-mix(in srgb, var(--brand) 45%, transparent);
}
.tour-close{
  position:absolute; top:6px; right:8px;
  background: transparent; border: none; cursor: pointer;
  font-size: 18px; line-height: 1; color: var(--muted);
}
.tour-highlight{
  outline: 2px solid var(--brand);
  outline-offset: 4px;
  border-radius: 12px;
  box-shadow: 0 0 0 6px color-mix(in srgb, var(--brand) 18%, transparent);
}
@media (max-width: 520px){
  .tour-tip{ max-width: 92vw; }
}
/* Variant counter badge */
.variant-counter{
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  margin-left: 8px;
  border-radius: 999px;
  font: 700 10px/1 -apple-system, BlinkMacSystemFont, Inter, system-ui;
  letter-spacing: .06em;
  text-transform: uppercase;
  background: var(--glass-bg);
  border: 1px solid var(--stroke);
  color: var(--muted);
  vertical-align: middle;
}

/* (Optional) combinations chip in the toolbar */
.combo-chip{
  margin-left: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  font: 700 11px/1 -apple-system, BlinkMacSystemFont, Inter, system-ui;
  background: var(--glass-bg);
  border: 1px solid var(--stroke);
  color: var(--muted);
}

/* ================================
   Portrait "rotate to landscape" overlay (phones/tablets)
   ================================ */
#rotate-overlay{
  position: absolute;        /* stays inside #viewer-container */
  inset: 0;
  display: none;             /* toggled via JS */
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: color-mix(in srgb, #000 24%, transparent);
  -webkit-backdrop-filter: blur(2px) saturate(130%);
  backdrop-filter: blur(2px) saturate(130%);
  z-index: var(--z-max);     /* above everything in the container */
  pointer-events: auto;      /* blocks taps behind */
}

#rotate-overlay.show{ display: flex; }

#rotate-card{
  width: min(520px, 92vw);
  border-radius: 16px;
  border: 1px solid var(--stroke-strong);
  background: var(--glass-strong);
  box-shadow: var(--shadow-lg);
  padding: calc(18px + env(safe-area-inset-top, 0px))
           18px
           calc(18px + env(safe-area-inset-bottom, 0px));
  text-align: center;
}

#rotate-icon{
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px; height: 56px;
  margin: 4px auto 10px auto;
  border-radius: 50%;
  border: 1px solid var(--stroke);
  background: var(--glass-bg);
  box-shadow: var(--shadow-sm);
}
#rotate-icon .material-icons{ font-size: 28px; }

#rotate-title{
  margin: 8px 0 6px 0;
  font: 700 14px/1.1 -apple-system, BlinkMacSystemFont, Inter, system-ui;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--muted);
}

#rotate-desc{
  margin: 0 0 12px 0;
  font: 500 14px/1.35 -apple-system, BlinkMacSystemFont, Inter, system-ui;
  color: var(--text);
}

.rotate-actions{
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  margin-top: 6px;
}

.rotate-btn{
  padding: 10px 14px;
  border-radius: 12px;
  border: 1px solid var(--stroke);
  background: var(--glass-bg);
  cursor: pointer;
  font: 600 13px/1 -apple-system, BlinkMacSystemFont, Inter, system-ui;
  transition: background var(--transition), transform var(--transition), box-shadow var(--transition);
}
.rotate-btn:hover{ background: var(--glass-hover); transform: translateY(-1px); }
.rotate-btn.primary{
  background: linear-gradient(180deg, var(--brand), color-mix(in srgb, var(--brand) 88%, black));
  color: white;
  box-shadow: 0 6px 16px color-mix(in srgb, var(--brand) 45%, transparent);
}

/* Respect reduced motion */
@media (prefers-reduced-motion: reduce){
  #rotate-overlay{ -webkit-backdrop-filter: none; backdrop-filter: none; }
}

/* ================================
   Consent Overlay
   ================================ */
#consent-overlay {
  position: absolute;
  inset: 0;
  display: none;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: color-mix(in srgb, #000 24%, transparent);
  -webkit-backdrop-filter: blur(2px) saturate(130%);
  backdrop-filter: blur(2px) saturate(130%);
  z-index: var(--z-max);
  pointer-events: auto;
}
#consent-overlay.show { display: flex; }

#consent-card {
  width: min(600px, 92vw);
  border-radius: 16px;
  border: 1px solid var(--stroke-strong);
  background: var(--glass-strong);
  box-shadow: var(--shadow-lg);
  padding: calc(18px + env(safe-area-inset-top, 0px)) 18px calc(18px + env(safe-area-inset-bottom, 0px));
  text-align: left;
  display: flex;
  flex-direction: column;
  max-height: 85vh;
}

#consent-title {
  margin: 0 0 12px 0;
  font: 700 16px/1.2 -apple-system, BlinkMacSystemFont, Inter, system-ui;
  text-align: center;
  color: var(--text);
}

#consent-text {
  flex: 1;
  overflow-y: auto;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text);
  background: rgba(255, 255, 255, 0.5);
  padding: 12px;
  border-radius: 8px;
  border: 1px solid var(--stroke);
  margin-bottom: 12px;
}
@media (prefers-color-scheme: dark) {
  #consent-text { background: rgba(0, 0, 0, 0.2); }
}

#consent-checkbox-container {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
  font-size: 14px;
  color: var(--text);
  cursor: pointer;
  user-select: none;
  padding: 4px 0;
}

#consent-checkbox {
  width: 18px;
  height: 18px;
  accent-color: var(--brand);
  cursor: pointer;
}

.consent-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}


/* ================================
   Fullscreen fallback: "Maximize" mode
   ================================ */
#viewer-container.is-maximized{
  position: fixed !important;
  inset: 0;
  width: 100vw;
  height: 100dvh;
  z-index: var(--z-max);
  background: #FFFFFF;
  /* Respect notches/home indicators */
  padding-top:    env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
  padding-left:   env(safe-area-inset-left, 0px);
  padding-right:  env(safe-area-inset-right, 0px);
}

/* Lock page scroll while maximized */
body.hp-lock-scroll{
  overflow: hidden !important;
  touch-action: none;
}

/* Exit button for Maximize (top-right) */
#exit-maximize{
  position: absolute;
  top:  calc(8px + env(safe-area-inset-top, 0px));
  right: calc(8px + env(safe-area-inset-right, 0px));
  z-index: var(--z-max);
  display: none;              /* only visible in .is-maximized */
}
#viewer-container.is-maximized #exit-maximize{
  display: inline-flex;
}

/* Viewport height: prefer dvh, then svh, fallback to vh */
:root{ --viewer-h: 85vh; }                 /* base fallback */
@supports (height: 100dvh){
  :root{ --viewer-h: 85dvh; }              /* modern iOS/Android */
}
@supports ((not (height: 100dvh)) and (height: 100svh)){
  :root{ --viewer-h: 85svh; }              /* older iOS */
}


/* Clamp floating panels so they never overflow tiny screens */
.preset-options{ max-width: 92vw; }
.color-palette{ max-width: 92vw; }
#download-menu{ max-width: 92vw; }

.color-swatch,
.color-pill {
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation; /* reduces delays on taps */
}
  </style>

<div
  id="viewer-container"
  aria-label="HP Robot Customizer"
>
    <!-- Lightweight skeleton shimmer for first paint -->
    <div id="skeleton" class="u-hidden" aria-hidden="true"></div>

    <!-- Toast stack -->
    <div id="toastStack" class="toast-stack" aria-live="polite" aria-atomic="true"></div>

    <!-- Portrait overlay (only shows on phones/tablets in portrait) -->
    <div id="rotate-overlay" class="rotate-overlay" role="dialog" aria-modal="true" aria-labelledby="rotate-title" aria-describedby="rotate-desc" tabindex="-1">
      <div id="rotate-card">
        <div id="rotate-icon"><span class="material-icons" aria-hidden="true">screen_rotation</span></div>
        <div id="rotate-title">Rotate to landscape</div>
        <p id="rotate-desc">This viewer is landscape-first. Please rotate your device for the best experience.</p>
        <div class="rotate-actions">
          <button id="rotate-dismiss" class="rotate-btn">Use anyway (this session)</button>
          <button id="rotate-never"   class="rotate-btn">Don’t show again</button>
          <button id="rotate-help"    class="rotate-btn primary">Got it</button>
        </div>
      </div>
    </div>

    <!-- Consent Overlay -->
    <div id="consent-overlay" role="dialog" aria-modal="true" aria-labelledby="consent-title" tabindex="-1">
      <div id="consent-card">
        <h2 id="consent-title">Terms &amp; Conditions</h2>
        <div id="consent-text">
          <p>The file you are going to download is for personal and educational use only. © MORAVIA Consulting s.r.o., Brno, CZ</p>
          <p>Any other use is without permission prohibited. By downloading you accept our terms and conditions.</p>
          <br>
          <p>By downloading 3D files, manual, textbooks, lessons, software, or any other material from the HP Robots webpage www.hprobots.com you confirm that they are intended for personal or educational use only and will not be used for any other purpose.</p>
          <br>
          <p>Any other use is prohibited without the permission of MORAVIA Consulting spol. s r.o. Any violation will result in claims for damages.</p>
          <br>
          <p>By each download, you accept the terms and conditions of MORAVIA Consulting spol. s r.o., the owner of the intellectual property of all downloaded materials.</p>
          <p>In case of any questions please contact info@moravia-consulting.com</p>
        </div>
        <label id="consent-checkbox-container">
          <input type="checkbox" id="consent-checkbox">
          <span>I accept the terms and conditions</span>
        </label>
        <div class="consent-actions">
          <button id="consent-cancel" class="rotate-btn">Cancel</button>
          <button id="consent-confirm" class="rotate-btn primary" disabled>Download</button>
        </div>
      </div>
    </div>


    <!-- Exit button for Maximize fallback (hidden unless maximized) -->
    <button id="exit-maximize" class="btn btn--lg" title="Exit maximized view" aria-label="Exit maximized view">
      <span class="material-icons">close_fullscreen</span>
    </button>

    <!-- Preset quick menu -->
    <div id="preset-menu" class="preset-menu" role="group" aria-label="Preset configurations">
      <button id="preset-toggle" class="preset-toggle" aria-haspopup="listbox" aria-expanded="false" aria-label="Active preset: Starter Kit">
        <span class="material-icons">layers</span>
        <span id="preset-active-label" class="preset-label">Starter Kit</span>
        <span class="material-icons caret">expand_more</span>
      </button>
      <div id="preset-options" class="preset-options" role="listbox" aria-label="Preset configurations">
        <button class="preset-option active" data-preset="starter" role="option" aria-selected="true">
          <span class="option-title">Starter Kit</span>
          <span class="option-desc">Essentials, advanced hidden</span>
        </button>
        <button class="preset-option" data-preset="invent" role="option" aria-selected="false">
          <span class="option-title">Walk and Roll</span>
          <span class="option-desc">Invent expansion kit</span>
        </button>
        <button class="preset-option" data-preset="sensor" role="option" aria-selected="false">
          <span class="option-title">Sensor Scout</span>
          <span class="option-desc">Dual sensors with RGB face</span>
        </button>
        <button class="preset-option" data-preset="showtime" role="option" aria-selected="false">
          <span class="option-title">Showtime Parade</span>
          <span class="option-desc">MP3 top, matrix face &amp; hat</span>
        </button>
      </div>
    </div>

    <!-- Toggle (top-right) -->
    <div id="controls-toggle" role="tablist" aria-label="Customizer sections">
      <button id="show-essential" class="toggle-btn active" role="tab" aria-selected="true">
        <span class="material-icons">tune</span>&nbsp;Essential
      </button>
      <button id="show-advanced" class="toggle-btn" role="tab" aria-selected="false">
        <span class="material-icons">construction</span>&nbsp;Advanced
      </button>
    </div>

    <!-- bottom-left toolbar -->
    <div id="info-container" class="u-glass" role="group" aria-label="Viewer actions">
      <button id="infoBtn" class="btn btn--lg" title="Info" aria-haspopup="dialog" aria-expanded="false">
        <span class="material-icons">info</span>
      </button>
      <div id="info-tooltip" role="dialog" aria-label="About Customizer">
        HP Robots Customizer v1.0.4<br>
        <a href="#" id="startTourLink">Quick tour</a>
      </div>

      <div id="action-buttons">
        <button id="fullscreenBtn" class="btn btn--lg" title="Fullscreen" aria-label="Toggle fullscreen">
          <span class="material-icons">fullscreen</span>
        </button>
      
        <!-- Camera-only reset (existing) -->
        <button id="resetBtn" class="btn btn--lg" title="Reset View" aria-label="Reset camera">
          <span class="material-icons">refresh</span>
        </button>
      
        <!--  NEW: Full build reset -->
        <button id="factoryResetBtn" class="btn btn--lg" title="Reset Build" aria-label="Reset build to default">
          <span class="material-icons">restart_alt</span>
        </button>
      
        <button id="randomizeBtn" class="btn btn--lg" title="Randomize Parts" aria-label="Randomize all parts">
          <span class="material-icons">casino</span>
        </button>
      
        <div id="download-group" role="group" aria-label="Downloads">
          <button id="download-primary" class="btn btn--lg" title="Download STEP" aria-label="Download STEP">
            <span class="material-icons">download</span>
          </button>
          <button id="download-toggle" class="btn btn--lg" title="More formats" aria-haspopup="menu" aria-expanded="false" aria-controls="download-menu">
            <span class="material-icons">arrow_drop_down</span>
          </button>
          <div id="download-menu" role="menu" aria-label="Download options">
            <button id="downloadGlbBtn" role="menuitem">Download GLB files</button>
            <button id="download3mfBtn" role="menuitem">Download 3MF files</button>
          </div>
        </div>
      </div>
      <span class="combo-chip" id="comboChip">Combos: —</span>
    </div>
      
    <!-- ESSENTIAL PANEL -->
    <div class="model-controls essential" id="panel-essential" role="tabpanel" aria-labelledby="show-essential">
      <?php foreach ( ['top','middle','face','bottom','wheels'] as $part ): ?>
      <div class="model-section" id="<?= $part; ?>-controls">
          <div class="model-controls-row">
            <button class="btn btn--sm btn--ghost" data-role="prev" data-part="<?= $part; ?>" aria-label="Previous <?= $part; ?>">
              <span class="material-icons">chevron_left</span>
            </button>
            <span class="model-label">
              <?= $part === 'wheels' ? 'Motion' : ucfirst($part); ?>
              <span class="variant-counter" id="<?= $part; ?>-counter" aria-live="polite">–/–</span>
            </span>
            <button class="btn btn--sm btn--ghost" data-role="next" data-part="<?= $part; ?>" aria-label="Next <?= $part; ?>">
              <span class="material-icons">chevron_right</span>
            </button>
          </div>
          <div class="pill-container">
            <div class="color-pill" id="<?= $part; ?>-pill" data-role="color-pill" data-part="<?= $part; ?>" title="Pick color for <?= $part; ?>"></div>
            <button class="btn btn--sm btn--ghost" id="<?= $part; ?>-visibility" data-role="visibility" data-part="<?= $part; ?>" aria-label="Toggle visibility for <?= $part; ?>">
              <span class="material-icons">visibility</span>
            </button>
            <button class="btn btn--sm btn--ghost" data-role="print" data-part="<?= $part; ?>" title="Print part" aria-label="Open <?= $part; ?> in OrcaSlicer">
              <span class="material-icons">print</span>
            </button>
            <button class="btn btn--sm btn--ghost" data-role="download-part" data-part="<?= $part; ?>" title="Download STEP" aria-label="Download <?= $part; ?> STEP file">
              <span class="material-icons">file_download</span>
            </button>        
          </div>
          <div class="color-palette" id="<?= $part; ?>-palette" role="menu" aria-label="Color palette for <?= $part; ?>">
            <?php foreach (['#231F20','#549EF7','#00D072','#FFBD3B','#A89EFA','#CE4A4A','#E6E6E6','#FFFFFF'] as $c): ?>
              <div class="color-swatch <?= $c === '#FFFFFF' ? 'white' : ''; ?>"
                   data-role="swatch"
                   data-part="<?= $part; ?>"
                   data-color="<?= $c; ?>"
                   title="<?= $c; ?>"></div>
            <?php endforeach; ?>
          </div>
        </div>
      <?php endforeach; ?>
    </div>

    <!-- ADVANCED PANEL -->
    <div class="model-controls advanced" id="panel-advanced" role="tabpanel" aria-labelledby="show-advanced" style="display:none">
      <?php foreach ( ['hat','arms','spacer','bumper','tail'] as $part ): ?>
      <div class="model-section" id="<?= $part; ?>-controls" <?= $part === 'tail' ? 'style="display:none"' : ''; ?>>
          <div class="model-controls-row">
            <button class="btn btn--sm btn--ghost" data-role="prev" data-part="<?= $part; ?>" aria-label="Previous <?= $part; ?>">
              <span class="material-icons">chevron_left</span>
            </button>
            <span class="model-label">
              <?= ucfirst($part); ?>
              <span class="variant-counter" id="<?= $part; ?>-counter" aria-live="polite">–/–</span>
            </span>
            <button class="btn btn--sm btn--ghost" data-role="next" data-part="<?= $part; ?>" aria-label="Next <?= $part; ?>">
              <span class="material-icons">chevron_right</span>
            </button>
          </div>
          <div class="pill-container">
            <div class="color-pill" id="<?= $part; ?>-pill" data-role="color-pill" data-part="<?= $part; ?>" title="Pick color for <?= $part; ?>"></div>
            <button class="btn btn--sm btn--ghost" id="<?= $part; ?>-visibility" data-role="visibility" data-part="<?= $part; ?>" aria-label="Toggle visibility for <?= $part; ?>">
              <span class="material-icons">visibility</span>
            </button>
            <button class="btn btn--sm btn--ghost" data-role="print" data-part="<?= $part; ?>" title="Print part" aria-label="Open <?= $part; ?> in OrcaSlicer">
              <span class="material-icons">print</span>
            </button>
            <button class="btn btn--sm btn--ghost" data-role="download-part" data-part="<?= $part; ?>" title="Download STEP" aria-label="Download <?= $part; ?> STEP file">
              <span class="material-icons">file_download</span>
            </button>        
          </div>
          <div class="color-palette" id="<?= $part; ?>-palette" role="menu" aria-label="Color palette for <?= $part; ?>">
            <?php foreach (['#231F20','#549EF7','#00D072','#FFBD3B','#A89EFA','#CE4A4A','#E6E6E6','#FFFFFF'] as $c): ?>
              <div class="color-swatch <?= $c === '#FFFFFF'? 'white':''; ?>"
                   data-role="swatch"
                   data-part="<?= $part; ?>"
                   data-color="<?= $c; ?>"
                   title="<?= $c; ?>"></div>
            <?php endforeach; ?>
          </div>
        </div>
      <?php endforeach; ?>
    </div>
  </div>

  <!-- Modules: es-module-shims + importmap for threejs -->
  <script async src="https://unpkg.com/es-module-shims@1.8.0/dist/es-module-shims.js"></script>
  <script type="importmap">
  {
    "imports": {
      "three": "https://unpkg.com/three@0.156.1/build/three.module.js",
      "three/addons/": "https://unpkg.com/three@0.156.1/examples/jsm/"
    }
  }
  </script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>

  <script type="module">


/* ==========================================================================
   Imports
   ========================================================================== */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader }    from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader }    from 'three/addons/loaders/RGBELoader.js';

/* ==========================================================================
   DOM Refs & Helpers
   ========================================================================== */
const container    = document.getElementById('viewer-container');

const toastStack   = document.getElementById('toastStack');
const skeleton     = document.getElementById('skeleton');
const infoBtn      = document.getElementById('infoBtn');
const infoTip      = document.getElementById('info-tooltip');
const presetMenu    = document.getElementById('preset-menu');
const presetToggle  = document.getElementById('preset-toggle');
const presetOptions = document.getElementById('preset-options');
const presetLabelEl = document.getElementById('preset-active-label');
const presetButtons = Array.from(document.querySelectorAll('.preset-option[data-preset]'));

const fullscreenBtn     = document.getElementById('fullscreenBtn');
const resetBtn          = document.getElementById('resetBtn');          // camera/orbit reset
const factoryResetBtn   = document.getElementById('factoryResetBtn');   // 🔄 full build reset
const randomizeBtn      = document.getElementById('randomizeBtn');

const dlMenu       = document.getElementById('download-menu');
const dlPrimary    = document.getElementById('download-primary');
const dlToggle     = document.getElementById('download-toggle');
const dlGlbBtn     = document.getElementById('downloadGlbBtn');
const dl3mfBtn     = document.getElementById('download3mfBtn');

const essBtn       = document.getElementById('show-essential');
const advBtn       = document.getElementById('show-advanced');
const essPanel     = document.getElementById('panel-essential');
const advPanel     = document.getElementById('panel-advanced');

/* ==========================================================================
   Portrait overlay (phones/tablets): show when device is vertical
   ========================================================================== */
const rotateOverlay = document.getElementById('rotate-overlay');
const rotateDismiss = document.getElementById('rotate-dismiss');
const rotateNever   = document.getElementById('rotate-never');
const rotateHelp    = document.getElementById('rotate-help');

function isCoarsePointer(){
  try { return window.matchMedia && window.matchMedia('(pointer: coarse)').matches; }
  catch { return false; }
}

function isPortraitLike(){
  // Prefer media query; fall back to aspect ratio inside container
  const mqPortrait = window.matchMedia && window.matchMedia('(orientation: portrait)').matches;
  const w = container.clientWidth || window.innerWidth;
  const h = container.clientHeight || window.innerHeight;
  const tall = h > w; // conservative fallback
  return mqPortrait || tall;
}

function userDismissedSession(){
  return sessionStorage.getItem('hp_rotate_dismiss') === '1';
}
function userDismissedForever(){
  return localStorage.getItem('hp_rotate_never') === '1';
}

function showRotateOverlay(){
  // Close any floating UI to avoid z-index ties
  try { reallyClosePalette?.(); } catch {}
  try { closeDlMenu?.(); } catch {}
  try { closePresetMenu?.(); } catch {}

  rotateOverlay.classList.add('show');
  // focus the primary button for accessibility
  (rotateHelp || rotateDismiss)?.focus();

  // simple focus trap
  const focusables = rotateOverlay.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])');
  const first = focusables[0], last = focusables[focusables.length - 1];
  function trap(e){
    if (e.key !== 'Tab') return;
    if (focusables.length === 0) return;
    if (e.shiftKey && document.activeElement === first){ last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last){ first.focus(); e.preventDefault(); }
  }
  rotateOverlay.__trap = trap;
  rotateOverlay.addEventListener('keydown', trap);
}

function hideRotateOverlay(){
  rotateOverlay.classList.remove('show');
  if (rotateOverlay.__trap){
    rotateOverlay.removeEventListener('keydown', rotateOverlay.__trap);
    rotateOverlay.__trap = null;
  }
}

function shouldShowRotateOverlay(){
  if (!isCoarsePointer()) return false;         // desktop/laptops: never show
  if (userDismissedForever()) return false;     // user opted out
  if (userDismissedSession()) return false;     // dismissed for session
  return isPortraitLike();
}

function updateRotateOverlay(){
  if (shouldShowRotateOverlay()) showRotateOverlay();
  else hideRotateOverlay();
}

// Buttons
rotateDismiss?.addEventListener('click', ()=>{
  sessionStorage.setItem('hp_rotate_dismiss', '1');
  hideRotateOverlay();
});
rotateNever?.addEventListener('click', ()=>{
  localStorage.setItem('hp_rotate_never', '1');
  hideRotateOverlay();
});
rotateHelp?.addEventListener('click', ()=>{
  hideRotateOverlay();
});

// Dismiss on Escape
rotateOverlay?.addEventListener('keydown', (e)=>{
  if (e.key === 'Escape') hideRotateOverlay();
});

// Re-evaluate on resize/orientation changes
window.addEventListener('resize',           updateRotateOverlay, { passive:true });
window.addEventListener('orientationchange',updateRotateOverlay);

// First evaluation (after a tick so container has size)
setTimeout(updateRotateOverlay, 0);


/* ==========================================================================
   Consent Popup Logic
   ========================================================================== */
const consentOverlay = document.getElementById('consent-overlay');
const consentCheckbox = document.getElementById('consent-checkbox');
const consentConfirm = document.getElementById('consent-confirm');
const consentCancel = document.getElementById('consent-cancel');
let consentResolve = null;
let consentReject = null;

function showConsentPopup() {
  return new Promise((resolve, reject) => {
    if (!consentOverlay) {
      reject(new Error('Consent overlay not found'));
      return;
    }

    consentResolve = resolve;
    consentReject = reject;

    // Reset state
    if (consentCheckbox) consentCheckbox.checked = false;
    if (consentConfirm) consentConfirm.disabled = true;

    // Close other overlays
    try { reallyClosePalette?.(); } catch {}
    try { closeDlMenu?.(); } catch {}
    try { closePresetMenu?.(); } catch {}
    try { hideRotateOverlay?.(); } catch {}

    consentOverlay.classList.add('show');
    consentOverlay.focus();
  });
}

function hideConsentPopup() {
  if (!consentOverlay) return;
  consentOverlay.classList.remove('show');
  consentResolve = null;
  consentReject = null;
}

if (consentCheckbox && consentConfirm) {
  consentCheckbox.addEventListener('change', (e) => {
    consentConfirm.disabled = !e.target.checked;
  });
}

if (consentConfirm) {
  consentConfirm.addEventListener('click', () => {
    const resolve = consentResolve;
    hideConsentPopup();
    if (resolve) resolve();
  });
}

if (consentCancel) {
  consentCancel.addEventListener('click', () => {
    const reject = consentReject;
    hideConsentPopup();
    if (reject) reject(new Error('User cancelled'));
  });
}

// ESC closes (rejects)
if (consentOverlay) {
  consentOverlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const reject = consentReject;
      hideConsentPopup();
      if (reject) reject(new Error('User cancelled'));
    }
  });
}


/* Toast utility */
function toast(message, type='ok', ms=2000){
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="material-icons">${type==='ok'?'check_circle': type==='warn'?'warning':'error'}</span><div>${message}</div>`;
  toastStack.appendChild(el);
  setTimeout(()=>{ el.style.opacity = '0'; el.style.transform='translateY(-4px)'; }, ms);
  setTimeout(()=> el.remove(), ms + 300);
}

/* Palette utilities */
function closeAllPalettes(){
  document.querySelectorAll('.color-palette.open').forEach(pal=>{
    pal.classList.remove('open');
    pal.style.position=''; pal.style.left=''; pal.style.top=''; pal.style.transform=''; pal.style.zIndex='';
    pal.style.display='none';
  });
}

/* ==========================================================================
   Change feedback, jiggle, etc.
   ========================================================================== */

// Parts that are often occluded from the front
const occludedParts = new Set(['middle','bumper','tail','bottom','wheels']);

// Safe display name for toasts/labels
function getPartDisplayName(part){
  if (part === 'wheels') return 'Motion';
  return part.charAt(0).toUpperCase() + part.slice(1);
}

/* Organic movement feedback */
const __partAnimToken = new Map();

function jigglePart(part){
  if (isApplyingPreset) return;
  if (!partVis[part]) return;
  const root = loadedMods[part];
  if (!root) return;

  // Respect reduced motion
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const base = {
    px: root.position.x, py: root.position.y, pz: root.position.z,
    rx: root.rotation.x, ry: root.rotation.y, rz: root.rotation.z,
    sx: root.scale.x,    sy: root.scale.y,    sz: root.scale.z
  };

  const token = {};
  __partAnimToken.set(part, token);

  const dur = 500; // ms
  const t0 = performance.now();

  function tick(now){
    if (__partAnimToken.get(part) !== token){
      root.position.set(base.px, base.py, base.pz);
      root.rotation.set(base.rx, base.ry, base.rz);
      root.scale.set(base.sx, base.sy, base.sz);
      return;
    }

    const t = Math.min(1, (now - t0) / dur);
    const decay = Math.exp(-6 * t);
    const s = 1 + 0.04 * decay * Math.sin(12 * Math.PI * t);
    const ryOff = 0.12 * decay * Math.sin(10 * Math.PI * t);
    const yOff  = 3 * decay * Math.sin(10 * Math.PI * t);

    root.rotation.y = base.ry + ryOff;
    root.position.y = base.py + yOff;

    const sx = base.sx * s;
    const sz = base.sz * s;
    const sy = base.sy * (1 - (s - 1) * 0.5);
    root.scale.set(sx, sy, sz);

    if (t < 1){
      requestAnimationFrame(tick);
    } else {
      root.position.set(base.px, base.py, base.pz);
      root.rotation.set(base.rx, base.ry, base.rz);
      root.scale.set(base.sx, base.sy, base.sz);
      if (__partAnimToken.get(part) === token) __partAnimToken.delete(part);
    }
  }
  requestAnimationFrame(tick);
}

function nudgeCameraIfOccluded(part){
  if (isApplyingPreset) return;
  if (!occludedParts.has(part)) return;
  controls.rotateLeft(0.15);
  setTimeout(() => controls.rotateLeft(-0.15), 260);
}

function showVariantToast(part){
  const list = modelSets[part] || [];
  const idx  = (currentIdx[part] ?? 0) + 1;
  const name = getPartDisplayName(part);
  toast(`${name} → ${idx}/${list.length}`, 'ok', 900);
}

/* Ensure a part is enabled (visible & in scene). */
function enablePart(part, withToast = true){
  if (partVis[part]) return;

  partVis[part] = true;

  const visBtn = document.getElementById(`${part}-visibility`);
  if (visBtn) visBtn.innerHTML = '<span class="material-icons">visibility</span>';

  if (loadedMods[part]) {
    loadedMods[part].visible = true;
    if (!loadedMods[part].parent) scene.add(loadedMods[part]);
  } else {
    loadModel(part);
  }

  if (part === 'spacer') {
    loadModel('bottom');
    loadModel('wheels');
  }

  updateComboChip();
  if (withToast) toast(`${getPartDisplayName(part)} enabled`, 'ok', 900);

  markCustomPreset(); // persist state
}

// --- MUTUAL EXCLUSION: arms vs bumper ---
// If 'part' is "arms", otherPart is "bumper", and vice versa.
function getOtherConflictingPart(part) {
  if (part === 'arms')   return 'bumper';
  if (part === 'bumper') return 'arms';
  return null;
}

// Force rule: if we just enabled/toggled one, hide the other.
function enforceArmsBumperExclusion(partJustEnabledOrShown) {
  const other = getOtherConflictingPart(partJustEnabledOrShown);
  if (!other) return;

  // turn OFF the other part if it's currently visible
  if (partVis[other]) {
    partVis[other] = false;

    // update button icon for the other part
    const otherBtn = document.getElementById(`${other}-visibility`);
    if (otherBtn) {
      otherBtn.innerHTML = '<span class="material-icons">visibility_off</span>';
    }

    // hide mesh
    if (loadedMods[other]) {
      loadedMods[other].visible = false;
    }
  }
}


/* ==========================================================================
   Variant counters & combinations
   ========================================================================== */
function updateVariantCounter(part){
  const el = document.getElementById(`${part}-counter`);
  const list = modelSets[part] || [];
  if (!el) return;
  const idx = (currentIdx[part] ?? 0) + 1;
  el.textContent = `${Math.max(1, idx)}/${list.length || 0}`;
}

function updateAllCounters(){
  Object.keys(modelSets).forEach(updateVariantCounter);
}

function updateComboChip(){
  const chip = document.getElementById('comboChip');
  if (!chip) return;
  const combos = Object.keys(modelSets)
    .filter(p => partVis[p])
    .map(p => Math.max(1, (modelSets[p] ? modelSets[p].length : 0)))
    .reduce((acc, n) => acc * n, 1);
  chip.textContent = `Combos: ${combos.toLocaleString()}`;
}


/* ==========================================================================
   Three.js Scene
   ========================================================================== */
const scene  = new THREE.Scene();
scene.background = new THREE.Color(0xf0f0f0);

const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:false });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setClearColor(0xcccccc);
renderer.shadowMap.enabled = true;
container.appendChild(renderer.domElement);


/* Camera & resize */
const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
camera.position.set(-90, 100, 120);
camera.lookAt(0, 0, 0);

function onResize() {
  const w = container.clientWidth || window.innerWidth;
  const h = container.clientHeight || window.innerHeight;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
setTimeout(onResize, 100);

/* Viewer height fallback for older browsers */
(function setupViewerHeightFallback(){
  const supportsDvh = CSS.supports?.('height', '100dvh');
  if (supportsDvh) return;
  function apply(){
    const h = window.innerHeight || document.documentElement.clientHeight || 700;
    const px = Math.max(320, Math.round(h * 0.85));
    document.documentElement.style.setProperty('--viewer-h', px + 'px');
  }
  window.addEventListener('resize', apply, { passive: true });
  window.addEventListener('orientationchange', apply, { passive: true });
  setTimeout(apply, 0);
})();


const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.update();
controls.saveState();

controls.enableDamping = true;
controls.dampingFactor = 0.08;

/* Environment */
const pmrem = new THREE.PMREMGenerator(renderer);
pmrem.compileEquirectangularShader();
new RGBELoader()
  .setDataType(THREE.UnsignedByteType)
  .load('https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr', hdr => {
    const envMap = pmrem.fromEquirectangular(hdr).texture;
    scene.environment = envMap;
    hdr.dispose(); pmrem.dispose();
  });

/* Lights */
const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
keyLight.position.set(100, 200, 100);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xffffff, 0.6);
fillLight.position.set(-100, -50, -100);
scene.add(fillLight);

const backLight = new THREE.DirectionalLight(0xffffff, 0.3);
backLight.position.set(0, 150, -200);
scene.add(backLight);

scene.add(new THREE.AmbientLight(0xffffff, 0.4));

/* Ground */
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(500, 500),
  new THREE.ShadowMaterial({ opacity: 0.1 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

/* ==========================================================================
   Models & State
   ========================================================================== */
const modelSets = {
  hat:    [
    'https://hprobots.com/wp-content/uploads/2025/07/hat_1.glb',
    'https://hprobots.com/wp-content/uploads/2025/07/hat_2.glb',
    'https://hprobots.com/wp-content/uploads/2025/07/hat_3.glb',
    'https://hprobots.com/wp-content/uploads/2025/10/Spoiler_F1.glb',
    'https://hprobots.com/wp-content/uploads/2025/10/Hat_Santa.glb'
  ],
  arms:   [
    'https://hprobots.com/wp-content/uploads/2025/08/Arm-angle.glb',
    'https://hprobots.com/wp-content/uploads/2025/08/Arm-straight.glb'
  ],
  bumper: [
    'https://hprobots.com/wp-content/uploads/2025/10/bumper_oriented.glb',
    'https://hprobots.com/wp-content/uploads/2025/10/Bumper_motor_rbulldozer.glb',
    'https://hprobots.com/wp-content/uploads/2025/10/Bumper_F1.glb',
    'https://hprobots.com/wp-content/uploads/2025/10/Bumper_football.glb',
    'https://hprobots.com/wp-content/uploads/2025/10/Bumper_motor_collect.glb',
    'https://hprobots.com/wp-content/uploads/2025/10/Bumper_motor_ramp.glb'
  ],
  //tail:   [
  //  'https://hprobots.com/wp-content/uploads/2025/07/tail_1.glb'
  //],
  top:    [
    'https://hprobots.com/wp-content/uploads/2025/08/Top-HP-logo.glb',
    'https://hprobots.com/wp-content/uploads/2025/08/Top-MP3.glb',
    'https://hprobots.com/wp-content/uploads/2025/08/Top-sensor-duo.glb',
    'https://hprobots.com/wp-content/uploads/2025/08/Top-sensor-single.glb',
    'https://hprobots.com/wp-content/uploads/2025/10/Top_template.glb',
    'https://hprobots.com/wp-content/uploads/2025/10/TopUSmatrix.glb',
    'https://hprobots.com/wp-content/uploads/2025/10/TopUSline.glb',
    'https://hprobots.com/wp-content/uploads/2025/10/TopOLEDbuttons.glb',
    'https://hprobots.com/wp-content/uploads/2025/10/Topmulti4.glb',
    'https://hprobots.com/wp-content/uploads/2025/10/Topmatrixbuttons.glb',
    'https://hprobots.com/wp-content/uploads/2025/10/Toplightspoke.glb',
    'https://hprobots.com/wp-content/uploads/2025/10/Toplightsdiffuser.glb',
    'https://hprobots.com/wp-content/uploads/2025/10/Toplights_NOlogo.glb'
  ],
  middle: [
    'https://hprobots.com/wp-content/uploads/2025/08/Middle-starter.glb',
    'https://hprobots.com/wp-content/uploads/2025/10/MiddleNOlogo.glb'
  ],
  face:   [
    'https://hprobots.com/wp-content/uploads/2025/08/Face-ultrasonic.glb',
    'https://hprobots.com/wp-content/uploads/2025/08/Face-RGB-ring.glb',
    'https://hprobots.com/wp-content/uploads/2025/08/Face-matrix.glb',
    'https://hprobots.com/wp-content/uploads/2025/08/Face-display.glb',
    'https://hprobots.com/wp-content/uploads/2025/10/FaceUS_eyebrows.glb',
    'https://hprobots.com/wp-content/uploads/2025/10/FaceUS_eyebrows_angry.glb',
    'https://hprobots.com/wp-content/uploads/2025/10/FaceUS_Pumpkin.glb',
    'https://hprobots.com/wp-content/uploads/2025/10/FaceUSOLED.glb',
    'https://hprobots.com/wp-content/uploads/2025/10/FaceSanta.glb'
  ],
  bottom: [
    'https://hprobots.com/wp-content/uploads/2025/08/Bottom-starter.glb',
    'https://hprobots.com/wp-content/uploads/2025/10/Bottom_Pikachu.glb',
    'https://hprobots.com/wp-content/uploads/2025/10/Bottom_template.glb'
  ],
  wheels: [
    'https://hprobots.com/wp-content/uploads/2025/08/Wheels-starter.glb',
    'https://hprobots.com/wp-content/uploads/2025/08/Wheels-Walk-and-Roll.glb',
    'https://hprobots.com/wp-content/uploads/2025/08/Wheels-starter.glb',
    'https://hprobots.com/wp-content/uploads/2025/10/wheelF1.glb'
  ],
  spacer: [
    'https://hprobots.com/wp-content/uploads/2025/10/Middle_spacerA.glb'
  ]
};

/* Generate STEP & 3MF URLs */
const stepSets = {};
const mf3Sets  = {};
for (let p in modelSets) {
  stepSets[p] = modelSets[p].map(u => u.replace(/\.glb$/i, '.step'));
  mf3Sets[p]  = modelSets[p].map(u => u.replace(/\.glb$/i, '.3mf'));
}

const loader = new GLTFLoader();
loader.setCrossOrigin('anonymous');
const currentIdx = {}, loadedMods = {}, modelCols = {}, partVis = {};
partVis.spacer = false;
currentIdx.spacer = 0;
modelCols.spacer = new THREE.Color('#d9d9d9');
const advancedList = ['hat','arms','bumper','tail'];

const presets = {
  starter: {
    label: 'Starter Kit',
    description: 'Essentials, advanced hidden',
    parts: {
      top: 0,
      middle: 0,
      face: 0,
      bottom: 0,
      wheels: 0,
      hat: 0,
      arms: 1,
      bumper: 0,
      tail: 0
    },
    visibility: {
      top: true,
      middle: true,
      face: true,
      bottom: true,
      wheels: true,
      hat: false,
      arms: false,
      bumper: false,
      tail: false
    }
  },
  invent: {
    label: 'Walk and Roll',
    description: 'Invent expansiopn kit',
    parts: {
      top: 0,
      middle: 0,
      face: 0,
      bottom: 0,
      wheels: 1,
      hat: 0,
      arms: 1,
      bumper: 0,
      tail: 0
    },
    visibility: {
      top: true,
      middle: true,
      face: true,
      bottom: true,
      wheels: true,
      hat: false,
      arms: false,
      bumper: false,
      tail: false
    }
  },
  sensor: {
    label: 'Sensor Scout',
    description: 'Dual sensors with RGB face',
    parts: {
      top: 2,
      middle: 0,
      face: 1,
      bottom: 0,
      wheels: 1,
      hat: 1,
      arms: 0,
      bumper: 0,
      tail: 0
    },
    visibility: {
      top: true,
      middle: true,
      face: true,
      bottom: true,
      wheels: true,
      hat: true,
      arms: true,
      bumper: true,
      tail: false
    }
  },
  showtime: {
    label: 'Showtime Parade',
    description: 'MP3 top, matrix face & hat',
    parts: {
      top: 1,
      middle: 0,
      face: 2,
      bottom: 0,
      wheels: 1,
      hat: 2,
      arms: 1,
      bumper: 0,
      tail: 0
    },
    visibility: {
      top: true,
      middle: true,
      face: true,
      bottom: true,
      wheels: true,
      hat: true,
      arms: true,
      bumper: false,
      tail: true
    }
  }
};

let activePresetKey = 'starter';
let isApplyingPreset = false;

/* ==================================================
   STATE PERSISTENCE (save/restore across reloads)
   ================================================== */
const STATE_KEY = 'hp_robot_customizer_state';
let restoredFromLocal = false;

function saveStateToLocal(){
  const state = {
    currentIdx,
    partVis,
    modelCols: Object.fromEntries(
      Object.entries(modelCols).map(([p,col]) => [p, `#${col.getHexString()}`])
    ),
    presetKey: activePresetKey
  };
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch(e){ /* ignore */ }
}

function tryRestoreFromLocal(){
  let raw;
  try {
    raw = localStorage.getItem(STATE_KEY);
  } catch(e){ raw = null; }
  if (!raw) return;

  try {
    const st = JSON.parse(raw);

    if (st.currentIdx){
      for (let p in st.currentIdx){
        if (modelSets[p]){
          const idx = clampPresetIndex(p, st.currentIdx[p]);
          currentIdx[p] = idx;
        }
      }
    }
    if (st.partVis){
      for (let p in st.partVis){
        if (typeof st.partVis[p] === 'boolean'){
          partVis[p] = st.partVis[p];
        }
      }
    }
    if (st.modelCols){
      for (let p in st.modelCols){
        if (!modelCols[p]) modelCols[p] = new THREE.Color('#d9d9d9');
        modelCols[p].set(st.modelCols[p] || '#d9d9d9');
      }
    }
    if (st.presetKey){
      activePresetKey = st.presetKey;
    } else {
      activePresetKey = 'custom';
    }

    restoredFromLocal = true;
  } catch(e){
    /* bad JSON, ignore */
  }
}

function clampPresetIndex(part, idx){
  const list = modelSets[part] || [];
  if (!list.length) return 0;
  return Math.min(Math.max(idx, 0), list.length - 1);
}

function setPresetLabel(label){
  if (presetLabelEl) presetLabelEl.textContent = label;
  if (presetToggle) presetToggle.setAttribute('aria-label', `Active preset: ${label}`);
}

function syncPresetButtons(key){
  presetButtons.forEach(btn => {
    const isActive = btn.dataset.preset === key;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
}

function populatePresetMenu(){
  presetButtons.forEach(btn => {
    const key = btn.dataset.preset;
    const preset = presets[key];
    if (!preset) return;
    const title = btn.querySelector('.option-title');
    const desc = btn.querySelector('.option-desc');
    if (title) title.textContent = preset.label;
    if (desc && preset.description) desc.textContent = preset.description;
  });
}

function markCustomPreset(){
  if (isApplyingPreset) return;
  activePresetKey = 'custom';
  setPresetLabel('Custom mix');
  syncPresetButtons('');
  saveStateToLocal(); // <-- persist after any manual tweak
}

/* Defaults */
for (let p in modelSets) {
  currentIdx[p] = 0;
  modelCols[p]  = new THREE.Color('#d9d9d9');
  partVis[p]    = !advancedList.includes(p); // essential visible by default
}
partVis.spacer = false; // override spacer default

const MODEL_Y_OFFSET = 30;

/* Apply color to meshes of a model */
function applyColor(p) {
  const mdl = loadedMods[p];
  if (!mdl) return;
  mdl.traverse(c => {
    if (c.isMesh) {
      const mats = Array.isArray(c.material) ? c.material : [c.material];
      mats.forEach(m => {
        if (!m || !m.color) return;
        m.color.set(modelCols[p]);
        m.needsUpdate = true;
      });
    }
  });
}

function loadModel(p) {
  if (p === 'spacer' && !partVis.spacer) return;

  const url = modelSets[p][currentIdx[p]];
  skeleton.classList.remove('u-hidden');

  loader.load(url, gltf => {
    if (loadedMods[p]) scene.remove(loadedMods[p]);

    const mdl = gltf.scene;

    let yOffset = MODEL_Y_OFFSET;
    if (partVis.spacer && (p === 'bottom' || p === 'wheels' || p === 'arms' || p === 'bumper')) {
      yOffset -= 16;
    }

    mdl.position.y = yOffset;
    mdl.visible = partVis[p];
    mdl.traverse(n => n.isMesh && (n.castShadow = true));

    loadedMods[p] = mdl;
    if (partVis[p]) scene.add(mdl);

    applyColor(p);
    updateVariantCounter(p);

    jigglePart(p);
    nudgeCameraIfOccluded(p);

    skeleton.classList.add('u-hidden');
  }, undefined, (err) => {
    console.error('Load error', err);
    toast(`Failed to load ${p} variant.`, 'err', 2400);
    skeleton.classList.add('u-hidden');
  });
}

function applyPreset(key, showToast = true){
  const preset = presets[key];
  if (!preset) return;
  isApplyingPreset = true;

  try {
    const toLoad = new Set();

    Object.entries(preset.parts || {}).forEach(([part, idx]) => {
      if (!modelSets[part]) return;
      const clamped = clampPresetIndex(part, idx);
      if (currentIdx[part] !== clamped || !loadedMods[part]) {
        currentIdx[part] = clamped;
        toLoad.add(part);
      }
    });

    Object.entries(preset.visibility || {}).forEach(([part, visible]) => {
      if (typeof visible !== 'boolean') return;
      partVis[part] = visible;
      const btn = document.getElementById(part + '-visibility');
      if (btn) {
        btn.innerHTML = '<span class="material-icons">' + (visible ? 'visibility' : 'visibility_off') + '</span>';
      }
      if (loadedMods[part]) loadedMods[part].visible = visible;
    });

        // enforce arms/bumper rule after preset vis is applied
        if (partVis.arms && partVis.bumper) {
      // pick one to keep. We'll default to arms staying on unless you prefer bumper.
      partVis.bumper = false;
      const bumpBtn = document.getElementById('bumper-visibility');
      if (bumpBtn) {
        bumpBtn.innerHTML = '<span class="material-icons">visibility_off</span>';
      }
      if (loadedMods.bumper) {
        loadedMods.bumper.visible = false;
      }
    }


    toLoad.forEach(part => loadModel(part));
    updateAllCounters();
    updateComboChip();

    activePresetKey = key;
    setPresetLabel(preset.label);
    syncPresetButtons(key);
    if (showToast) toast(preset.label + ' preset loaded', 'ok', 1200);

    saveStateToLocal(); // persist preset choice
  } finally {
    isApplyingPreset = false;
  }
}



function resetToFactory() {
  // 1. Apply the Starter preset (parts + visibility + variant indices)
  //    We don't want duplicate toasts, so pass false.
  applyPreset('starter', false);

  // 2. Force spacer off explicitly (it's kind of "special mode")
  partVis.spacer = false;
  const spacerVisBtn = document.getElementById('spacer-visibility');
  if (spacerVisBtn) {
    spacerVisBtn.innerHTML = '<span class="material-icons">visibility_off</span>';
  }
  if (loadedMods.spacer) {
    loadedMods.spacer.visible = false;
  }

  // Make sure bottom + wheels Y-offset goes back to normal if spacer had been on
  loadModel('bottom');
  loadModel('wheels');

  // 3. Reset ALL colors back to default gray (#d9d9d9)
  for (let p in modelSets) {
    if (!modelCols[p]) {
      modelCols[p] = new THREE.Color('#d9d9d9');
    }
    modelCols[p].set('#d9d9d9');
    applyColor(p);

    // Update the pill UI so the little color bar matches
    const pill = document.getElementById(`${p}-pill`);
    if (pill) {
      pill.style.backgroundColor = '#d9d9d9';
      pill.style.border = '1px solid var(--stroke)';
    }
  }

  // 4. Sync counters and combo chip
  updateAllCounters();
  updateComboChip();

  // 5. Camera/orbit back to default view
  controls.reset();

  // 6. Make sure preset label + buttons reflect that we're back on Starter
  activePresetKey = 'starter';
  setPresetLabel(presets['starter'].label);
  syncPresetButtons('starter');

  // 7. Persist this clean state so reload matches factory
  saveStateToLocal();

  // 8. Feedback
  toast('Back to default build', 'ok', 1200);
}


function openPresetMenu(){
  if (!presetMenu) return;
  presetMenu.classList.add('open');
  if (presetToggle) presetToggle.setAttribute('aria-expanded', 'true');
}

function closePresetMenu(){
  if (!presetMenu) return;
  presetMenu.classList.remove('open');
  if (presetToggle) presetToggle.setAttribute('aria-expanded', 'false');
}

/* =====================================
   RESTORE STATE (if exists) THEN INITIALIZE MODELS
   ===================================== */
tryRestoreFromLocal(); // may set restoredFromLocal and override indices/colors/vis

for (let p in modelSets) {
  if (p === 'spacer' && !partVis.spacer) continue;
  loadModel(p);
}

populatePresetMenu();

if (!restoredFromLocal) {
  // normal first-load behavior
  applyPreset('starter', false);
} else {
  // We restored a custom config
  setPresetLabel('Custom mix');
  syncPresetButtons('');
  updateAllCounters();
  updateComboChip();
  saveStateToLocal(); // make sure it's up to date
}

/* ==========================================================================
   Download Selection (STEP, GLB, 3MF) as zip
   ========================================================================== */
async function downloadSelection(format) {
  // Consent Check
  try {
    await showConsentPopup();
  } catch (e) {
    return; // User cancelled
  }

  const sets = (format === 'step') ? stepSets
             : (format === 'glb')  ? modelSets
             : (format === '3mf')  ? mf3Sets
             : null;
  if (!sets) return;

  const hasVisible = Object.keys(sets).some(p => partVis[p]);
  if (!hasVisible) {
    toast('No visible parts to download.', 'warn', 1800);
    return;
  }

  toast(`Preparing ${format.toUpperCase()}…`, 'ok', 1200);

  try {
    const zipF = new JSZip().folder('models');

    for (let p in sets) {
      if (!partVis[p]) continue;

      const url = sets[p][currentIdx[p]];
      if (!url) continue;

      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) { console.warn('Fetch failed for', url); continue; }

      const base = url.split('/').pop() || `${p}.${format}`;
      const filename = `${p}__${base}`;

      const blob = await res.blob();
      zipF.file(filename, blob);
    }

    const zipBlob = await zipF.generateAsync({ type: 'blob' });
    const a       = document.createElement('a');
    a.href        = URL.createObjectURL(zipBlob);
    a.download    = `models_selection_${format.toUpperCase()}.zip`;
    a.click();
    toast(`${format.toUpperCase()} zipped!`, 'ok', 1600);
  } catch(e){
    console.error(e);
    toast('Download failed. Please try again.', 'err', 2400);
  }
}

/* ==========================================================================
   UI Wiring: Info, Fullscreen, Reset, Randomize
   ========================================================================== */
/* Info tooltip hover + ARIA sync */
let tipTO;
infoBtn.addEventListener('mouseenter', () => { clearTimeout(tipTO); infoTip.style.display = 'block'; infoBtn.setAttribute('aria-expanded','true'); });
infoBtn.addEventListener('mouseleave', () => { tipTO = setTimeout(() => { infoTip.style.display = 'none'; infoBtn.setAttribute('aria-expanded','false'); }, 180); });
infoTip.addEventListener('mouseenter', () => clearTimeout(tipTO));
infoTip.addEventListener('mouseleave', () => { infoTip.style.display = 'none'; infoBtn.setAttribute('aria-expanded','false'); });

/* Fullscreen + Maximize fallback */
const exitMaxBtn = document.getElementById('exit-maximize');

let __isMaximized = false;
let __scrollYBeforeMax = 0;

function inNativeFullscreen(){
  const el = document.fullscreenElement;
  return !!el;
}
function supportsNativeFullscreen(){
  return !!(container.requestFullscreen) && (document.fullscreenEnabled !== false);
}

async function enterNativeFullscreen(){
  try{
    await container.requestFullscreen();
  }catch(e){
    enterMaximize();
    try { toast('Fullscreen not available here — using Maximize.', 'warn', 1800); } catch {}
  }
}
function exitNativeFullscreen(){
  try { document.exitFullscreen?.(); } catch {}
}

function enterMaximize(){
  if (__isMaximized) return;

  try { reallyClosePalette?.(); } catch {}
  try { closeDlMenu?.(); } catch {}
  try { closePresetMenu?.(); } catch {}
  try { hideRotateOverlay?.(); } catch {}

  __scrollYBeforeMax = window.scrollY || 0;
  document.body.classList.add('hp-lock-scroll');
  container.classList.add('is-maximized');
  __isMaximized = true;
  updateFullscreenUI();
}

function exitMaximize(){
  if (!__isMaximized) return;
  container.classList.remove('is-maximized');
  document.body.classList.remove('hp-lock-scroll');

  try {
    window.scrollTo({ top: __scrollYBeforeMax, left: 0 });
  } catch {
    window.scrollTo(0, __scrollYBeforeMax);
  }

  __isMaximized = false;
  updateFullscreenUI();
}

function updateFullscreenUI(){
  const active = inNativeFullscreen() || __isMaximized;
  fullscreenBtn.innerHTML = `<span class="material-icons">${active ? 'fullscreen_exit' : 'fullscreen'}</span>`;
  fullscreenBtn.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Enter fullscreen');
  fullscreenBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
}

fullscreenBtn.onclick = () => {
  if (__isMaximized) { exitMaximize(); return; }
  if (inNativeFullscreen()) { exitNativeFullscreen(); return; }

  if (supportsNativeFullscreen()){
    enterNativeFullscreen();
  } else {
    enterMaximize();
    try { toast('Fullscreen not supported — using Maximize.', 'warn', 1800); } catch {}
  }
};

exitMaxBtn?.addEventListener('click', exitMaximize);

document.addEventListener('fullscreenchange', () => {
  try { reallyClosePalette?.(); } catch {}
  try { closeDlMenu?.(); } catch {}
  try { closePresetMenu?.(); } catch {}
  updateFullscreenUI();
});

window.addEventListener('orientationchange', () => {
  // optional auto-exit logic could go here
}, { passive:true });


resetBtn.onclick = () => {
  controls.reset();
  toast('View reset', 'ok', 900);
};

// full factory reset (parts, colors, vis, camera, state)
factoryResetBtn.onclick = () => {
  resetToFactory();
};

// Randomize
randomizeBtn.onclick = () => {
  for (let p in modelSets) {
    currentIdx[p] = Math.floor(Math.random() * modelSets[p].length);
    loadModel(p);
  }
  markCustomPreset(); // also saves state
  toast('Randomized!', 'ok', 900);
};

/* ==========================================================================
   Preset Menu wiring
   ========================================================================== */
if (presetToggle) {
  presetToggle.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const isOpen = presetMenu && presetMenu.classList.contains('open');
    if (isOpen) closePresetMenu(); else openPresetMenu();
  });
}

presetButtons.forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const key = btn.dataset.preset;
    if (key) applyPreset(key);
    closePresetMenu();
  });
});

document.addEventListener('click', (e) => {
  if (presetMenu && e.target.closest('#preset-menu')) return;
  closePresetMenu();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePresetMenu();
});

/* ==========================================================================
   Toggle Panels (Essential/Advanced) with ARIA
   ========================================================================== */
essBtn.addEventListener('click', () => {
  essPanel.style.display = 'flex';
  advPanel.style.display = 'none';
  essBtn.classList.add('active'); advBtn.classList.remove('active');
  essBtn.setAttribute('aria-selected', 'true'); advBtn.setAttribute('aria-selected', 'false');
  closeAllPalettes();
});
advBtn.addEventListener('click', () => {
  essPanel.style.display = 'none';
  advPanel.style.display = 'flex';
  advBtn.classList.add('active'); essBtn.classList.remove('active');
  advBtn.setAttribute('aria-selected', 'true'); essBtn.setAttribute('aria-selected', 'false');
  closeAllPalettes();
});

function showEssentialPanel() {
  // mirror the same logic as clicking the "Essential" tab
  essPanel.style.display = 'flex';
  advPanel.style.display = 'none';

  essBtn.classList.add('active');
  advBtn.classList.remove('active');

  essBtn.setAttribute('aria-selected', 'true');
  advBtn.setAttribute('aria-selected', 'false');

  closeAllPalettes();
}


/* ==========================================================================
   Delegated Controls: prev/next/visibility/print/download-part
   ========================================================================== */
container.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-role]');
  if (!el) return;
  const role = el.getAttribute('data-role');
  const part = el.getAttribute('data-part');
  if (!part) return;

  let touched = false;

  switch (role) {
    case 'prev': {
      const wasHidden = !partVis[part];
      if (wasHidden) enablePart(part, false); // don't double-toast
      currentIdx[part] = (currentIdx[part] + modelSets[part].length - 1) % modelSets[part].length;
      loadModel(part);
      touched = true;

      // if we just revealed arms or bumper, enforce exclusivity
      if (wasHidden) {
        enforceArmsBumperExclusion(part);
      }
      break;
    }

    case 'next': {
      const wasHidden = !partVis[part];
      if (wasHidden) enablePart(part, false);
      currentIdx[part] = (currentIdx[part] + 1) % modelSets[part].length;
      loadModel(part);
      touched = true;

      if (wasHidden) {
        enforceArmsBumperExclusion(part);
      }
      break;
    }

    case 'visibility': {
      // toggle the part you clicked
      partVis[part] = !partVis[part];
      el.innerHTML = `<span class="material-icons">${partVis[part] ? 'visibility' : 'visibility_off'}</span>`;

      // apply that visibility in the scene
      if (part === 'spacer') {
        if (partVis.spacer) {
          loadModel('spacer');
        } else {
          if (loadedMods.spacer) {
            scene.remove(loadedMods.spacer);
            loadedMods.spacer = null;
          }
        }
        // spacer changes bottom/wheels height
        loadModel('bottom');
        loadModel('wheels');
      } else {
        if (loadedMods[part]) {
          loadedMods[part].visible = partVis[part];
        }
      }

      // 🔒 enforce arms/bumper can't both be visible
      if (partVis[part]) {
        enforceArmsBumperExclusion(part);
      }

      updateComboChip();
      touched = true;
      break;
    }


    case 'print': {
      // Consent Check
      try {
        await showConsentPopup();
      } catch (e) {
        break; // User cancelled
      }

      // OrcaSlicer protocol link
      (function () {
        const url = stepSets[part][currentIdx[part]];
        const a = document.createElement('a');
        a.href = 'orcaslicer://open?file=' + encodeURIComponent(url);
        document.body.appendChild(a);
        a.click();
        a.remove();
      })();
      break;
    }

    case 'download-part': {
      // Consent Check
      try {
        await showConsentPopup();
      } catch (e) {
        break; // User cancelled
      }

      const url = stepSets[part][currentIdx[part]];
      if (!url) {
        toast(`No STEP file available for ${part}`, 'warn', 1800);
        break;
      }

      toast(`Downloading ${part} STEP…`, 'ok', 1200);

      fetch(url, { mode: 'cors' })
        .then(res => {
          if (!res.ok) throw new Error('Network error');
          return res.blob();
        })
        .then(blob => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `${part}.step`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          toast(`${part} STEP downloaded!`, 'ok', 1600);
        })
        .catch(err => {
          console.error(err);
          toast(`Failed to download ${part}.`, 'err', 2200);
        });
      break;
    }
  }

  if (touched) {
    markCustomPreset(); // also saves state
  }
});

/* ==========================================================================
   Color Palettes (floating, bulletproof)
   ========================================================================== */
let openPalette = null;
let openPaletteOriginalParent = null;

function mountPaletteToBody(palette){
  const host = document.fullscreenElement || container || document.body;
  if (palette.parentElement !== host) {
    openPaletteOriginalParent = palette.parentElement;
    host.appendChild(palette);
  }
}
function restorePalette(palette){
  if (openPaletteOriginalParent && openPalette) {
    openPaletteOriginalParent.appendChild(palette);
  }
  openPaletteOriginalParent = null;
}

function positionPalette(palette, anchorRect){
  const pad = 8;

  palette.style.display = 'block';
  palette.classList.add('open');

  palette.querySelectorAll('[data-role="swatch"]').forEach(sw=>{
    sw.style.background = sw.dataset.color;
  });

  const w = palette.offsetWidth || 120;
  const h = palette.offsetHeight || 120;

  const centerX = anchorRect.left + anchorRect.width / 2;
  const belowY  = anchorRect.bottom + pad;
  const aboveY  = anchorRect.top - h - pad;
  const openUp  = (window.innerHeight - anchorRect.bottom) < (h + 16) && anchorRect.top > (h + 16);

  palette.style.position = 'fixed';
  palette.style.left     = Math.max(8, Math.min(centerX - w/2, window.innerWidth - w - 8)) + 'px';
  palette.style.top      = (openUp ? Math.max(8, aboveY) : Math.min(belowY, window.innerHeight - h - 8)) + 'px';
  palette.style.transform= 'none';
  palette.style.zIndex   = String(2147483647);
}

function reallyClosePalette(){
  if (!openPalette) return;
  openPalette.classList.remove('open');
  openPalette.style.display = 'none';
  openPalette.style.position = '';
  openPalette.style.left = '';
  openPalette.style.top = '';
  openPalette.style.transform = '';
  openPalette.style.zIndex = '';
  restorePalette(openPalette);
  openPalette = null;
}

function wirePill(pill){
  pill.addEventListener('click', (e)=>{
    e.preventDefault();
    e.stopPropagation();

    const part = pill.getAttribute('data-part');
    const palette = document.getElementById(`${part}-palette`);

    if (openPalette === palette && palette.classList.contains('open')) {
      reallyClosePalette();
      return;
    }

    reallyClosePalette();

    const rect = pill.getBoundingClientRect();
    mountPaletteToBody(palette);
    positionPalette(palette, rect);
    openPalette = palette;
  });
}

/* Attach listeners to all color pills */
document.querySelectorAll('[data-role="color-pill"]').forEach(wirePill);

/* ---- Color pick inside palette ---- */
function onSwatchPick(e){
  const sw = e.target.closest('.color-palette [data-role="swatch"]');
  if (!sw) return;

  e.preventDefault();
  e.stopImmediatePropagation();

  const part = sw.dataset.part;
  const hex  = sw.dataset.color;

  if (!partVis[part]) enablePart(part, false);

  modelCols[part].set(hex);
  applyColor(part);

  const pill = document.getElementById(`${part}-pill`);
  if (pill){
    pill.style.backgroundColor = hex;
    pill.style.border = hex.toLowerCase() === '#ffffff'
      ? '1px solid #000'
      : '1px solid var(--stroke)';
  }

  markCustomPreset(); // also saves
  reallyClosePalette();
}

document.addEventListener('pointerup', onSwatchPick, { passive: false });

/* Close palettes on true outside click */
document.addEventListener('click', (e)=>{
  if (e.target.closest('.color-palette')) return;
  if (e.target.closest('[data-role="color-pill"]')) return;
  reallyClosePalette();
});

/* ESC closes palette */
document.addEventListener('keydown', (e)=>{
  if (e.key === 'Escape') reallyClosePalette();
});

window.addEventListener('resize', ()=> reallyClosePalette(), { passive:true });
window.addEventListener('scroll', ()=> reallyClosePalette(), { passive:true, capture:true });

/* ==========================================================================
   Download Menu (split) — outside click closes
   ========================================================================== */
function openDlMenu(){
  dlMenu.style.display = 'block';
  dlToggle.setAttribute('aria-expanded','true');
}
function closeDlMenu(){
  dlMenu.style.display = 'none';
  dlToggle.setAttribute('aria-expanded','false');
}

dlPrimary.addEventListener('click', (e)=>{
  e.preventDefault();
  downloadSelection('step');
});

dlToggle.addEventListener('click', (e)=>{
  e.preventDefault();
  e.stopPropagation();
  const isOpen = dlMenu.style.display === 'block';
  if (isOpen) closeDlMenu(); else openDlMenu();
});

dlGlbBtn.addEventListener('click', (e)=>{
  e.preventDefault();
  downloadSelection('glb');
  closeDlMenu();
});
dl3mfBtn.addEventListener('click', (e)=>{
  e.preventDefault();
  downloadSelection('3mf');
  closeDlMenu();
});

/* Only close when clicking truly outside */
document.addEventListener('click', (e)=>{
  if (e.target.closest('#download-group')) return;
  closeDlMenu();
});

/* ESC closes */
document.addEventListener('keydown', (e)=>{
  if(e.key === 'Escape') closeDlMenu();
});


/* ==========================================================================
   Init pills & visibility buttons
   ========================================================================== */
for (let p in modelSets){
  const pill = document.getElementById(`${p}-pill`);
  const hex  = `#${modelCols[p].getHexString()}`;
  if (pill){
    pill.style.backgroundColor = hex;
    pill.style.border = hex.toLowerCase()==='#ffffff' ? '1px solid #000' : '1px solid var(--stroke)';
  }

  const visBtn = document.getElementById(`${p}-visibility`);
  if (visBtn){
    visBtn.innerHTML = `<span class="material-icons">${partVis[p]?'visibility':'visibility_off'}</span>`;
  }
}

/* ==========================================================================
   Keyboard Navigation (arrow keys switch variants)
   ========================================================================== */
container.addEventListener('keydown', (e)=>{
  const section = e.target.closest('.model-section');
  if(!section) return;
  const id = section.id;
  const part = (id || '').replace('-controls','');
  if(!part || !modelSets[part]) return;

  if(e.key === 'ArrowLeft'){
    if (!partVis[part]) enablePart(part, false);
    currentIdx[part] = (currentIdx[part] + modelSets[part].length - 1) % modelSets[part].length;
    loadModel(part);
    markCustomPreset();
    e.preventDefault();
  } else if(e.key === 'ArrowRight'){
    if (!partVis[part]) enablePart(part, false);
    currentIdx[part] = (currentIdx[part] + 1) % modelSets[part].length;
    loadModel(part);
    markCustomPreset();
    e.preventDefault();
  }
});

/* ==========================================================================
   Animate Loop
   ========================================================================== */
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

/* ==========================================================================
   Panel Width Sync
   ========================================================================== */
function adjustControlsWidth() {
  const toggle = document.getElementById('controls-toggle');
  if(!toggle) return;
  const width  = toggle.getBoundingClientRect().width;
  const w = Math.min(Math.max(260, width), container.clientWidth - 24);
  [essPanel, advPanel].forEach(p => p.style.width = `${w}px`);
}
window.addEventListener('resize', adjustControlsWidth, { passive: true });
adjustControlsWidth();

/* ==========================================================================
   Micro-interactions: press effect
   ========================================================================== */
(function pressEffects(){
  const pressables = container.querySelectorAll('.btn, .toggle-btn, #download-primary, #download-toggle');
  pressables.forEach(el=>{
    el.addEventListener('pointerdown', ()=> el.style.transform = 'translateY(0)');
    el.addEventListener('pointerup',   ()=> el.style.transform = '');
    el.addEventListener('pointerleave',()=> el.style.transform = '');
  });
})();

/* ==========================================================================
   Safety stacking / overflow fixes
   ========================================================================== */
(function ensureStacking(){
  let node = container.parentElement;
  let hops = 0;
  while(node && hops < 5){
    const style = window.getComputedStyle(node);
    if(style.overflow !== 'visible' || parseInt(style.zIndex||'0',10) < 1){
      node.style.overflow = 'visible';
      node.style.zIndex = '1';
      node.style.position = node.style.position || 'relative';
    }
    node = node.parentElement; hops++;
  }
})();


/* ==========================================================================
   Guided Tour
   ========================================================================== */
let __tourOpen = false;
let __tourStartTS = 0;
let __autoStartFired = false;
const TOUR_VERSION = 'v104';
const TOUR_STATE_KEY = 'hp_robot_tour_state';
let __tourRunning = false; 

function readTourState(){
  try { return JSON.parse(localStorage.getItem(TOUR_STATE_KEY) || '{}'); }
  catch { return {}; }
}
function writeTourState(s){ localStorage.setItem(TOUR_STATE_KEY, JSON.stringify(s)); }

function shouldAutoStartTour(){
  const s = readTourState();
  if (s.never === true) return false;
  if (s.doneVersion === TOUR_VERSION) return false;
  if (s.remindAt && Date.now() < s.remindAt) return false;
  return true;
}

setTimeout(() => {
  if (__autoStartFired) return;
  __autoStartFired = true;
  if (shouldAutoStartTour()) startTour(false);
}, 700);

function startTour(force = false){
  if (__tourRunning) return;
  if (!force && !shouldAutoStartTour()) return;
  __tourRunning = true;

  const steps = [
    {
      target: '#preset-toggle',
      title: 'Presets',
      body: 'Start from a ready-made configuration. Click to open and pick one.',
      onTry(advance){
        const h = (e)=> {
          if (e.target.closest('.preset-option')) { document.removeEventListener('click', h, true); setTimeout(advance, 400); }
        };
        document.addEventListener('click', h, true);
      }
    },
    {
      target: '#controls-toggle',
      title: 'Panels',
      body: 'Switch between Essential parts and Advanced add-ons.',
      onTry(advance){
        const ids = new Set(['show-essential','show-advanced']);
        const h = (e)=> {
          const id = e.target.id || (e.target.closest('button')?.id);
          if (ids.has(id)) { document.removeEventListener('click', h, true); setTimeout(advance, 300); }
        };
        document.addEventListener('click', h, true);
      }
    },
    {
      target: '#top-pill',
      title: 'Colors',
      body: 'Click the pill to open the palette and pick a color for the Top.',
      onTry(advance){
        const h = (e)=> {
          const sw = e.target.closest('.color-palette [data-role="swatch"][data-part="top"]');
          if (sw){ document.removeEventListener('click', h, true); setTimeout(advance, 300); }
        };
        document.addEventListener('click', h, true);
      }
    },
    {
      target: '#top-controls [data-role="next"]',
      title: 'Variants',
      body: 'Use the arrows to browse different designs of a part.',
      onTry(advance){
        const h = (e)=> {
          const b = e.target.closest('[data-role="next"], [data-role="prev"]');
          if (b){ document.removeEventListener('click', h, true); setTimeout(advance, 300); }
        };
        document.addEventListener('click', h, true);
      }
    },
    {
      target: '#top-visibility',
      title: 'Visibility',
      body: 'Temporarily hide/show a part to see how it affects the build.'
    },
    {
      target: '#top-controls [data-role="print"]',
      title: 'Direct 3D Print',
      body: 'Click the printer icon to open this part directly in OrcaSlicer (uses the orcaslicer:// link).',
      onTry(advance){
        const h = (e)=>{
          const b = e.target.closest('[data-role="print"]');
          if (b){
            document.removeEventListener('click', h, true);
            setTimeout(advance, 500);
          }
        };
        document.addEventListener('click', h, true);
      }
    },
    {
      target: '#download-group',
      title: 'Export',
      body: 'Download STEP instantly, or open the menu for GLB and 3MF.'
    }
  ];

  const tip = document.createElement('div');
  tip.className = 'tour-tip';
  tip.innerHTML = `
  <button class="tour-close" aria-label="Close tour" title="Close">×</button>
  <h5></h5>
  <div class="tour-body"></div>
  <div class="tour-actions">
    <div class="tour-row">
      <div class="tour-spacer"></div>
      <button class="tour-btn" data-act="prev" aria-label="Previous step">Back</button>
      <button class="tour-btn primary" data-act="next" aria-label="Next step">Next</button>
    </div>
    <div class="tour-meta">
      <button class="tour-link" data-act="snooze" aria-label="Remind me later">Remind me later</button>
      <span class="tour-dot" aria-hidden="true">·</span>
      <button class="tour-link" data-act="skip" aria-label="Never show again">Don’t show again</button>
    </div>
  </div>`;

  function tourHost(){
    return document.fullscreenElement || container || document.body;
  }

  tourHost().appendChild(tip);

  function moveTipToHost(){
    const host = tourHost();
    if (tip.isConnected && tip.parentElement !== host){
      host.appendChild(tip);
    }
  }
  document.addEventListener('fullscreenchange', moveTipToHost);

  __tourOpen = true;
  __tourStartTS = Date.now();

  const h5 = tip.querySelector('h5');
  const body = tip.querySelector('.tour-body');
  const btnPrev   = tip.querySelector('[data-act="prev"]');
  const btnNext   = tip.querySelector('[data-act="next"]');
  const btnSkip   = tip.querySelector('[data-act="skip"]');
  const btnSnooze = tip.querySelector('[data-act="snooze"]');
  const btnClose  = tip.querySelector('.tour-close');

  let i = 0, highlighted = null, resizeTO = null;

  function highlight(el){
    if (highlighted) highlighted.classList.remove('tour-highlight');
    highlighted = el;
    if (highlighted) highlighted.classList.add('tour-highlight');
  }

  function placeTipNear(target){
    const r = target.getBoundingClientRect();
    tip.style.visibility = 'hidden';
    tip.style.left = '0px'; tip.style.top = '0px';
    requestAnimationFrame(()=>{
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let top = r.bottom + 10;
      let left = Math.min(Math.max(r.left, 8), window.innerWidth - tw - 8);
      if (top + th > window.innerHeight - 8) top = r.top - th - 10;
      if (top < 8) top = Math.min(window.innerHeight - th - 8, Math.max(8, r.bottom + 10));
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
      tip.style.visibility = 'visible';
    });
  }

  function show(){
    // Steps 2,3,4,5 of the tour talk about part controls that live
    // in the Essential panel (top-pill, next arrow, visibility, print).
    // If the user switched to Advanced in step 1 or 2, Essential might be hidden.
    // Force Essential back on so we can measure correct positions.
    if (i >= 2 && i <= 5) {
      showEssentialPanel();
    }

    const step = steps[i];
    const target = (typeof step.target === 'function')
      ? step.target()
      : document.querySelector(step.target);

    // If for some reason the element isn't there, skip forward.
    if (!target){
      next();
      return;
    }

    h5.textContent = step.title;
    body.textContent = step.body;

    highlight(target);
    placeTipNear(target);

    btnPrev.disabled = (i === 0);
    btnNext.textContent = (i === steps.length - 1) ? 'Finish' : 'Next';

    if (typeof step.onTry === 'function'){
      step.onTry(next);
    }
  }


  function end({saveDone=false, never=false, snoozeDays=0, reason='other'} = {}){
    __tourOpen = false;
    __tourRunning = false;
    document.removeEventListener('fullscreenchange', moveTipToHost);

    if (highlighted) highlighted.classList.remove('tour-highlight');
    tip.remove();
    window.removeEventListener('resize', onResizeTour, {passive:true});
    document.removeEventListener('keydown', onKey);

    const s = readTourState();
    if (never){
      s.never = true;
    } else if (snoozeDays > 0){
      const dayMs = 24*60*60*1000;
      s.remindAt = Date.now() + snoozeDays*dayMs;
    } else if (saveDone){
      s.doneVersion = TOUR_VERSION;
      s.remindAt = 0;
    }
    writeTourState(s);

    const ranLongEnough = (Date.now() - __tourStartTS) > 500;
    const userEnd = (reason === 'finish' || reason === 'close' || reason === 'escape');
    if (saveDone && userEnd && ranLongEnough){
      toast('You can reopen the tour from the Info button.', 'ok', 1800);
    }
  }

  function next(){
    if (i < steps.length - 1){ i++; show(); } else { end({saveDone:true, reason:'finish'}); }
  }
  function prev(){
    if (i > 0){ i--; show(); }
  }

  function onResizeTour(){
    clearTimeout(resizeTO);
    resizeTO = setTimeout(()=> {
      const step = steps[i];
      const target = typeof step.target === 'function' ? step.target() : document.querySelector(step.target);
      if (target) placeTipNear(target);
    }, 80);
  }
  function onKey(e){
    if (e.key === 'Escape'){ end({saveDone:true, reason:'escape'}); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter'){ next(); }
    else if (e.key === 'ArrowLeft'){ prev(); }
  }

  btnNext.addEventListener('click', ()=>{
    if (i < steps.length - 1){ i++; show(); } else { end({saveDone:true, reason:'finish'}); }
  });
  btnPrev.addEventListener('click', ()=> { if (i > 0){ i--; show(); } });
  btnSnooze.addEventListener('click', ()=> end({snoozeDays:30, reason:'snooze'}));
  btnSkip.addEventListener('click',   ()=> end({never:true,      reason:'skip'}));
  btnClose.addEventListener('click', ()=> end({saveDone:true, reason:'close'}));

  window.addEventListener('resize', onResizeTour, {passive:true});
  document.addEventListener('keydown', onKey);

  show();
}

// “Quick tour” link in Info tooltip
document.getElementById('startTourLink')?.addEventListener('click', (e)=>{
  e.preventDefault(); startTour(true);
});

// Save initial state snapshot so even first-time guests have something stored
saveStateToLocal();

  </script>
  <?php
  return ob_get_clean();
});