import { defaults, type Stores, type Settings } from './types';
export const DATABASE_NAME = 'context-carry';
export const DATABASE_VERSION = 1;
const names: (keyof Stores)[] = ['contexts', 'notes', 'tasks', 'transcripts', 'meetings', 'absences', 'settings', 'outbox'];
let connection: Promise<IDBDatabase> | undefined;
export function openDatabase(): Promise<IDBDatabase> {
  connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      for (const name of names) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: 'id' });
    };
    request.onerror = () => { connection = undefined; reject(request.error); };
    request.onblocked = () => { connection = undefined; reject(new Error('Close older extension views to upgrade local storage.')); };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); connection = undefined; };
      resolve(db);
    };
  });
  return connection;
}
export async function all<K extends keyof Stores>(store: K): Promise<Stores[K][]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const request = tx.objectStore(store).getAll();
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Local read failed.'));
  });
}
export async function get<K extends keyof Stores>(store: K, id: string): Promise<Stores[K] | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const request = tx.objectStore(store).get(id);
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Local read failed.'));
  });
}
export type Write = { [K in keyof Stores]: { store: K; value: Stores[K] } }[keyof Stores];
export async function writeBatch(writes: Write[]): Promise<void> {
  if (!writes.length) return;
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([...new Set(writes.map(w => w.store))], 'readwrite', { durability: 'strict' });
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Local save failed. Nothing was confirmed saved.'));
    try { for (const write of writes) tx.objectStore(write.store).put(write.value); }
    catch (error) { tx.abort(); reject(error); }
  });
}
export async function put<K extends keyof Stores>(store: K, value: Stores[K]) { await writeBatch([{ store, value } as Write]); }
export async function settings(): Promise<Settings> {
  return { ...defaults, ...((await get('settings', 'preferences'))?.value as Partial<Settings> | undefined) };
}
