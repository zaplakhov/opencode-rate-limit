#!/usr/bin/env python3
# Project-local Project Autopilot Setup (self-contained)
#
# Usage:
#   python3 .opencode/tools/pa-setup.py --mode interactive|project|full [--profile NAME]
#
# This file is installed/updated by the global bootstrap.

from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import Path
from typing import Literal

Mode = Literal["interactive", "project", "full"]

BACKLOG_TEMPLATE = '# Project Autopilot Backlog\n\n| ID | Title | Type | Status | Spec | Updated |\n|----|-------|------|--------|------|---------|\n| TEMPLATE | Add first item via /pa-spark | - | NEW | - | 1970-01-01 |\n'
GITIGNORE_TEMPLATE = '# Project Autopilot\n__pycache__/\n*.pyc\n*.pyo\n*.pyd\n.pytest_cache/\n.mypy_cache/\n.ruff_cache/\n\n# Local tooling cache\n.opencode/tools/__pycache__/\n\n# macOS\n.DS_Store\nsession-ses_*.md\n\n# Secrets\n.env\n.env.*\n'
VALIDATOR_CODE = '#!/usr/bin/env python3\nfrom __future__ import annotations\n\nfrom pathlib import Path\n\n\ndef _has_backlog_table(text: str) -> bool:\n    has_header = "| ID | Title | Type | Status | Spec | Updated |" in text\n    has_sep = "|----" in text\n    return has_header and has_sep\n\n\ndef main() -> int:\n    project_root = Path(__file__).resolve().parents[2]\n    errors: list[str] = []\n\n    opencode_json = project_root / "opencode.json"\n    if not opencode_json.exists():\n        errors.append("Missing opencode.json in project root")\n\n    ai_dir = project_root / "ai"\n    if not ai_dir.exists():\n        errors.append("Missing ai/ directory")\n\n    for p in [ai_dir / "features", ai_dir / "diary"]:\n        if not p.exists():\n            errors.append(f"Missing {p.relative_to(project_root)}")\n\n    backlog = ai_dir / "backlog.md"\n    if not backlog.exists():\n        errors.append("Missing ai/backlog.md")\n    else:\n        text = backlog.read_text(encoding="utf-8", errors="replace")\n        if not _has_backlog_table(text):\n            errors.append("ai/backlog.md does not contain the required backlog table header")\n\n    if errors:\n        print("PA validation FAILED:")\n        for e in errors:\n            print(f"- {e}")\n        return 2\n\n    print("PA validation OK")\n    return 0\n\n\nif __name__ == "__main__":\n    raise SystemExit(main())\n'


