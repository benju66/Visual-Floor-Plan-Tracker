import { get, set, del } from 'idb-keyval';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';

interface AsyncStorage {
  getItem: (key: string) => Promise<string | null | undefined>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}

const idbStorage: AsyncStorage = {
  getItem: async (key: string) => await get<string>(key),
  setItem: async (key: string, value: string) => await set(key, value),
  removeItem: async (key: string) => await del(key),
};

export const persister = createAsyncStoragePersister({
  storage: idbStorage,
  // We can customize throttle time, default is 1000ms
  // throttleTime: 1000,
});
