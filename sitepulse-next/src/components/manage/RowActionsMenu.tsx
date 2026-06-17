"use client";
import React, { useRef, useState } from 'react';
import { MoreVertical, Pencil, Tag, MapPin, Trash2, History, ChevronRight } from 'lucide-react';
import AnchoredMenu, { MenuItem } from './AnchoredMenu';
import TaxonomyPicker from '../TaxonomyPicker';
import type { TaxonomyResult } from '@/utils/subtypes';
import type { Subtype, ProjectType } from '@/types/domain';

interface RowActionsMenuProps {
  unitNumber: string;
  /** The location's current sub-type id (highlights the active pick). */
  currentSubtypeId?: string | null;
  subtypes: Subtype[];
  projectType: ProjectType | null;
  onRename: () => void;
  onChangeType: (result: TaxonomyResult) => void;
  onLocate?: () => void;
  onDelete?: () => void;
  onHistory: () => void;
}

export default function RowActionsMenu({
  unitNumber,
  currentSubtypeId,
  subtypes,
  projectType,
  onRename,
  onChangeType,
  onLocate,
  onDelete,
  onHistory,
}: RowActionsMenuProps) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [typeOpen, setTypeOpen] = useState(false);

  const openMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    setRect(btnRef.current?.getBoundingClientRect() ?? null);
    setTypeOpen(false);
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setTypeOpen(false);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={openMenu}
        className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
        title="Actions"
        aria-label={`Actions for ${unitNumber}`}
      >
        <MoreVertical size={16} />
      </button>

      <AnchoredMenu open={open} anchorRect={rect} onClose={close} width={typeOpen ? 248 : 224}>
        {!typeOpen ? (
          <>
            <MenuItem icon={<Pencil size={15} />} label="Rename" onClick={() => { close(); onRename(); }} />
            <MenuItem icon={<Tag size={15} />} label="Change type" trailing={<ChevronRight size={14} className="text-slate-400" />} onClick={() => setTypeOpen(true)} />
            {onLocate && <MenuItem icon={<MapPin size={15} />} label="Locate on map" onClick={() => { close(); onLocate(); }} />}
            <MenuItem icon={<History size={15} />} label="View history" onClick={() => { close(); onHistory(); }} />
            {onDelete && (
              <>
                <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
                <MenuItem icon={<Trash2 size={15} />} label="Delete location" danger onClick={() => { close(); onDelete(); }} />
              </>
            )}
          </>
        ) : (
          <div className="px-1">
            <button
              type="button"
              onClick={() => setTypeOpen(false)}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            >
              <ChevronRight size={13} className="rotate-180" /> Change type
            </button>
            <TaxonomyPicker
              subtypes={subtypes}
              projectType={projectType}
              selectedSubtypeId={currentSubtypeId}
              onPick={(result) => { close(); onChangeType(result); }}
              variant="menu"
            />
          </div>
        )}
      </AnchoredMenu>
    </>
  );
}
