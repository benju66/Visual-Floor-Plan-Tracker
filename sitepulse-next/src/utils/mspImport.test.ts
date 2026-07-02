import { describe, it, expect } from 'vitest';
import { parseMspXml, leafTasks, type MspTask } from './mspImport';
import { MSPDI_SAMPLE_XML } from './__fixtures__/mspdiSample';

function byUid(tasks: MspTask[], uid: string): MspTask {
  const t = tasks.find((x) => x.uid === uid);
  if (!t) throw new Error(`fixture task uid=${uid} missing`);
  return t;
}

describe('parseMspXml', () => {
  const result = parseMspXml(MSPDI_SAMPLE_XML);

  it('parses the fixture and reads the project title', () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.projectName).toBe('ORCHARD PATH III');
  });

  it('drops IsNull spacer rows and Active=0 tasks, keeps everything else in document order', () => {
    if (!result.ok) throw new Error('parse failed');
    // 14 <Task> elements: minus the IsNull spacer (uid 2597) and the
    // deactivated task (uid 999) = 12.
    expect(result.tasks).toHaveLength(12);
    expect(result.tasks.some((t) => t.uid === '2597')).toBe(false);
    expect(result.tasks.some((t) => t.uid === '999')).toBe(false);
    expect(result.tasks[0].uid).toBe('0'); // document order preserved
  });

  it('flags summaries and zero-duration milestones', () => {
    if (!result.ok) throw new Error('parse failed');
    expect(byUid(result.tasks, '227').isSummary).toBe(true); // LEVEL 4 FINISHES
    expect(byUid(result.tasks, '2637').isSummary).toBe(false); // INSULATION
    expect(byUid(result.tasks, '2595').isMilestone).toBe(true); // START CONSTRUCTION
    expect(byUid(result.tasks, '2637').isMilestone).toBe(false);
  });

  it('converts MSPDI timestamps to day-only strings', () => {
    if (!result.ok) throw new Error('parse failed');
    const insulation = byUid(result.tasks, '2637');
    expect(insulation.start).toBe('2025-11-24');
    expect(insulation.finish).toBe('2025-12-01');
  });

  it('derives the ancestor summary path from outline levels (across spacer rows)', () => {
    if (!result.ok) throw new Error('parse failed');
    // MOB (outline 2) comes AFTER an outline-0 spacer row — the spacer must not
    // reset the ancestor stack.
    expect(byUid(result.tasks, '1').path).toEqual(['ORCHARD PATH III', 'ORCHARD PATH III']);
    expect(byUid(result.tasks, '2637').path).toEqual([
      'ORCHARD PATH III',
      'ORCHARD PATH III',
      'LOW RISE APARTMENT',
      'INTERIOR FINISHES',
      'LEVEL 4 FINISHES (19 UNITS)',
    ]);
    // DEMOB is outline 1 — only the root remains above it.
    expect(byUid(result.tasks, '2795').path).toEqual(['ORCHARD PATH III']);
  });

  it('does not leak nested PredecessorLink elements into task fields, and decodes entities', () => {
    if (!result.ok) throw new Error('parse failed');
    const drywall = byUid(result.tasks, '229');
    expect(drywall.name).toBe('DRYWALL HANG');
    expect(drywall.start).toBe('2025-12-02'); // not PredecessorLink's <LinkLag>/<Type>
    expect(byUid(result.tasks, '230').name).toBe('DRYWALL TAPE & SAND');
  });

  it('trims task names (the real export has trailing spaces)', () => {
    if (!result.ok) throw new Error('parse failed');
    expect(byUid(result.tasks, '1').name).toBe('MOB');
  });

  it('rejects empty input, non-XML, and XML with the wrong root', () => {
    expect(parseMspXml('')).toMatchObject({ ok: false });
    expect(parseMspXml('   ')).toMatchObject({ ok: false });
    expect(parseMspXml('this is not xml <<<')).toMatchObject({ ok: false });
    expect(parseMspXml('<Workbook><Row/></Workbook>')).toMatchObject({ ok: false });
  });

  it('rejects a Project with no tasks', () => {
    expect(parseMspXml('<Project xmlns="http://schemas.microsoft.com/project"><Tasks/></Project>')).toMatchObject({
      ok: false,
    });
  });
});

describe('leafTasks', () => {
  it('keeps only non-summary tasks', () => {
    const result = parseMspXml(MSPDI_SAMPLE_XML);
    if (!result.ok) throw new Error('parse failed');
    const leaves = leafTasks(result.tasks);
    // 12 kept tasks minus 6 summaries (root ×2, CONSTRUCTION DURATION,
    // LOW RISE APARTMENT, INTERIOR FINISHES, LEVEL 4 FINISHES).
    expect(leaves).toHaveLength(6);
    expect(leaves.every((t) => !t.isSummary)).toBe(true);
  });
});
