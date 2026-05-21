#!/usr/bin/env python3
"""
Add .js extensions to relative TS imports across lib/, api/, src/, tests/.

Required for Vercel cloud builds: @vercel/node's per-function tsc check runs
under nodenext moduleResolution which mandates explicit .js extensions on
relative imports. Our tsconfig uses moduleResolution: "bundler" which permits
extensionless imports, so locally and in Vite/Vitest builds we never noticed.

Transforms:
  from './foo'           -> from './foo.js'
  from '../bar/baz'      -> from '../bar/baz.js'
  import type { X } from './y'  -> import type { X } from './y.js'

Leaves alone:
  package imports        (no leading dot)
  alias imports          (start with @/, @lib/, @tests/)
  already-suffixed       (.js, .json, .css)
  type-only `import 'X'` with no `from` (no path manipulation needed)

Usage:
  python3 scripts/migrations/add-js-extensions.py [--dry-run]
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOTS = ["lib", "api", "src", "tests"]
EXTENSIONS = {".ts", ".tsx"}
SKIP_SUFFIXES = (".js", ".json", ".css", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif")

# Matches `from '...'` or `from "..."` where the path is relative (starts with . or ..)
IMPORT_PATTERN = re.compile(r"""(from\s+['"])(\.\.?/[^'"]+?)(['"])""")


def transform(content: str) -> tuple[str, int]:
    count = 0

    def replace(m: re.Match[str]) -> str:
        nonlocal count
        prefix, path, suffix = m.group(1), m.group(2), m.group(3)
        if path.endswith(SKIP_SUFFIXES):
            return m.group(0)
        count += 1
        return f"{prefix}{path}.js{suffix}"

    new_content = IMPORT_PATTERN.sub(replace, content)
    return new_content, count


def main() -> int:
    dry_run = "--dry-run" in sys.argv
    root = Path(__file__).resolve().parent.parent.parent

    files_touched = 0
    imports_rewritten = 0
    per_dir: dict[str, int] = {d: 0 for d in ROOTS}

    for top in ROOTS:
        base = root / top
        if not base.exists():
            continue
        for path in base.rglob("*"):
            if not path.is_file() or path.suffix not in EXTENSIONS:
                continue
            content = path.read_text(encoding="utf-8")
            new_content, count = transform(content)
            if count == 0:
                continue
            files_touched += 1
            imports_rewritten += count
            per_dir[top] += count
            if not dry_run:
                path.write_text(new_content, encoding="utf-8")

    label = "Would rewrite" if dry_run else "Rewrote"
    print(f"{label} {imports_rewritten} imports across {files_touched} files")
    for d, n in per_dir.items():
        if n:
            print(f"  {d}/ : {n}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
