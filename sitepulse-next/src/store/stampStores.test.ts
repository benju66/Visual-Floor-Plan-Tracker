import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore } from './useSettingsStore';
import { useMapStore } from './useMapStore';
import { EMPTY_STAMP_LIBRARY, RECENTS_CAP, type StampDef } from '@/utils/stampLibrary';
import { IDENTITY_STAMP_TRANSFORM } from '@/utils/stampTransform';
import type { PercentPoint } from '@/types/domain';

// Integration coverage for the Phase-2 store wiring (the pure ops are covered in
// stampLibrary.test.ts). Confirms the persisted `stampLibrary` slice mutates correctly
// through the real store and that `armStamp` sets the transient tool state atomically.

const square = (offset = 0): PercentPoint[] => [
  { pctX: -0.1 + offset, pctY: -0.1 },
  { pctX: 0.1 + offset, pctY: -0.1 },
  { pctX: 0.1 + offset, pctY: 0.1 },
  { pctX: -0.1 + offset, pctY: 0.1 },
];

const stamp = (id: string, points: PercentPoint[], name = id): StampDef => ({
  id,
  name,
  points,
  createdAt: '2026-07-04T00:00:00.000Z',
});

describe('useSettingsStore — stampLibrary slice', () => {
  beforeEach(() => {
    useSettingsStore.setState({ stampLibrary: EMPTY_STAMP_LIBRARY });
  });

  it('pushRecentStamp prepends, de-dupes by shape, and caps', () => {
    const { pushRecentStamp } = useSettingsStore.getState();
    pushRecentStamp(stamp('a', square(0.1)));
    pushRecentStamp(stamp('b', square(0.2)));
    pushRecentStamp(stamp('a2', square(0.1))); // same shape as "a"
    let recents = useSettingsStore.getState().stampLibrary.recents;
    expect(recents.map((r) => r.id)).toEqual(['a2', 'b']);

    for (let i = 0; i < RECENTS_CAP + 3; i += 1) pushRecentStamp(stamp(`x${i}`, square(i + 1)));
    recents = useSettingsStore.getState().stampLibrary.recents;
    expect(recents).toHaveLength(RECENTS_CAP);
  });

  it('save / rename / remove round-trip through the saved list', () => {
    const s = useSettingsStore.getState();
    s.saveStampToLibrary(stamp('a', square(), 'Kitchen'));
    s.saveStampToLibrary(stamp('b', square(0.3), 'Bath'));
    expect(useSettingsStore.getState().stampLibrary.saved.map((x) => x.id)).toEqual(['b', 'a']);

    s.renameSavedStamp('a', 'Kitchenette');
    expect(useSettingsStore.getState().stampLibrary.saved.find((x) => x.id === 'a')?.name).toBe('Kitchenette');

    s.removeSavedStamp('b');
    expect(useSettingsStore.getState().stampLibrary.saved.map((x) => x.id)).toEqual(['a']);
  });

  it('persists the library to localStorage', () => {
    useSettingsStore.getState().saveStampToLibrary(stamp('a', square(), 'Kitchen'));
    const raw = localStorage.getItem('sitepulse-settings-storage');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string);
    expect(parsed.state.stampLibrary.saved[0].name).toBe('Kitchen');
  });
});

describe('useMapStore — armed stamp', () => {
  beforeEach(() => {
    useMapStore.setState({
      armedStamp: null,
      toolMode: 'pan',
      selectedUnitIds: ['unit-1'],
      stampTransform: { rotation: 2, flipX: true, flipY: false },
      stampDrawerOpen: false,
    });
  });

  it('armStamp arms the shape, enters stamp mode, clears selection + transform, opens the drawer', () => {
    const s = stamp('a', square());
    useMapStore.getState().armStamp(s);
    const st = useMapStore.getState();
    expect(st.armedStamp).toEqual(s);
    expect(st.toolMode).toBe('stamp');
    expect(st.selectedUnitIds).toEqual([]);
    expect(st.stampTransform).toEqual(IDENTITY_STAMP_TRANSFORM);
    expect(st.stampDrawerOpen).toBe(true);
  });

  it('clearArmedStamp disarms without touching the tool mode', () => {
    useMapStore.getState().armStamp(stamp('a', square()));
    useMapStore.getState().clearArmedStamp();
    expect(useMapStore.getState().armedStamp).toBeNull();
    expect(useMapStore.getState().toolMode).toBe('stamp');
  });
});
