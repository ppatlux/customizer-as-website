// "Send to PrusaSlicer / EasyPrint" via Prusa's anonymous import endpoint —
// the same approach as https://github.com/gzeus/3D-Ghost-Generator. The STL is
// POSTed straight from the browser (the endpoint answers CORS with `*`, so no
// backend of ours is involved) and Prusa replies with two links to its own
// temporary copy:
//   easyprint_url   — https://www.printables.com/slice?... (browser slicer)
//   prusaslicer_url — prusaslicer://open?file=https://slicer.printables.com/import/temp/...
// Because the file then lives on Prusa's domain, prusaslicer:// accepts it
// without hprobots.com being on PrusaSlicer's download allowlist. The same
// temporary copy also serves OrcaSlicer (orcaslicer://open takes any URL) for
// files that only exist in the browser, like a whole-build 3MF. Links expire
// after 30 minutes; uploads are capped at 100 MB.

import { canOpenDesktopSlicer } from './slicer-preference.js';

// Matches print-build.js COMMON_SLOT_LIMIT (kept separate so this module
// doesn't pull in three.js just for a number).
const COMMON_SLOT_LIMIT = 5;

const IMPORT_URL = 'https://slicer.printables.com/import';
const MAX_BYTES = 100 * 1000 * 1000;
const SOURCE_NAME = 'HP Robots Customizer';
// Reuse an upload for repeat clicks on the same file, a bit under Prusa's
// 30-minute link lifetime so a cached link never hands off an expired file.
const CACHE_MS = 25 * 60 * 1000;

const uploadCache = new Map();

export function uploadToPrusa(file, { signal, onProgress = () => {}, sourceUrl } = {}) {
  if (file.size > MAX_BYTES) {
    return Promise.reject(new Error('Prusa accepts models up to 100 MB. Download the STL instead.'));
  }

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Cancelled', 'AbortError'));
      return;
    }

    // XHR rather than fetch() — fetch can't report upload progress.
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const finish = (callback, value) => {
      signal?.removeEventListener('abort', abort);
      callback(value);
    };

    xhr.open('POST', IMPORT_URL);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.timeout = 120000;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress((event.loaded / event.total) * 100);
    };
    xhr.onload = () => {
      try {
        const json = JSON.parse(xhr.responseText);
        if (xhr.status < 200 || xhr.status >= 300) {
          throw new Error(json.error === 'file-too-large'
            ? 'Prusa accepts models up to 100 MB.'
            : `Prusa upload failed (${json.error || xhr.status}). Please retry.`);
        }
        json.file_url = assertPrusaDestinations(json);
        finish(resolve, json);
      } catch (error) {
        finish(reject, error instanceof SyntaxError ? new Error('Prusa sent an unreadable reply. Please retry.') : error);
      }
    };
    xhr.onerror = () => finish(reject, new Error('Could not reach Prusa. Check your connection and retry.'));
    xhr.ontimeout = () => finish(reject, new Error('Prusa upload timed out. Please retry.'));
    xhr.onabort = () => finish(reject, new DOMException('Cancelled', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });

    const form = new FormData();
    form.append('file', file, file.name);
    form.append('file_source_name', SOURCE_NAME);
    if (sourceUrl) form.append('file_source_url', sourceUrl);
    xhr.send(form);
  });
}

// Only ever navigate to destinations that are really Prusa's — the reply is
// followed blindly otherwise (window.open / a custom-protocol link click).
// Returns the validated temporary file URL.
function assertPrusaDestinations(json) {
  const easyprint = new URL(json.easyprint_url);
  const slicer = new URL(json.prusaslicer_url);
  const fileUrl = new URL(slicer.searchParams.get('file'));
  if (easyprint.origin !== 'https://www.printables.com' || easyprint.pathname !== '/slice' ||
      slicer.protocol !== 'prusaslicer:' || slicer.hostname !== 'open' ||
      fileUrl.origin !== 'https://slicer.printables.com' || !fileUrl.pathname.startsWith('/import/temp/')) {
    throw new Error('Prusa returned an unexpected destination. Please retry.');
  }
  return fileUrl.href;
}

const TARGETS = {
  prusa: { label: 'PrusaSlicer', href: (json) => json.prusaslicer_url },
  easyprint: { label: 'EasyPrint', href: (json) => json.easyprint_url },
  orca: { label: 'OrcaSlicer', href: (json) => `orcaslicer://open?file=${encodeURIComponent(json.file_url)}` }
};

// Drives #prusa-overlay (index.html) through upload → handoff. `target` is
// 'prusa' | 'easyprint' | 'orca'; `title` overrides the dialog heading (e.g.
// a whole build vs one part). `getFile` resolves to a File, or to
// { file, slots, fitsBed } to list the filament slots (colour per slot) in
// the dialog and warn when the pieces don't fit one 25 x 21 cm bed.
// `getFile` is
// only called on a cache miss; `cacheKey` should identify the exact geometry
// being sent (e.g. the hosted STL URL). Resolves once the dialog is done with,
// whether the handoff succeeded, failed or was cancelled — errors are shown
// via `onError`, never thrown.
let activeController = null;

