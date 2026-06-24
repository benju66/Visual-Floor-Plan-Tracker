import type { PercentPoint } from '@/types/domain';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

export interface ExportPDFPayload {
  [key: string]: unknown;
}

export interface ExportPDFResult {
  blob: Blob;
  filename: string;
}

export async function exportToPDFService(activeSheetId: string, payload: ExportPDFPayload, token: string): Promise<ExportPDFResult> {
  const response = await fetch(`${API_BASE_URL}/export-pdf/${activeSheetId}`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}` 
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.detail || 'Export failed on server');
  }

  const blob = await response.blob();
  let filename = 'Export.pdf';
  const disposition = response.headers.get('content-disposition');
  if (disposition && disposition.indexOf('filename=') !== -1) {
      const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disposition);
      if (matches != null && matches[1]) { 
          filename = matches[1].replace(/['"]/g, '');
      }
  }
  return { blob, filename };
}

export interface UploadFloorplanResult {
  base_image_url: string;
  [key: string]: unknown;
}

export async function uploadFloorplanService(sheetId: string, file: File, pdfPageNumber: number, token: string): Promise<UploadFloorplanResult> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(
    `${API_BASE_URL}/upload-floorplan/${sheetId}?page_number=${pdfPageNumber}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData,
    }
  );

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.detail || 'Failed to convert PDF');
  }

  return response.json();
}

export interface AttachOriginalResult {
  [key: string]: unknown;
}

export async function attachOriginalService(activeSheetId: string, file: File, token: string): Promise<AttachOriginalResult> {
  const formData = new FormData();
  formData.append('file', file);
  
  const response = await fetch(`${API_BASE_URL}/attach-original/${activeSheetId}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: formData
  });
  
  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.detail || 'Failed to attach');
  }
  
  return response.json();
}

export interface DeleteSheetStorageResult {
  status: string;
  /** The storage paths the server attempted to remove (idempotent). */
  removed: string[];
  [key: string]: unknown;
}

/**
 * Delete a sheet's storage objects (converted preview PNG + original PDF) via the
 * backend. Storage RLS denies the client's own `.remove()` project-wide, so this
 * authenticated route does it service-side. Call BEFORE deleting the `sheets` row
 * (the server resolves project membership from the still-present row). Idempotent.
 */
export async function deleteSheetStorageService(sheetId: string, token: string): Promise<DeleteSheetStorageResult> {
  const response = await fetch(`${API_BASE_URL}/sheet-storage/${sheetId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.detail || 'Failed to delete drawing files');
  }

  return response.json();
}

export interface DeleteProjectResult {
  status: string;
  /** How many sheets the server swept storage for before the cascade delete. */
  deleted_sheets: number;
  [key: string]: unknown;
}

/**
 * Hard-delete a project and all its data via the backend (admin only). The
 * server reclaims each sheet's storage blobs (client `.remove()` is RLS-denied),
 * then deletes the `projects` row — every child table cascades. Irreversible.
 */
export async function deleteProjectService(projectId: string, token: string): Promise<DeleteProjectResult> {
  const response = await fetch(`${API_BASE_URL}/project/${projectId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.detail || 'Failed to delete project');
  }

  return response.json();
}

export interface VectorLine {
  start: PercentPoint;
  end: PercentPoint;
}

export interface ExtractVectorsResult {
  vectors: VectorLine[];
}

export interface RBushItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  lineData: VectorLine;
}

export async function extractVectorsService(sheetId: string, token: string): Promise<ExtractVectorsResult> {
  const response = await fetch(`${API_BASE_URL}/extract-vectors/${sheetId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.detail || 'Failed to extract vectors');
  }

  return response.json();
}
