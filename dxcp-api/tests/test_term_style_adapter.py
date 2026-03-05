from __future__ import annotations

import importlib.util
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
STYLE_PATH = REPO_ROOT / "scripts" / "term" / "style.py"
SPEC = importlib.util.spec_from_file_location("dxcp_term_style_test", STYLE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Unable to load term style module from {STYLE_PATH}")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def test_detect_symbol_mode_overrides_ascii():
    mode = MODULE.detect_symbol_mode(
        is_tty=True,
        env={"NO_COLOR": "1", "TERM": "xterm-256color"},
    )
    assert mode == "ascii"


def test_detect_symbol_mode_non_tty_ascii():
    mode = MODULE.detect_symbol_mode(
        is_tty=False,
        env={"TERM": "xterm-256color", "LANG": "en_US.UTF-8"},
    )
    assert mode == "ascii"


def test_detect_symbol_mode_utf8_unicode():
    mode = MODULE.detect_symbol_mode(
        is_tty=True,
        env={"TERM": "xterm-256color", "FORCE_COLOR": "1"},
    )
    assert mode == "unicode"


def test_make_symbols_success_variants():
    unicode_symbols = MODULE.make_symbols("unicode")
    ascii_symbols = MODULE.make_symbols("ascii")
    assert unicode_symbols["success"] == "\u2713"
    assert ascii_symbols["success"] == "+"


def test_detect_capabilities_term_dumb_disables_color_and_unicode():
    caps = MODULE.detect_capabilities(
        is_tty=True,
        env={"TERM": "dumb", "FORCE_COLOR": "1"},
    )
    assert caps == {"color": False, "unicode": False}


def test_detect_capabilities_force_color_enables_color():
    caps = MODULE.detect_capabilities(
        is_tty=True,
        env={"TERM": "xterm-256color", "FORCE_COLOR": "1"},
    )
    assert caps == {"color": True, "unicode": True}
