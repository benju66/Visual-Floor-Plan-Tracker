import { get, set, del } from 'idb-keyval';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';

/**
 * Creates an IndexedDB AsyncStorage wrapper adhering to React Query's storage interface.
 */
const idbStorage = {
  getItem: async (key) => {
    return await get(key);
  },
  setItem: async (key, value) => {
    await set(key, value);
  },
  removeItem: async (key) => {
    await del(key);
  },
};

export const persister = createAsyncStoragePersister({
  storage: idbStorage,
  // We can customize throttle time, default is 1000ms
  // throttleTime: 1000,
});
