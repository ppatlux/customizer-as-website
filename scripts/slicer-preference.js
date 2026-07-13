const STORAGE_KEY = 'hprobot:preferredSlicer';
const DEFAULT_SLICER = 'orca';

export const SLICER_LABELS = {
  orca: 'OrcaSlicer',
  prusa: 'PrusaSlicer'
};

export function getPreferredSlicer() {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return SLICER_LABELS[stored] ? stored : DEFAULT_SLICER;
}

export function setPreferredSlicer(slicer) {
  if (!SLICER_LABELS[slicer]) return;
  window.localStorage.setItem(STORAGE_KEY, slicer);
}
