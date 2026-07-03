"use client";
import React, { useMemo, useState } from 'react';
import {
  Plus, X, Search, AlertCircle, Loader2, Upload, Check, Pencil, Hash,
} from 'lucide-react';
import {
  useCostCodes, useUpsertCostCode, useSetCostCodeStatus, useImportCostCodes,
} from '@/hooks/useCostCodes';
import {
  parseCostCodeCatalog,
  filterCostCodesForAdmin,
  groupCostCodesByDivision,
  deriveDivision,
  type CostCodeStatusFilter,
} from '@/utils/costCodes';
import type { CostCode, CostCodeStatus } from '@/types/domain';

const STATUS_FILTERS: { value: CostCodeStatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'deprecated', label: 'Retired' },
];

const TYPE_OPTIONS = ['Subcontract', 'Material', 'Labor'] as const;

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong — please try again.';
}

interface CostCodeLibraryPanelProps {
  /** Writes are RLS-gated to owner/admin/pm; false renders the list read-only. */
  canManage?: boolean;
}

/**
 * Global Cost Code library admin (Scheduling Analytics Slice B, Phase 5). Lives in the
 * cross-project Global Settings modal because the catalog is one shared company-wide list
 * (the CSI-MasterFormat codes an estimator uses). Mirrors {@link LocationLibraryPanel}:
 *   1. an idempotent import (paste the catalog / a CSV → preview → upsert, no dupes);
 *   2. add a code (code + description + type + unit);
 *   3. the full catalog grouped by division, filterable by status + searchable, with
 *      per-row edit + deprecate/restore.
 * Codes are labels only (no dollars). A canonical activity is stamped with one in the
 * Schedule view's activity editor.
 */