def run(cmd: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    env = dict(os.environ)
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    return subprocess.run(cmd, cwd=str(cwd), text=True, capture_output=True, env=env)


def ensure_git_repo(project_root: Path) -> str:
    p = run(["git", "--version"], cwd=project_root)
    if p.returncode != 0:
        raise RuntimeError("Git не найден. Установи Git и повтори.\n" + (p.stderr or ""))

    p = run(["git", "rev-parse", "--is-inside-work-tree"], cwd=project_root)
    if p.returncode == 0:
        return "existing"

    p = run(["git", "init"], cwd=project_root)
    if p.returncode != 0:
        raise RuntimeError("Не удалось выполнить git init.\n" + (p.stderr or ""))

    return "initialized"


def ensure_dirs(project_root: Path) -> None:
    (project_root / ".opencode" / "tools").mkdir(parents=True, exist_ok=True)
    (project_root / ".opencode" / "config-profiles").mkdir(parents=True, exist_ok=True)
    (project_root / "ai").mkdir(parents=True, exist_ok=True)
    (project_root / "ai" / "features").mkdir(parents=True, exist_ok=True)
    (project_root / "ai" / "diary").mkdir(parents=True, exist_ok=True)


def ensure_gitignore(project_root: Path) -> None:
    path = project_root / ".gitignore"
    if path.exists():
        return
    path.write_text(GITIGNORE_TEMPLATE, encoding="utf-8")


def write_backlog(project_root: Path) -> None:
    path = project_root / "ai" / "backlog.md"
    if not path.exists():
        path.write_text(BACKLOG_TEMPLATE, encoding="utf-8")
        return

    content = path.read_text(encoding="utf-8", errors="replace")

    # Harmless legacy placeholder migration (in case it exists)
    if "| _empty_ |" in content:
        content = content.replace("| _empty_ |", "| TEMPLATE |")
        path.write_text(content, encoding="utf-8")
        content = path.read_text(encoding="utf-8", errors="replace")

    # If canonical header exists, keep as-is
    if "| ID | Title | Type | Status | Spec | Updated |" in content and "|----" in content:
        return

    # Preserve unknown content under a fresh canonical table
    migrated = BACKLOG_TEMPLATE + "\n---\n\n## Migrated content (legacy)\n\n" + content.strip() + "\n"
    path.write_text(migrated, encoding="utf-8")


def write_validator(project_root: Path) -> None:
    path = project_root / ".opencode" / "tools" / "validate-pa-project.py"
    if path.exists():
        return
    path.write_text(VALIDATOR_CODE, encoding="utf-8")
    try:
        os.chmod(path, 0o755)
    except Exception:
        pass


def opencode_permissions(mode: Mode) -> dict:
    if mode == "interactive":
        bash = {
            "*": "ask",
            "git *": "allow",
            "echo *": "allow",
            "pwd": "allow",
            "ls *": "allow",
            "cat *": "allow",
            "mkdir *": "allow",
            "python3 *": "allow",
            "python *": "allow",
            "node *": "allow",
            "npm *": "allow",
            "pnpm *": "allow",
            "yarn *": "allow",
            "bun *": "allow",
            "pytest *": "allow",
            "go *": "allow",
            "cargo *": "allow",
            "make *": "allow",
            "rm *": "ask",
            "cp *": "ask",
            "mv *": "ask",
        }
        return {"bash": bash}

    if mode == "project":
        bash = {
            "*": "ask",
            "git *": "allow",
            "echo *": "allow",
            "pwd": "allow",
            "ls *": "allow",
            "cat *": "allow",
            "mkdir *": "allow",
            "python3 *": "allow",
            "python *": "allow",
            "node *": "allow",
            "npm *": "allow",
            "pnpm *": "allow",
            "yarn *": "allow",
            "bun *": "allow",
            "pytest *": "allow",
            "go *": "allow",
            "cargo *": "allow",
            "make *": "allow",
            "rm *": "allow",
            "cp *": "allow",
            "mv *": "allow",
        }
        return {"bash": bash}

    return {"external_directory": "allow", "bash": {"*": "allow"}}


def write_opencode_json(project_root: Path, mode: Mode) -> None:
    path = project_root / "opencode.json"
    data = {
        "$schema": "https://opencode.ai/config.json",
        "permission": opencode_permissions(mode),
    }
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_profile(project_root: Path, profile: str, mode: Mode) -> None:
    path = project_root / ".opencode" / "config-profiles" / f"{profile}.json"
    if path.exists():
        return
    data = {
        "name": profile,
        "mode": mode,
    }
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def run_validation(project_root: Path) -> None:
    validator = project_root / ".opencode" / "tools" / "validate-pa-project.py"
    p = run(["python3", str(validator)], cwd=project_root)
    print(p.stdout.strip())
    if p.returncode != 0:
        raise RuntimeError("Validation failed:\n" + (p.stderr or "").strip())


def maybe_initial_commit(project_root: Path) -> None:
    # Commit only if repo has no commits yet
    p = run(["git", "rev-parse", "--verify", "HEAD"], cwd=project_root)
    if p.returncode == 0:
        return

    run(["git", "add", "."], cwd=project_root)
    c = run(["git", "commit", "-m", "chore: initial PA setup"], cwd=project_root)
    if c.returncode != 0:
        return


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", required=True, choices=["interactive", "project", "full"])
    parser.add_argument("--profile", required=False, default=None)
    args = parser.parse_args()

    project_root = Path.cwd().resolve()

    repo_status = ensure_git_repo(project_root)
    ensure_dirs(project_root)
    ensure_gitignore(project_root)
    write_backlog(project_root)
    write_validator(project_root)
    write_opencode_json(project_root, args.mode)  # type: ignore[arg-type]

    if args.profile:
        write_profile(project_root, args.profile, args.mode)  # type: ignore[arg-type]

    run_validation(project_root)
    maybe_initial_commit(project_root)

    print(f"PA setup done. repo_status={repo_status} mode={args.mode}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
