// Preferred slicer for every "Print" button. PrusaSlicer and EasyPrint both go
// through Prusa's anonymous upload endpoint (see prusa-export.js): the STL is
// re-hosted on slicer.printables.com, which is already on PrusaSlicer's
// prusaslicer:// allowlist, so this no longer waits on hprobots.com being
// added to it. OrcaSlicer's orcaslicer://open has no allowlist and still opens
// our own hosted URL directly. See README "Send to Slicer".
const STORAGE_KEY = 'hprobot:preferredSlicer';
const DEFAULT_SLICER = 'prusa';

export const SLICER_LABELS = {
  prusa: 'PrusaSlicer',
  easyprint: 'EasyPrint',
  orca: 'OrcaSlicer'
};

export function getPreferredSlicer() {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return SLICER_LABELS[stored] ? stored : DEFAULT_SLICER;
}

// Phones and tablets can't run PrusaSlicer/OrcaSlicer, but EasyPrint (a web
// slicer on printables.com) works there. Touch *laptops* still can, so this
// keys off the platform, not touch support. iPadOS reports itself as a Mac,
// hence the maxTouchPoints check (no Mac has a touchscreen).
export function canOpenDesktopSlicer() {
  const ua = navigator.userAgent;
  return !/Android|iPhone|iPad|iPod/i.test(ua) && !(/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

// The slicer a Print button actually uses: the preference on desktop,
// always EasyPrint on phones/tablets.
export function getEffectiveSlicer() {
  return canOpenDesktopSlicer() ? getPreferredSlicer() : 'easyprint';
}

export function setPreferredSlicer(slicer) {
  if (!SLICER_LABELS[slicer]) return;
  window.localStorage.setItem(STORAGE_KEY, slicer);
}
