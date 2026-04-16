const BASE_URL = 'http://127.0.0.1:8000';

export async function exportToPDFService(activeSheetId, payload) {
  const response = await fetch(`${BASE_URL}/export-pdf/${activeSheetId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

export async function uploadFloorplanService(sheetId, file, pdfPageNumber) {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(
    `${BASE_URL}/upload-floorplan/${sheetId}?page_number=${pdfPageNumber}`,
    {
      method: 'POST',
      body: formData,
    }
  );

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.detail || 'Failed to convert PDF');
  }

  return response.json();
}

export async function attachOriginalService(activeSheetId, file) {
  const formData = new FormData();
  formData.append('file', file);
  
  const response = await fetch(`${BASE_URL}/attach-original/${activeSheetId}`, {
    method: 'POST',
    body: formData
  });
  
  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.detail || 'Failed to attach');
  }
  
  return response.json();
}
