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

export function setPreferredSlicer(slicer) {
  if (!SLICER_LABELS[slicer]) return;
  window.localStorage.setItem(STORAGE_KEY, slicer);
}
