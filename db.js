// Storage layer for FindNotes: thin promise wrappers over IndexedDB.
const DB_NAME = 'find-notes';
const DB_VERSION = 1;

let dbPromise;

export function openDB() {
  dbPromise ??= new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    // Runs for a brand new database, and again whenever DB_VERSION goes up.
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (event.oldVersion < 1) {
        db.createObjectStore('lists', { keyPath: 'id' });
        db.createObjectStore('items', { keyPath: 'id' }).createIndex('listId', 'listId');
        db.createObjectStore('versions', { keyPath: 'id' }).createIndex('itemId', 'itemId');
      }
      // Later schema changes go here, for example:
      // if (event.oldVersion < 2) { ... }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch((error) => {
    dbPromise = undefined; // don't cache a failure, or "try again" could never work
    throw error;
  });

  return dbPromise;
}

// Runs one transaction. `work` receives the transaction and returns a request
// (or nothing). We resolve on tx.oncomplete, which means "committed".
async function run(storeNames, mode, work) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    let request;
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);

    try {
      request = work(tx);
    } catch (error) {
      // If a write throws part-way, the ones before it would still commit.
      // Abort so a batch really is all or nothing.
      reject(error);
      tx.abort();
    }
  });
}

export const getAll = (store) =>
  run(store, 'readonly', (tx) => tx.objectStore(store).getAll());

export const getByIndex = (store, index, key) =>
  run(store, 'readonly', (tx) => tx.objectStore(store).index(index).getAll(key));

// put() creates the record, or replaces it if the id already exists.
export const put = (store, record) =>
  run(store, 'readwrite', (tx) => tx.objectStore(store).put(record));

export const remove = (store, id) =>
  run(store, 'readwrite', (tx) => tx.objectStore(store).delete(id));

// Several writes in ONE transaction: they all happen, or none of them do.
// put: [[store, record], ...]   remove: [[store, id], ...]
export function batch({ put: puts = [], remove: removes = [] }) {
  const stores = [...new Set([...puts, ...removes].map(([store]) => store))];
  if (!stores.length) return Promise.resolve();

  return run(stores, 'readwrite', (tx) => {
    for (const [store, record] of puts) tx.objectStore(store).put(record);
    for (const [store, id] of removes) tx.objectStore(store).delete(id);
  });
}

// Deletes the whole database, every list and note. The app reloads afterwards and starts fresh.
export async function resetDB() {
  const open = dbPromise;
  dbPromise = undefined;
  if (open) {
    try { (await open).close(); } catch { /* it never opened, which may be why we're here */ }
  }
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('FindNotes is still open somewhere else'));
  });
}

export const uid = () =>
  globalThis.crypto?.randomUUID
    ? crypto.randomUUID()
    : 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);