from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, Literal, Mapping, Optional

ColorLevel = Literal[0, 1, 2, 3]
SymbolMode = Literal["unicode", "ascii"]

_RESET = "\x1b[0m"
_SPEC_PATH = Path(__file__).resolve().with_name("theme_spec.json")
_THEME_SPEC = json.loads(_SPEC_PATH.read_text(encoding="utf-8"))


def reset() -> str:
    return _RESET


def bold() -> str:
    return "\x1b[1m"


def dim() -> str:
    return "\x1b[2m"


def ansi16_fg(code: int) -> str:
    return f"\x1b[{code}m"


def ansi256_fg(code: int) -> str:
    return f"\x1b[38;5;{code}m"


def truecolor_fg(r: int, g: int, b: int) -> str:
    return f"\x1b[38;2;{r};{g};{b}m"


def wrap(text: str, open_code: str, close: Optional[str] = None) -> str:
    if not open_code:
        return text
    return f"{open_code}{text}{close if close is not None else _RESET}"


def _parse_force_color(raw: Optional[str]) -> Optional[int]:
    if raw is None:
        return None
    value = str(raw).strip().lower()
    if not value:
        return 1
    if value == "true":
        return 1
    if value == "false":
        return 0
    try:
        parsed = int(float(value))
    except ValueError:
        return 1
    return max(0, min(3, parsed))


def detect_color_level(
    *,
    is_tty: Optional[bool] = None,
    env: Optional[Mapping[str, str]] = None,
    term: Optional[str] = None,
    color_term: Optional[str] = None,
) -> ColorLevel:
    source = dict(os.environ if env is None else env)
    caps = detect_capabilities(is_tty=is_tty, env=source, term=term)
    if not caps["color"]:
        return 0

    force = _parse_force_color(source.get("FORCE_COLOR"))
    current_term = str(term if term is not None else source.get("TERM", "")).strip()
    current_color_term = str(color_term if color_term is not None else source.get("COLORTERM", "")).strip()

    detected: ColorLevel
    if "truecolor" in current_color_term.lower() or "24bit" in current_color_term.lower():
        detected = 3
    elif "256color" in current_term.lower():
        detected = 2
    else:
        detected = 1

    if isinstance(force, int) and force > 0:
        return max(detected, force)  # type: ignore[return-value]
    return detected


def detect_capabilities(
    *,
    is_tty: Optional[bool] = None,
    env: Optional[Mapping[str, str]] = None,
    term: Optional[str] = None,
) -> Dict[str, bool]:
    source = dict(os.environ if env is None else env)
    tty = bool(is_tty) if isinstance(is_tty, bool) else bool(getattr(os.sys.stdout, "isatty", lambda: False)())
    current_term = str(term if term is not None else source.get("TERM", "")).strip().lower()

    if "NO_COLOR" in source:
        return {"color": False, "unicode": False}
    if not tty:
        return {"color": False, "unicode": False}
    if not current_term or current_term == "dumb":
        return {"color": False, "unicode": False}

    force = _parse_force_color(source.get("FORCE_COLOR"))
    if force == 0:
        return {"color": False, "unicode": True}
    if isinstance(force, int) and force > 0:
        return {"color": True, "unicode": True}
    return {"color": True, "unicode": True}


def detect_symbol_mode(
    *,
    is_tty: Optional[bool] = None,
    env: Optional[Mapping[str, str]] = None,
    term: Optional[str] = None,
    locale: Optional[str] = None,
) -> SymbolMode:
    source = dict(os.environ if env is None else env)
    caps = detect_capabilities(is_tty=is_tty, env=source, term=term)
    return "unicode" if caps["unicode"] else "ascii"


def make_symbols(mode: SymbolMode) -> Dict[str, str]:
    symbols = dict(_THEME_SPEC["symbols"][mode])
    symbols["info"] = _THEME_SPEC["symbols"]["info"]
    return symbols


def _join_codes(*codes: str) -> str:
    return "".join(code for code in codes if code)


def _kind_open(level: ColorLevel, kind: str) -> str:
    if level == 0:
        return ""
    palette = _THEME_SPEC["palette"].get(str(level), {})
    token: Dict[str, Any] = palette.get(kind, {})
    if not token:
        return ""
    codes = []
    if token.get("bold"):
        codes.append(bold())
    if token.get("dim"):
        codes.append(dim())
    if isinstance(token.get("ansi16"), int):
        codes.append(ansi16_fg(int(token["ansi16"])))
    elif isinstance(token.get("ansi256"), int):
        codes.append(ansi256_fg(int(token["ansi256"])))
    elif isinstance(token.get("rgb"), list) and len(token["rgb"]) == 3:
        r, g, b = token["rgb"]
        codes.append(truecolor_fg(int(r), int(g), int(b)))
    return _join_codes(*codes)


def make_theme(level: ColorLevel, symbols_input: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    symbol_mode: SymbolMode
    if symbols_input is not None:
        symbol_mode = "ascii" if symbols_input.get("success") == "+" else "unicode"
    else:
        symbol_mode = detect_symbol_mode()
    symbol_map = symbols_input if symbols_input is not None else make_symbols(symbol_mode)

    def apply(kind: str, text: str) -> str:
        return wrap(text, _kind_open(level, kind))

    styled_symbols = {
        "info": apply("info", symbol_map["info"]),
        "step": apply("step", f"[{symbol_map['step']}]"),
        "substep": apply("substep", f"  [{symbol_map['substep']}]"),
        "success": apply("success", f"[{symbol_map['success']}]"),
        "fail": apply("fail", f"[{symbol_map['fail']}]"),
    }

    return {
        "level": level,
        "symbol_mode": symbol_mode,
        "symbol_map": symbol_map,
        "symbols": styled_symbols,
        "title": lambda text: apply("title", text),
        "info": lambda text: apply("info", text),
        "step": lambda text: apply("step", text),
        "substep": lambda text: apply("substep", text),
        "success": lambda text: apply("success", text),
        "fail": lambda text: apply("fail", text),
    }
