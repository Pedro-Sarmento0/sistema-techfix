export type StoreName = 'admin' | 'clients' | 'tickets' | 'audit';

export type AuditEntry = {
  id: string;
  entity: 'admin' | 'client' | 'ticket' | 'system';
  action: 'create' | 'update' | 'delete' | 'login' | 'logout' | 'migrate' | 'backup';
  title: string;
  description: string;
  actor: string;
  createdAt: string;
  snapshot?: unknown;
};

const DB_NAME = 'techfix-operational-database';
const DB_VERSION = 1;

let connection: Promise<IDBDatabase> | null = null;

function createId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function openDatabase() {
  if (connection) return connection;

  connection = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('admin')) db.createObjectStore('admin', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('clients')) db.createObjectStore('clients', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('tickets')) db.createObjectStore('tickets', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('audit')) db.createObjectStore('audit', { keyPath: 'id' });
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return connection;
}

async function withStore<T>(storeName: StoreName, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await openDatabase();

  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const request = run(store);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

export function getRecord<T>(storeName: StoreName, id: string) {
  return withStore<T | undefined>(storeName, 'readonly', store => store.get(id));
}

export function getAllRecords<T>(storeName: StoreName) {
  return withStore<T[]>(storeName, 'readonly', store => store.getAll());
}

export async function putRecord<T extends { id: string }>(storeName: StoreName, value: T) {
  await withStore<IDBValidKey>(storeName, 'readwrite', store => store.put(value));
  return value;
}

export function deleteRecord(storeName: StoreName, id: string) {
  return withStore<undefined>(storeName, 'readwrite', store => store.delete(id));
}

export async function writeAudit(entry: Omit<AuditEntry, 'id' | 'createdAt'> & Partial<Pick<AuditEntry, 'id' | 'createdAt'>>) {
  const saved: AuditEntry = {
    id: entry.id ?? createId(),
    createdAt: entry.createdAt ?? new Date().toISOString(),
    ...entry,
  };

  await putRecord('audit', saved);
  return saved;
}
