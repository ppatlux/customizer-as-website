// Saved builds ("My builds" panel in app.js).
//
// app.js never touches storage directly — it talks to whichever *store* is
// active through the async interface below. Today that's always the local
// store (this browser only). The interface is deliberately the same shape a
// server-backed store would have, so adding sign-in later (e.g. the
// app.hprobots.com Firebase account) is: write a remote store with these five
// methods, call setBuildStore() with it after login, and setBuildStore(local)
// again on logout. Nothing in app.js has to change. See "Saved builds" in
// README.md for the plan.
//
// Store interface (every method returns a Promise):
//   list()            -> BuildRecord[], newest first (updatedAt desc)
//   get(id)           -> BuildRecord | null
//   put(record)       -> BuildRecord   create or replace by record.id
//   remove(id)        -> void
//   subscribe(fn)     -> unsubscribe()  fn() whenever the list may have changed
//                                       from outside this page (other tab,
//                                       server push…); optional for a store
//   kind              -> 'local' | 'remote' (sync, for UI copy)
//
// BuildRecord:
//   id          string   client-generated UUID — stable across devices, so a
//                        local record keeps its identity when it's uploaded
//   name        string
//   state       object   exactly what getShareState() in app.js produces (the
//                        same shape share links encode), never app internals
//   thumbnail   string   small image data URL ('' if capture failed)
//   createdAt   number   ms epoch
//   updatedAt   number   ms epoch — last-write-wins when merging local and
//                        remote copies of the same id
//   v           number   record schema version (BUILD_RECORD_VERSION)

export const BUILD_RECORD_VERSION = 1;

const LOCAL_KEY = 'hp_robot_saved_builds';

// localStorage is ~5 MB per origin and shared with the rest of the app; each
// record is ~10-30 KB (mostly its thumbnail). The cap keeps a long-time user
// well clear of the quota instead of failing on save #200.
export const MAX_LOCAL_BUILDS = 60;

export function newBuildId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  // Fallback for non-secure contexts (plain http on a LAN test box).
  return 'b-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function sortNewestFirst(records) {
  return records.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function isValidRecord(record) {
  return record && typeof record.id === 'string' && record.state && typeof record.state === 'object';
}

export function createLocalBuildStore(storage = globalThis.localStorage) {
  const read = () => {
    try {
      const parsed = JSON.parse(storage.getItem(LOCAL_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.filter(isValidRecord) : [];
    } catch {
      return [];
    }
  };

  // Throws a QuotaExceededError (DOMException) when storage is full — callers
  // surface that as a "delete some builds" message instead of losing data.
  const write = (records) => {
    storage.setItem(LOCAL_KEY, JSON.stringify(records));
  };

  return {
    kind: 'local',

    async list() {
      return sortNewestFirst(read());
    },

    async get(id) {
      return read().find((record) => record.id === id) || null;
    },

    async put(record) {
      if (!isValidRecord(record)) throw new Error('Invalid build record');
      const records = read();
      const index = records.findIndex((existing) => existing.id === record.id);
      if (index === -1 && records.length >= MAX_LOCAL_BUILDS) {
        const error = new Error(`You can keep up to ${MAX_LOCAL_BUILDS} builds. Delete one to save a new one.`);
        error.code = 'limit';
        throw error;
      }
      if (index === -1) records.push(record);
      else records[index] = record;
      write(records);
      return record;
    },

    async remove(id) {
      write(read().filter((record) => record.id !== id));
    },

    // Another tab saving/deleting fires a 'storage' event here (never in the
    // tab that made the change), so open panels stay in sync.
    subscribe(fn) {
      const onStorage = (event) => {
        if (event.key === LOCAL_KEY || event.key === null) fn();
      };
      window.addEventListener('storage', onStorage);
      return () => window.removeEventListener('storage', onStorage);
    }
  };
}

// ---------------------------------------------------------------------------
// Active store + change notifications

const localStore = createLocalBuildStore();
let activeStore = localStore;
let unsubscribeStore = null;
const listeners = new Set();

function emitChange() {
  listeners.forEach((fn) => {
    try { fn(); } catch (error) { console.error(error); }
  });
}

function attach(store) {
  unsubscribeStore?.();
  unsubscribeStore = typeof store.subscribe === 'function' ? store.subscribe(emitChange) : null;
}
attach(activeStore);

export function getLocalBuildStore() {
  return localStore;
}

export function getBuildStore() {
  return activeStore;
}

// Swap the backing store (e.g. to a signed-in user's remote store, and back
// to getLocalBuildStore() on sign-out). Listeners re-render from the new one.
export function setBuildStore(store) {
  activeStore = store || localStore;
  attach(activeStore);
  emitChange();
}

// fn() runs after any save/rename/delete made through this module, after a
// store swap, and when the store itself reports an outside change.
export function onBuildsChanged(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------------------------------------------------------------------------
// Operations the UI uses (thin wrappers that stamp timestamps + notify)

export async function listBuilds() {
  return activeStore.list();
}

// `extra` carries app-specific fields stored alongside (app.js: `preset`).
export async function createBuild({ name, state, thumbnail, ...extra }) {
  const now = Date.now();
  const record = await activeStore.put({
    ...extra,
    id: newBuildId(),
    name: cleanName(name),
    state,
    thumbnail: thumbnail || '',
    createdAt: now,
    updatedAt: now,
    v: BUILD_RECORD_VERSION
  });
  emitChange();
  return record;
}

// Overwrite an existing build's contents (and optionally its name/thumbnail).
export async function updateBuild(id, changes) {
  const existing = await activeStore.get(id);
  if (!existing) throw new Error('That build no longer exists.');
  const record = await activeStore.put({
    ...existing,
    ...changes,
    name: cleanName(changes.name ?? existing.name),
    id,
    updatedAt: Date.now(),
    v: BUILD_RECORD_VERSION
  });
  emitChange();
  return record;
}

export async function deleteBuild(id) {
  await activeStore.remove(id);
  emitChange();
}

export async function getBuild(id) {
  return activeStore.get(id);
}

export function cleanName(name) {
  const trimmed = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return trimmed || 'My robot';
}