export async function sendToPrusa({ target, title: heading, cacheKey, getFile, onSuccess = () => {}, onError = () => {} }) {
  if (activeController) return;

  const overlay = document.getElementById('prusa-overlay');
  const title = document.getElementById('prusa-title');
  const statusEl = document.getElementById('prusa-status');
  const progress = document.getElementById('prusa-progress');
  const cancelBtn = document.getElementById('prusa-cancel');
  const continueLink = document.getElementById('prusa-continue');
  const slotsEl = document.getElementById('prusa-slots');
  const isEasyPrint = target === 'easyprint';
  const { label, href: hrefFor } = TARGETS[target] || TARGETS.prusa;

  const controller = new AbortController();
  activeController = controller;
  let uploading = true;

  const close = () => {
    overlay.classList.remove('show');
    overlay.removeEventListener('keydown', onKeydown);
    cancelBtn.removeEventListener('click', onCancel);
    continueLink.removeEventListener('click', close);
    if (activeController === controller) activeController = null;
  };
  // While uploading, Cancel/Escape abort the request (which closes the
  // dialog via the AbortError path below); afterwards they just close it.
  const onCancel = () => {
    if (uploading) controller.abort();
    else close();
  };
  const onKeydown = (event) => {
    if (event.key === 'Escape') onCancel();
  };

  title.textContent = heading || `Sending to ${label}`;
  statusEl.textContent = 'Preparing…';
  progress.hidden = false;
  progress.value = 0;
  continueLink.hidden = true;
  if (slotsEl) { slotsEl.hidden = true; slotsEl.replaceChildren(); }
  cancelBtn.textContent = 'Cancel';
  overlay.addEventListener('keydown', onKeydown);
  cancelBtn.addEventListener('click', onCancel);
  overlay.classList.add('show');
  overlay.focus();

  try {
    const cached = cacheKey && getCachedUpload(cacheKey);
    let json = cached?.json;
    let slots = cached?.slots;
    let fitsBed = cached?.fitsBed;
    if (!json) {
      const made = await getFile();
      const file = made instanceof Blob ? made : made.file;
      slots = made instanceof Blob ? null : made.slots;
      fitsBed = made instanceof Blob ? undefined : made.fitsBed;
      statusEl.textContent = 'Uploading to Printables (Prusa)… 0%';
      json = await uploadToPrusa(file, {
        signal: controller.signal,
        sourceUrl: /^https?:$/.test(location.protocol) ? location.origin + location.pathname : undefined,
        onProgress: (percent) => {
          progress.value = percent;
          statusEl.textContent = percent >= 100
            ? 'Preparing your model…'
            : `Uploading to Printables (Prusa)… ${Math.round(percent)}%`;
        }
      });
      if (cacheKey) uploadCache.set(cacheKey, { json, slots, fitsBed, expires: Date.now() + CACHE_MS });
    }
    showSlots(slotsEl, slots, fitsBed);

    const href = hrefFor(json);
    continueLink.href = href;
    continueLink.target = isEasyPrint ? '_blank' : '_self';
    continueLink.rel = isEasyPrint ? 'noopener noreferrer' : '';
    continueLink.textContent = isEasyPrint ? 'Continue to EasyPrint' : `Open ${label}`;
    uploading = false;
    progress.hidden = true;
    cancelBtn.textContent = 'Done';
    activeController = null;
    onSuccess(label);

    if (isEasyPrint && !canOpenDesktopSlicer()) {
      // Phones/tablets: no window.open — mobile browsers block it once the
      // upload's await has spent the tap's user activation, and only a link
      // the user actually taps can be handed to an app that claims
      // printables.com links. So go straight to the Continue button.
      statusEl.textContent = 'Ready! Tap the button to open it in EasyPrint. The link expires in 30 minutes.';
    } else if (isEasyPrint) {
      // The upload's await usually costs the click's user activation, so a
      // popup blocker may eat this — the Continue link stays as the fallback.
      const win = window.open(href, '_blank');
      if (win) {
        win.opener = null;
        close();
        return;
      }
      statusEl.textContent = 'Ready. Your browser blocked the new tab — use the button below. The link expires in 30 minutes.';
    } else {
      // A custom-protocol launch can't be detected, so keep the dialog up with
      // a real link in case the browser swallowed it or PrusaSlicer is missing.
      continueLink.click();
      statusEl.textContent = `Opening ${label}… If nothing happened, use the button below (${label} must be installed on this computer). The link expires in 30 minutes.`;
    }
    continueLink.hidden = false;
    continueLink.addEventListener('click', close);
  } catch (error) {
    close();
    if (error?.name !== 'AbortError') onError(error);
  }
}

// Colour legend: which filament goes in which slot. Only worth showing when
// there is more than one colour (one colour = any single-filament printer).
function showSlots(el, slots, fitsBed) {
  if (!el) return;
  if (fitsBed === false) {
    const note = document.createElement('p');
    note.className = 'prusa-slots-warn';
    note.textContent = "Too many pieces for one 25 x 21 cm bed — in the slicer, press Arrange (A) or print in batches.";
    el.append(note);
    el.hidden = false;
  }
  if (!slots || slots.length < 2) return;
  const title = document.createElement('p');
  title.className = 'prusa-slots-title';
  title.textContent = 'Load these filaments for a multi-colour print:';
  const list = document.createElement('ol');
  for (const { slot, hex, name } of slots) {
    const item = document.createElement('li');
    const swatch = document.createElement('span');
    swatch.className = 'prusa-slot-swatch';
    swatch.style.background = hex;
    item.append(swatch, `Slot ${slot}: ${name}`);
    list.append(item);
  }
  el.append(title, list);
  if (slots.length > COMMON_SLOT_LIMIT) {
    const warn = document.createElement('p');
    warn.className = 'prusa-slots-warn';
    warn.textContent = `${slots.length} colours — most multi-material printers hold ${COMMON_SLOT_LIMIT}. Merge some slots in the slicer.`;
    el.append(warn);
  }
  el.hidden = false;
}

function getCachedUpload(cacheKey) {
  const entry = uploadCache.get(cacheKey);
  if (!entry) return null;
  if (entry.expires > Date.now()) return entry;
  uploadCache.delete(cacheKey);
  return null;
}
