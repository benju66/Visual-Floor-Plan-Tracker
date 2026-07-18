"""Pure vector/text extraction math — fitz (PyMuPDF) only.

This module must NEVER import supabase and must import cleanly with NO env vars
set (core.config has defaults for everything): the backfill scripts and the
extraction tests import it directly, without constructing the real Supabase
client or requiring credentials.

Seam rule: `VECTOR_CAP_LINES` / `MIN_SEGMENT_PTS` are read from `core.config`
at call time, so the `core.config.VECTOR_CAP_LINES` monkeypatch seam holds.
"""
import fitz  # PyMuPDF

from core import config


def cap_vector_payload(lines: list, width: float, height: float, cap: int) -> list:
    """Keep at most `cap` segments, preferring the longest.

    Under the cap the input is returned unchanged. Over it, segments are ranked
    by true length in PDF points (pct deltas scaled by the page dimensions, so
    ranking is aspect-correct like the MIN_SEGMENT_PTS filter), ties broken by
    original position, and the survivors are returned in original order.
    """
    if len(lines) <= cap:
        return lines

    def length_sq(line):
        dx = (line["end"]["pctX"] - line["start"]["pctX"]) * width
        dy = (line["end"]["pctY"] - line["start"]["pctY"]) * height
        return dx * dx + dy * dy

    ranked = sorted(range(len(lines)), key=lambda i: (-length_sq(lines[i]), i))
    return [lines[i] for i in sorted(ranked[:cap])]


def extract_vectors_from_pdf(pdf_bytes: bytes) -> list:
    """Extract structural line vectors from a PDF page.
    Returns a list of {start: {pctX, pctY}, end: {pctX, pctY}} dicts.
    Filters out curves (fixtures), microscopic lineweights (hatching),
    sub-point degenerate segments, and duplicate/overlapping segments."""
    # `with` so the PyMuPDF doc closes on every path (incl. errors) — replaces the
    # old explicit doc.close() that only ran on the happy path.
    with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
        page = doc[0]

        width = page.rect.width
        height = page.rect.height

        # Inverse the derotation matrix to map PDF coordinates back to the map percentages
        inv_derot = ~page.derotation_matrix
        tl = page.cropbox.tl

        drawings = page.get_drawings()

        def map_point(p):
            p_mapped = (p - tl) * inv_derot
            return {"pctX": p_mapped.x / width, "pctY": p_mapped.y / height}

        # Collect candidate segments, then filter by length and dedupe.
        candidates = []

        for path in drawings:
            # FILTER 1: Reject curves (doors, toilets, fixtures)
            if any(item[0] in ('c', 'v', 'y') for item in path["items"]):
                continue

            # FILTER 2: Reject microscopic lineweights (hatching, shading)
            path_width = path.get("width")
            if path_width is not None and path_width < 0.2:
                continue

            for item in path["items"]:
                if item[0] == 'l':
                    candidates.append((map_point(item[1]), map_point(item[2])))

                elif item[0] == 're':
                    rect = item[1]
                    corners = [rect.tl, rect.tr, rect.br, rect.bl]
                    mapped = [map_point(c) for c in corners]
                    for i in range(4):
                        candidates.append((mapped[i], mapped[(i + 1) % 4]))

    # FILTER 3 + dedupe: drop sub-point segments (hatching/noise) and collapse
    # exact/reversed duplicates. Length is measured back in PDF points (pct * page
    # dimension) so the threshold is aspect-correct and resolution-independent.
    clean_lines = []
    seen = set()
    for start, end in candidates:
        dx_pts = (end["pctX"] - start["pctX"]) * width
        dy_pts = (end["pctY"] - start["pctY"]) * height
        if (dx_pts * dx_pts + dy_pts * dy_pts) < (config.MIN_SEGMENT_PTS * config.MIN_SEGMENT_PTS):
            continue

        a = (round(start["pctX"], 5), round(start["pctY"], 5))
        b = (round(end["pctX"], 5), round(end["pctY"], 5))
        key = (a, b) if a <= b else (b, a)
        if key in seen:
            continue
        seen.add(key)
        # Store the ROUNDED coords (original start->end orientation) — 5 decimals
        # is lossless at drawing scale (~0.03px on a 10k-px sheet) and shrinks the
        # cached JSON payload by roughly a third.
        clean_lines.append({
            "start": {"pctX": a[0], "pctY": a[1]},
            "end": {"pctX": b[0], "pctY": b[1]},
        })

    raw_count = len(clean_lines)
    capped = cap_vector_payload(clean_lines, width, height, config.VECTOR_CAP_LINES)
    if len(capped) < raw_count:
        print(f"[INFO] vector payload capped: kept {len(capped)} of {raw_count} lines")
    return capped


def extract_text_from_pdf(pdf_bytes: bytes) -> list:
    """Extract the searchable text layer of a PDF page as located words.

    Returns a list of {text, pctX, pctY} dicts — each word plus its position
    (the word-bbox center) in the SAME percent space as extract_vectors_from_pdf:
    positions run through the identical PDF->percent transform (undo derotation +
    cropbox offset, normalize to 0..1), so cached text shares one coordinate
    system with sheet_vectors and units.polygon_coordinates.

    A scanned PDF with no text layer yields an EMPTY list — that is the
    legitimate "no words / OCR candidate" state, NOT an error.
    """
    # `with` so the PyMuPDF doc closes on every path (incl. errors). map_point +
    # the located-words loop below use only captured values, so they run fine
    # after the doc closes.
    with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
        page = doc[0]

        width = page.rect.width
        height = page.rect.height

        # Inverse the derotation matrix to map PDF coordinates back to the map
        # percentages — identical to extract_vectors_from_pdf.map_point so words and
        # vectors land in the same percent space.
        inv_derot = ~page.derotation_matrix
        tl = page.cropbox.tl

        def map_point(p):
            p_mapped = (p - tl) * inv_derot
            return {"pctX": p_mapped.x / width, "pctY": p_mapped.y / height}

        # get_text("words") -> (x0, y0, x1, y1, "word", block_no, line_no, word_no).
        # A page with no text layer (scanned raster) returns an empty list.
        words = page.get_text("words")

    located = []
    for w in words:
        x0, y0, x1, y1, text = w[0], w[1], w[2], w[3], w[4]
        if not text or not text.strip():
            continue
        center = fitz.Point((x0 + x1) / 2, (y0 + y1) / 2)
        located.append({"text": text, **map_point(center)})

    return located