export default function CostCodeLibraryPanel({ canManage = true }: CostCodeLibraryPanelProps) {
  const { data: codes = [], isLoading } = useCostCodes();
  const upsert = useUpsertCostCode();
  const setStatus = useSetCostCodeStatus();
  const importCodes = useImportCostCodes();

  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<CostCodeStatusFilter>('active');
  const [search, setSearch] = useState('');

  // Import
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState('');
  const [importResult, setImportResult] = useState('');

  // Add
  const [adding, setAdding] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newType, setNewType] = useState<string>('Subcontract');
  const [newUom, setNewUom] = useState('SF');

  const filtered = filterCostCodesForAdmin(codes, statusFilter, search);
  const grouped = useMemo(() => groupCostCodesByDivision(filtered), [filtered]);
  const parsedPreview = useMemo(() => parseCostCodeCatalog(importText), [importText]);

  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    try { await fn(); } catch (e) { setError(errMessage(e)); }
  };

  const handleImport = () =>
    run(async () => {
      const drafts = parseCostCodeCatalog(importText);
      if (drafts.length === 0) { setImportResult('No codes found to import.'); return; }
      const n = await importCodes.mutateAsync(drafts);
      setImportResult(`Imported ${n} code${n === 1 ? '' : 's'} — re-importing the same list never duplicates.`);
      setImportText('');
    });

  const handleAdd = () =>
    run(async () => {
      const code = newCode.trim();
      if (!code) return;
      await upsert.mutateAsync({
        code,
        description: newDesc.trim() || null,
        division: deriveDivision(code),
        code_type: newType,
        unit_of_measure: newUom.trim() || 'SF',
        status: 'active',
      });
      setNewCode(''); setNewDesc(''); setNewType('Subcontract'); setNewUom('SF');
      setAdding(false);
    });

  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs text-slate-500 dark:text-slate-400 text-balance">
        One shared cost-code catalog (CSI MasterFormat) used across <span className="font-semibold">all</span>{' '}
        projects. Import your list, add or retire codes, then stamp a code onto an activity in the Schedule view.
        Codes are labels — no dollars. Changes here apply everywhere.
      </p>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-3 py-2 text-xs font-medium text-red-700 dark:text-red-300">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ── Import ───────────────────────────────────────────────────── */}
      {canManage && (
        <section>
          {!importing ? (
            <button
              type="button"
              onClick={() => { setImporting(true); setImportResult(''); setError(''); }}
              className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 dark:border-white/15 px-3 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
            >
              <Upload size={15} /> Import / paste catalog
            </button>
          ) : (
            <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Import cost codes</span>
                <button type="button" onClick={() => setImporting(false)} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                  <X size={15} />
                </button>
              </div>
              <p className="mb-2 text-[11px] text-slate-500 dark:text-slate-400">
                Paste a table with <span className="font-mono">Cost Code</span>, <span className="font-mono">Description</span>,{' '}
                <span className="font-mono">Type</span>, <span className="font-mono">Div</span> columns (CSV, tab, or a Markdown
                table). Re-importing never makes duplicates.
              </p>
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                rows={6}
                placeholder={'Cost Code,Description,Type,Div\n09-2116.001,Gypsum Board Assemblies,Subcontract,09'}
                className="w-full rounded-lg border border-slate-300 dark:border-white/15 bg-white dark:bg-black/25 px-3 py-2 text-xs font-mono outline-none focus:ring-2 focus:ring-sky-500/40"
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleImport}
                  disabled={parsedPreview.length === 0 || importCodes.isPending}
                  className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-600 disabled:opacity-40 transition-colors"
                >
                  {importCodes.isPending ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  Import {parsedPreview.length > 0 ? `${parsedPreview.length} code${parsedPreview.length === 1 ? '' : 's'}` : ''}
                </button>
                {importResult && <span className="text-[11px] text-emerald-600 dark:text-emerald-400">{importResult}</span>}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── Add a code ───────────────────────────────────────────────── */}
      {canManage && (
        <section>
          {!adding ? (
            <button
              type="button"
              onClick={() => { setAdding(true); setError(''); }}
              className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 dark:border-white/15 px-3 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
            >
              <Plus size={15} /> Add a cost code
            </button>
          ) : (
            <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">New cost code</span>
                <button type="button" onClick={() => setAdding(false)} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                  <X size={15} />
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <input
                  type="text" autoFocus value={newCode} onChange={(e) => setNewCode(e.target.value)}
                  placeholder="Code (e.g. 09-2116.001)"
                  className="rounded-lg border border-slate-300 dark:border-white/15 bg-white dark:bg-black/25 px-3 py-1.5 text-sm font-mono outline-none focus:ring-2 focus:ring-sky-500/40"
                />
                <input
                  type="text" value={newDesc} onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Description"
                  className="rounded-lg border border-slate-300 dark:border-white/15 bg-white dark:bg-black/25 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-sky-500/40"
                />
                <select
                  value={newType} onChange={(e) => setNewType(e.target.value)}
                  className="rounded-lg border border-slate-300 dark:border-white/15 bg-white dark:bg-black/25 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-sky-500/40"
                >
                  {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <input
                  type="text" value={newUom} onChange={(e) => setNewUom(e.target.value)}
                  placeholder="Unit (e.g. SF)"
                  className="rounded-lg border border-slate-300 dark:border-white/15 bg-white dark:bg-black/25 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-sky-500/40"
                />
              </div>
              <button
                type="button" onClick={handleAdd} disabled={!newCode.trim() || upsert.isPending}
                className="mt-2.5 flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-600 disabled:opacity-40 transition-colors"
              >
                {upsert.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add to catalog
              </button>
            </div>
          )}
        </section>
      )}

      {/* ── Filter bar ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.value} type="button" onClick={() => setStatusFilter(f.value)}
              className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-colors ${
                statusFilter === f.value
                  ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[160px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search code or description…"
            className="w-full rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 py-1.5 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-sky-500/40"
          />
        </div>
        <span className="text-[11px] text-slate-400">{filtered.length} of {codes.length}</span>
      </div>

      {/* ── Catalog list ─────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="flex justify-center py-10 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-white/10 py-8 text-center text-sm text-slate-500">
          No cost codes match.
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(g => (
            <div key={g.division}>
              <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                <Hash size={11} /> {g.label}
                <span className="text-slate-300 dark:text-slate-600">({g.codes.length})</span>
              </div>
              <div className="space-y-1.5">
                {g.codes.map(c => (
                  <CostCodeRow
                    key={c.id}
                    code={c}
                    canManage={canManage}
                    onSetStatus={(status) => run(() => setStatus.mutateAsync({ id: c.id, status }))}
                    onSave={(fields) => run(() => upsert.mutateAsync({ id: c.id, code: c.code, ...fields }))}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── One catalog row ──────────────────────────────────────────────────────────

interface CostCodeRowProps {
  code: CostCode;
  canManage: boolean;
  onSetStatus: (status: CostCodeStatus) => void;
  onSave: (fields: { description: string | null; code_type: string | null; unit_of_measure: string }) => void;
}

function CostCodeRow({ code, canManage, onSetStatus, onSave }: CostCodeRowProps) {
  const [editing, setEditing] = useState(false);
  const [desc, setDesc] = useState(code.description ?? '');
  const [type, setType] = useState(code.code_type ?? 'Subcontract');
  const [uom, setUom] = useState(code.unit_of_measure);

  const beginEdit = () => {
    setDesc(code.description ?? '');
    setType(code.code_type ?? 'Subcontract');
    setUom(code.unit_of_measure);
    setEditing(true);
  };
  const commit = () => {
    onSave({ description: desc.trim() || null, code_type: type.trim() || null, unit_of_measure: uom.trim() || 'SF' });
    setEditing(false);
  };

  return (
    <div className={`rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 p-2.5 ${code.status === 'deprecated' ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex items-center gap-2">
          <span className="font-mono text-xs font-bold text-slate-700 dark:text-slate-200">{code.code}</span>
          <span className="truncate text-sm text-slate-700 dark:text-slate-200">{code.description || <span className="italic text-slate-400">no description</span>}</span>
          {code.code_type && (
            <span className="rounded-full bg-slate-100 dark:bg-white/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {code.code_type}
            </span>
          )}
          <span className="text-[10px] text-slate-400">{code.unit_of_measure}</span>
        </div>
        {canManage && (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button" onClick={() => (editing ? setEditing(false) : beginEdit())}
              className="rounded-md p-1 text-slate-400 hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-500/10 transition-colors"
              title="Edit"
            >
              <Pencil size={14} />
            </button>
            <select
              value={code.status}
              onChange={(e) => onSetStatus(e.target.value as CostCodeStatus)}
              className="rounded-md border border-slate-200 dark:border-white/15 bg-slate-50 dark:bg-black/20 px-1.5 py-1 text-[11px] font-semibold outline-none focus:ring-2 focus:ring-sky-500/40"
            >
              <option value="active">Active</option>
              <option value="deprecated">Retired</option>
            </select>
          </div>
        )}
      </div>

      {editing && canManage && (
        <div className="mt-2 grid grid-cols-1 gap-2 border-t border-slate-100 dark:border-white/5 pt-2 sm:grid-cols-2">
          <input
            type="text" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Description"
            className="rounded-md border border-slate-300 dark:border-white/15 bg-white dark:bg-black/30 px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-sky-500/40"
          />
          <select
            value={type} onChange={(e) => setType(e.target.value)}
            className="rounded-md border border-slate-300 dark:border-white/15 bg-white dark:bg-black/30 px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-sky-500/40"
          >
            {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <input
            type="text" value={uom} onChange={(e) => setUom(e.target.value)} placeholder="Unit (e.g. SF)"
            className="rounded-md border border-slate-300 dark:border-white/15 bg-white dark:bg-black/30 px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-sky-500/40"
          />
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={commit} className="flex items-center gap-1 rounded-md bg-sky-500 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-sky-600 transition-colors">
              <Check size={13} /> Save
            </button>
            <button type="button" onClick={() => setEditing(false)} className="rounded-md px-2 py-1 text-[11px] font-semibold text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
