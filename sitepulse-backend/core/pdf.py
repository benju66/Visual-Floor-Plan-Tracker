"""PDF/upload helpers that carry no Supabase dependency: the capped upload
read, the preview-render zoom clamp, and the export header/color utilities.

Seam rule: the upload cap and pixel budget are read from `core.config` at call
time (`config.MAX_UPLOAD_BYTES`), so the `core.config.MAX_UPLOAD_BYTES`
monkeypatch seam reaches every call site.
"""
import re
from urllib.parse import quote

import fitz  # PyMuPDF
from fastapi import HTTPException, UploadFile

from core import config


async def read_upload_capped(file: UploadFile) -> bytes:
    """Read an UploadFile fully, rejecting with 413 once it exceeds the cap."""
    buf = bytearray()
    while True:
        chunk = await file.read(config._UPLOAD_CHUNK_BYTES)
        if not chunk:
            return bytes(buf)
        buf.extend(chunk)
        if len(buf) > config.MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"PDF is larger than the {config.MAX_UPLOAD_MB} MB upload limit.",
            )


def preview_matrix(page) -> "fitz.Matrix":
    """The 4x preview matrix, zoom-clamped so width*height stays in budget."""
    rect = page.rect
    pixels = (rect.width * config.PREVIEW_ZOOM) * (rect.height * config.PREVIEW_ZOOM)
    zoom = config.PREVIEW_ZOOM
    if pixels > config.MAX_RENDER_PIXELS:
        zoom = config.PREVIEW_ZOOM * (config.MAX_RENDER_PIXELS / pixels) ** 0.5
    return fitz.Matrix(zoom, zoom)


def content_disposition_attachment(filename: str) -> str:
    """RFC 6266/5987 attachment header that survives non-ASCII names. Starlette
    encodes response headers as latin-1, so a project called “Café Tower — 2”
    used to crash the export at the header line. The plain `filename=` carries
    an ASCII-safe fallback; `filename*=` carries the exact UTF-8 name."""
    ascii_fallback = re.sub(r'[^A-Za-z0-9._ -]', '_', filename).strip() or 'export.pdf'
    return f"attachment; filename=\"{ascii_fallback}\"; filename*=UTF-8''{quote(filename)}"


def hex_to_rgb(color_str: str):
    """CSS color string → (r, g, b) floats. Total: any malformed/non-string
    input degrades to black instead of raising — a bad color in client-supplied
    legend/polygon data must never 500 a whole export."""
    if not isinstance(color_str, str):
        return (0, 0, 0)
    rgba_match = re.search(r'rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)', color_str)
    if rgba_match:
        return tuple(min(int(rgba_match.group(i)), 255)/255.0 for i in (1, 2, 3))

    color_str = color_str.lstrip('#')
    if len(color_str) >= 6:
        try:
            return tuple(int(color_str[i:i+2], 16)/255.0 for i in (0, 2, 4))
        except ValueError:
            return (0, 0, 0)
    return (0, 0, 0)
