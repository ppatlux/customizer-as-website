// Single kill switch for the whole PrusaSlicer integration. hprobots.com has
// been approved for PrusaSlicer's download allowlist, but the change only
// takes effect once Prusa actually ships the PrusaSlicer release containing
// it (ETA a month or two out as of writing) — until then, a prusaslicer://
// link from this domain 404s in every installed copy. Every other file in
// this feature (Settings menu, print-button branding, the role === 'print'
// branch in app.js) is safe to commit and deploy alongside unrelated work
// right now: as long as this stays false, behavior is identical to the old
// OrcaSlicer-only build — PrusaSlicer just shows up disabled/"coming soon" in
// the Settings menu as a preview. Flip this to true and redeploy once the
// PrusaSlicer release is confirmed out; that one-line change is the entire
// "go live" step. See README "Send to Slicer".
export const PRUSA_SLICER_LIVE = false;

const STORAGE_KEY = 'hprobot:preferredSlicer';
// PrusaSlicer is the priority default once PRUSA_SLICER_LIVE flips to true.
const DEFAULT_SLICER = PRUSA_SLICER_LIVE ? 'prusa' : 'orca';

export const SLICER_LABELS = {
  prusa: 'PrusaSlicer',
  orca: 'OrcaSlicer'
};

export function getPreferredSlicer() {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  // Belt-and-suspenders: even a stale 'prusa' value left over from local
  // testing (or someone poking localStorage directly) can't resurrect the
  // integration before PRUSA_SLICER_LIVE says it's actually safe to.
  if (stored === 'prusa' && !PRUSA_SLICER_LIVE) return 'orca';
  return SLICER_LABELS[stored] ? stored : DEFAULT_SLICER;
}

export function setPreferredSlicer(slicer) {
  if (!SLICER_LABELS[slicer]) return;
  if (slicer === 'prusa' && !PRUSA_SLICER_LIVE) return;
  window.localStorage.setItem(STORAGE_KEY, slicer);
}
