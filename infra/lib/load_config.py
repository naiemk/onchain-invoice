#!/usr/bin/env python3
"""Load infra packageconfig.yaml without external deps (subset YAML)."""
from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Any


def _strip_quotes(s: str) -> str:
    s = s.strip()
    if (s.startswith('"') and s.endswith('"')) or (s.startswith("'") and s.endswith("'")):
        return s[1:-1]
    return s


def load_packageconfig(path: Path) -> dict[str, Any]:
    try:
        import yaml  # type: ignore

        with path.open(encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    except ImportError:
        return _parse_minimal(path.read_text(encoding="utf-8"))


def _parse_minimal(text: str) -> dict[str, Any]:
    """Parse flat/nested keys for our packageconfig shape only."""
    root: dict[str, Any] = {}
    stack: list[tuple[int, dict[str, Any]]] = [(-1, root)]
    list_key: str | None = None
    list_indent = -1

    for raw in text.splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        indent = len(raw) - len(raw.lstrip(" "))
        line = raw.lstrip()
        while stack and indent <= stack[-1][0]:
            stack.pop()
            if list_indent >= 0 and indent <= list_indent:
                list_key = None
                list_indent = -1
        parent = stack[-1][1]

        if line.startswith("- ") and list_key and isinstance(parent.get(list_key), list):
            item: dict[str, Any] = {}
            rest = line[2:].strip()
            if ":" in rest:
                k, _, v = rest.partition(":")
                item[k.strip()] = _strip_quotes(v.strip())
            parent[list_key].append(item)
            stack.append((indent, item))
            continue

        if ":" not in line:
            continue
        key, _, rest = line.partition(":")
        key = key.strip()
        rest = rest.strip()
        if rest == "":
            if key.endswith("s") or key in ("sites", "aliases", "extras", "services", "flags"):
                parent[key] = []
                list_key = key
                list_indent = indent
            else:
                child: dict[str, Any] = {}
                parent[key] = child
                stack.append((indent, child))
        elif rest.startswith("[") and rest.endswith("]"):
            inner = rest[1:-1].strip()
            parent[key] = [_strip_quotes(x.strip()) for x in inner.split(",") if x.strip()] if inner else []
        else:
            parent[key] = _strip_quotes(rest)
    return root


def get_profile(conf: dict[str, Any], name: str) -> dict[str, Any]:
    profiles = conf.get("profiles") or {}
    if name not in profiles:
        raise KeyError(f"profile not found: {name}")
    return profiles[name]


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: load_config.py <packageconfig> <profile> [key...]", file=sys.stderr)
        return 2
    conf = load_packageconfig(Path(sys.argv[1]))
    prof = get_profile(conf, sys.argv[2])
    node: Any = prof
    for k in sys.argv[3:]:
        if isinstance(node, dict):
            node = node.get(k, "")
        else:
            node = ""
    if isinstance(node, (dict, list)):
        import json

        print(json.dumps(node))
    else:
        print(node)
    return 0


if __name__ == "__main__":
    sys.exit(main())
