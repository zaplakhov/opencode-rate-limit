#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path


def _has_backlog_table(text: str) -> bool:
    has_header = "| ID | Title | Type | Status | Spec | Updated |" in text
    has_sep = "|----" in text
    return has_header and has_sep


def main() -> int:
    project_root = Path(__file__).resolve().parents[2]
    errors: list[str] = []

    opencode_json = project_root / "opencode.json"
    if not opencode_json.exists():
        errors.append("Missing opencode.json in project root")

    ai_dir = project_root / "ai"
    if not ai_dir.exists():
        errors.append("Missing ai/ directory")

    for p in [ai_dir / "features", ai_dir / "diary"]:
        if not p.exists():
            errors.append(f"Missing {p.relative_to(project_root)}")

    backlog = ai_dir / "backlog.md"
    if not backlog.exists():
        errors.append("Missing ai/backlog.md")
    else:
        text = backlog.read_text(encoding="utf-8", errors="replace")
        if not _has_backlog_table(text):
            errors.append("ai/backlog.md does not contain the required backlog table header")

    if errors:
        print("PA validation FAILED:")
        for e in errors:
            print(f"- {e}")
        return 2

    print("PA validation OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
