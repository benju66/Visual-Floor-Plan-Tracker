'use client';

import React, { useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import WorkbenchReviewTable from './WorkbenchReviewTable';
import { REVIEW_STATE_LABELS, REVIEW_STATE_BADGE, narrowReviewState } from '@/utils/workbench';
import type { WorkbenchDrawing } from '@/types/domain';

// Location Labeling Workbench — Phase 7 review entry point. A state badge in the
// tracer header; clicking it opens the review table (the editable §9 review hub:
// rename / re-type / flags / delete + the Definition-of-Done gate + the
// draft → ready_for_review → reviewed transitions).

interface WorkbenchReviewControlProps {
  drawing: WorkbenchDrawing;
  containerId: string;
  userId: string | undefined;
}

export default function WorkbenchReviewControl({ drawing, containerId, userId }: WorkbenchReviewControlProps) {
  const [open, setOpen] = useState(false);
  const reviewState = narrowReviewState(drawing.workbench?.review_state);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Open the review table"
        className={`inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-full border transition-colors hover:brightness-95 ${REVIEW_STATE_BADGE[reviewState]}`}
      >
        <ClipboardCheck size={13} />
        {REVIEW_STATE_LABELS[reviewState]}
        <span className="opacity-60">· Review</span>
      </button>

      {open && (
        <WorkbenchReviewTable
          drawing={drawing}
          containerId={containerId}
          userId={userId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
