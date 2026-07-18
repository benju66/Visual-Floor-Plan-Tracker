"""Unit tests for sheet_text PDF text-layer extraction (AI Tracing Assist Phase 1).

Mirrors the vector-extraction approach: build a tiny in-memory PDF with known
words, run extract_text_from_pdf, and assert each word lands in the SAME percent
space (0..1, word-bbox center / page dimensions) used by extract_vectors_from_pdf
— plus the scanned-PDF (no text layer) path returns an empty list, not an error.
"""
import fitz
import pytest

from core.extraction import extract_text_from_pdf

PAGE_W = 200.0
PAGE_H = 100.0


def _build_pdf(words):
    """Build a PAGE_W x PAGE_H PDF with `words` = [(text, x, y)] baseline points.

    Returns (pdf_bytes, ground_truth) where ground_truth is [(text, pctX, pctY)]
    computed from the REAL word bboxes: an unrotated, zero-crop page makes
    map_point reduce to (x/width, y/height), so the expected percent is just the
    bbox center over the page dimensions.
    """
    doc = fitz.open()
    page = doc.new_page(width=PAGE_W, height=PAGE_H)
    for text, x, y in words:
        page.insert_text(fitz.Point(x, y), text, fontsize=12)

    ground_truth = []
    for x0, y0, x1, y1, text, *_ in page.get_text("words"):
        ground_truth.append((text, ((x0 + x1) / 2) / PAGE_W, ((y0 + y1) / 2) / PAGE_H))

    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes, ground_truth


def test_words_map_to_percent_space():
    pdf_bytes, ground_truth = _build_pdf([
        ("KITCHEN", 20, 30),   # left / upper
        ("MECH", 150, 80),     # right / lower
    ])

    result = extract_text_from_pdf(pdf_bytes)

    # extract_text_from_pdf and ground_truth both iterate get_text("words") in the
    # same reading order, so they pair up index-for-index.
    assert len(result) == len(ground_truth) == 2
    for got, (text, exp_x, exp_y) in zip(result, ground_truth):
        assert got["text"] == text
        assert got["pctX"] == pytest.approx(exp_x, abs=1e-4)
        assert got["pctY"] == pytest.approx(exp_y, abs=1e-4)
        assert 0.0 <= got["pctX"] <= 1.0
        assert 0.0 <= got["pctY"] <= 1.0

    # Relative geometry sanity: KITCHEN is left of and above MECH.
    by_text = {w["text"]: w for w in result}
    assert by_text["KITCHEN"]["pctX"] < by_text["MECH"]["pctX"]
    assert by_text["KITCHEN"]["pctY"] < by_text["MECH"]["pctY"]


def test_scanned_pdf_with_no_text_returns_empty_list():
    # A page with no text layer (a scanned raster) extracts to [] — the valid
    # "OCR candidate" state, NOT an error.
    doc = fitz.open()
    doc.new_page(width=PAGE_W, height=PAGE_H)
    pdf_bytes = doc.tobytes()
    doc.close()

    assert extract_text_from_pdf(pdf_bytes) == []
