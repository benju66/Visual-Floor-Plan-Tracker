"""Unit tests for the snapping-vector payload cap (Vector Payload Cap, Phase 1).

Pure-helper tests exercise cap_vector_payload with synthetic segment dicts (no
PDFs). The integration tests mirror test_text_extraction.py: build a tiny
in-memory PDF with known long "walls" and short "ticks", run
extract_vectors_from_pdf, and assert walls outlive ticks under a small cap,
normal pages pass through uncapped, and stored coords are 5-decimal rounded.
"""
import fitz
import pytest

import main
from main import cap_vector_payload, extract_vectors_from_pdf

PAGE_W = 200.0
PAGE_H = 100.0


def seg(x0, y0, x1, y1):
    return {"start": {"pctX": x0, "pctY": y0}, "end": {"pctX": x1, "pctY": y1}}


# --- cap_vector_payload (pure) ---------------------------------------------

def test_under_cap_returns_input_unchanged():
    lines = [seg(0, 0, 0.5, 0), seg(0, 0.1, 0.5, 0.1)]
    assert cap_vector_payload(lines, PAGE_W, PAGE_H, cap=5) is lines


def test_over_cap_keeps_longest_in_original_order():
    long_a = seg(0.0, 0.0, 0.9, 0.0)   # 180 pts
    tick_b = seg(0.1, 0.5, 0.11, 0.5)  # 2 pts
    long_c = seg(0.0, 0.9, 0.8, 0.9)   # 160 pts
    tick_d = seg(0.2, 0.5, 0.215, 0.5) # 3 pts
    result = cap_vector_payload([long_a, tick_b, long_c, tick_d], PAGE_W, PAGE_H, cap=2)
    assert result == [long_a, long_c]  # survivors, original order


def test_tie_break_prefers_earlier_segments():
    twins = [seg(0.0, i * 0.1, 0.5, i * 0.1) for i in range(3)]  # identical lengths
    result = cap_vector_payload(twins, PAGE_W, PAGE_H, cap=2)
    assert result == twins[:2]


def test_ranking_is_aspect_correct():
    # On a wide page a modest horizontal pct delta is LONGER in points than a
    # large vertical one: 0.2 * 1000 = 200 pts beats 0.9 * 100 = 90 pts.
    horizontal = seg(0.0, 0.5, 0.2, 0.5)
    vertical = seg(0.5, 0.05, 0.5, 0.95)
    result = cap_vector_payload([vertical, horizontal], 1000.0, 100.0, cap=1)
    assert result == [horizontal]


# --- extract_vectors_from_pdf integration -----------------------------------

def _build_pdf(walls, ticks):
    """Build a PAGE_W x PAGE_H PDF drawing `walls` + `ticks` = [(x0, y0, x1, y1)]
    as plain straight lines (no curves, default lineweight passes the width
    filter). Unrotated zero-crop page => map_point reduces to (x/W, y/H)."""
    doc = fitz.open()
    page = doc.new_page(width=PAGE_W, height=PAGE_H)
    for x0, y0, x1, y1 in walls + ticks:
        page.draw_line(fitz.Point(x0, y0), fitz.Point(x1, y1))
    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


WALLS = [(10, 20, 160, 20), (10, 40, 160, 40), (10, 20, 10, 80)]  # 150/150/60 pts
TICKS = [(20 + 5 * i, 80, 23 + 5 * i, 80) for i in range(8)]      # 3 pts each


def test_over_cap_extraction_keeps_only_walls(monkeypatch, capsys):
    monkeypatch.setattr(main, "VECTOR_CAP_LINES", 3)
    result = extract_vectors_from_pdf(_build_pdf(WALLS, TICKS))

    assert len(result) == 3
    expected_walls = {
        (round(x0 / PAGE_W, 5), round(y0 / PAGE_H, 5), round(x1 / PAGE_W, 5), round(y1 / PAGE_H, 5))
        for x0, y0, x1, y1 in WALLS
    }
    got = {
        (line["start"]["pctX"], line["start"]["pctY"], line["end"]["pctX"], line["end"]["pctY"])
        for line in result
    }
    assert got == expected_walls
    assert "vector payload capped: kept 3 of 11 lines" in capsys.readouterr().out


def test_under_cap_extraction_passes_everything_through(capsys):
    result = extract_vectors_from_pdf(_build_pdf(WALLS, TICKS))

    assert len(result) == len(WALLS) + len(TICKS)  # default 40k cap never engages
    assert "capped" not in capsys.readouterr().out
    # Stored coords are the 5-decimal-rounded values, not full-precision floats.
    for line in result:
        for pt in (line["start"], line["end"]):
            assert pt["pctX"] == round(pt["pctX"], 5)
            assert pt["pctY"] == round(pt["pctY"], 5)
            assert 0.0 <= pt["pctX"] <= 1.0
            assert 0.0 <= pt["pctY"] <= 1.0
