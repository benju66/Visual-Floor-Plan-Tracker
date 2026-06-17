"use client";
import React, { useRef, useState } from 'react';
import { UserPlus, UserX, Check } from 'lucide-react';
import AnchoredMenu, { MenuItem } from './AnchoredMenu';
import { memberOptions, resolveAssignee, initials, type MemberLike } from './assignee';

interface AssigneeCellProps {
  assignedTo: string | null | undefined;
  members: MemberLike[];
  onAssign: (userId: string | null) => void;
}

const Avatar = ({ label, size = 20 }: { label: string; size?: number }) => (
  <span
    className="rounded-full bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-200 font-bold flex items-center justify-center shrink-0"
    style={{ width: size, height: size, fontSize: size <= 18 ? 8 : 9 }}
  >
    {initials(label)}
  </span>
);

export default function AssigneeCell({ assignedTo, members, onAssign }: AssigneeCellProps) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const current = resolveAssignee(members, assignedTo);
  const options = memberOptions(members);

  const openMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    setRect(btnRef.current?.getBoundingClientRect() ?? null);
    setOpen(true);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={openMenu}
        title={current ? `Assigned to ${current.label}` : 'Assign'}
        className={
          current
            ? 'inline-flex items-center gap-1.5 max-w-[150px] rounded-md px-1.5 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors'
            : 'inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 transition-colors'
        }
      >
        {current ? (
          <>
            <Avatar label={current.label} />
            <span className="truncate">{current.label}</span>
          </>
        ) : (
          <>
            <UserPlus size={13} /> Assign
          </>
        )}
      </button>

      <AnchoredMenu open={open} anchorRect={rect} onClose={() => setOpen(false)} width={240}>
        <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">Assign to</div>
        {options.length === 0 && <div className="px-3 py-2 text-xs text-slate-400">No team members yet.</div>}
        {options.map((o) => (
          <MenuItem
            key={o.id}
            label={o.label}
            icon={o.id === assignedTo ? <Check size={15} className="text-sky-500" /> : <Avatar label={o.label} size={18} />}
            onClick={() => { setOpen(false); if (o.id !== assignedTo) onAssign(o.id); }}
          />
        ))}
        {assignedTo && (
          <>
            <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
            <MenuItem icon={<UserX size={15} />} label="Unassign" onClick={() => { setOpen(false); onAssign(null); }} />
          </>
        )}
      </AnchoredMenu>
    </>
  );
}
