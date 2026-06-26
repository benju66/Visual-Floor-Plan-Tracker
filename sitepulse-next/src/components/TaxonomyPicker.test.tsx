import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

afterEach(cleanup);
import TaxonomyPicker from './TaxonomyPicker';
import { PROJECT_TYPES } from '@/utils/locationTaxonomy';
import type { Subtype } from '@/types/domain';

function makeSubtype(over: Partial<Subtype> = {}): Subtype {
  return {
    id: over.id ?? 'id-1',
    name: over.name ?? 'Thing',
    top_level_role: over.top_level_role ?? 'program',
    status: over.status ?? 'active',
    aliases: over.aliases ?? [],
    default_project_types: over.default_project_types ?? [],
    proposed_note: over.proposed_note ?? null,
    created_by: over.created_by ?? null,
    created_at: over.created_at ?? null,
  };
}

// A tiny dictionary: one universal, one Housing-only, one Healthcare-only.
const DICT: Subtype[] = [
  makeSubtype({ id: 'c', name: 'Corridor', top_level_role: 'common', default_project_types: [...PROJECT_TYPES] }),
  makeSubtype({ id: 'h', name: 'Dwelling Unit', top_level_role: 'program', default_project_types: ['Housing'] }),
  makeSubtype({ id: 'k', name: 'Dental Operatory', top_level_role: 'program', default_project_types: ['Healthcare'] }),
];

function renderPicker(props: Partial<ComponentProps<typeof TaxonomyPicker>> = {}) {
  const onPick = vi.fn();
  const onAdvance = vi.fn();
  render(
    <TaxonomyPicker
      subtypes={DICT}
      projectType="Housing"
      onPick={onPick}
      onAdvance={onAdvance}
      {...props}
    />,
  );
  return { onPick, onAdvance, combobox: screen.getByRole('combobox') };
}

describe('TaxonomyPicker — combobox behavior', () => {
  it('filters the no-search list to the project type (hides other verticals)', () => {
    renderPicker({ restrictToProjectType: true });
    expect(screen.getByText('Dwelling Unit')).toBeTruthy(); // Housing
    expect(screen.getByText('Corridor')).toBeTruthy(); // universal
    expect(screen.queryByText('Dental Operatory')).toBeNull(); // Healthcare-only, hidden
  });

  it('search bypasses the filter — the escape hatch finds a hidden type', () => {
    const { combobox } = renderPicker({ restrictToProjectType: true });
    expect(screen.queryByText('Dental Operatory')).toBeNull();
    fireEvent.change(combobox, { target: { value: 'dental' } });
    expect(screen.getByText('Dental Operatory')).toBeTruthy();
  });

  it('Enter commits the highlighted option; ArrowDown moves the highlight first', () => {
    const { onPick, combobox } = renderPicker({ restrictToProjectType: true });
    // Order (Housing): program "Dwelling Unit" [0], common "Corridor" [1].
    fireEvent.keyDown(combobox, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ kind: 'subtype', subtypeId: 'h' }));

    onPick.mockClear();
    fireEvent.keyDown(combobox, { key: 'ArrowDown' });
    fireEvent.keyDown(combobox, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ kind: 'subtype', subtypeId: 'c' }));
  });

  it('Tab commits the highlight and calls onAdvance (hand focus to Save)', () => {
    const { onPick, onAdvance, combobox } = renderPicker({ restrictToProjectType: true });
    fireEvent.keyDown(combobox, { key: 'Tab' });
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ kind: 'subtype', subtypeId: 'h' }));
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it('renders a "Used in this project" row from recentSubtypeIds (even off-type ones)', () => {
    renderPicker({ restrictToProjectType: true, recentSubtypeIds: ['k'] });
    expect(screen.getByText('Used in this project')).toBeTruthy();
    // 'k' is Healthcare-only but recents show it regardless of the Housing filter.
    expect(screen.getByText('Dental Operatory')).toBeTruthy();
  });

  it('keeps the currently-selected type visible despite the filter', () => {
    renderPicker({ restrictToProjectType: true, selectedSubtypeId: 'k' });
    const option = screen.getByText('Dental Operatory').closest('li');
    expect(option?.getAttribute('aria-selected')).toBe('true');
  });

  it('does not restrict when restrictToProjectType is false (full list)', () => {
    renderPicker({ restrictToProjectType: false });
    expect(screen.getByText('Dental Operatory')).toBeTruthy();
    expect(screen.getByText('Dwelling Unit')).toBeTruthy();
    expect(screen.getByText('Corridor')).toBeTruthy();
  });
});
