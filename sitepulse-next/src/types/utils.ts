import type { TemporalState } from './domain';

export type Updater<T> = T | ((prev: T) => T);

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export const TEMPORAL_ORDER: Record<TemporalState, number> = {
  planned: 0,
  ongoing: 1,
  completed: 2,
  none: 3,
};
