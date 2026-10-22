"""Build changelog.json from CHANGELOG.md (the single source of version info).

Run from the repo root:
    python tools/build_changelog.py              # validate + write changelog.json
    python tools/build_changelog.py --notes 2.1.0  # print that version's notes (for GitHub Releases)
    python tools/build_changelog.py --versions     # print every version, newest first

CHANGELOG.md sections look like `## [2.1.0] - 2026-10-22` followed by `- ` items.
Versions must be X.Y.Z, strictly decreasing from top to bottom, each with a date
and at least one item; anything else exits with an error so deployment stops.
tools/stamp_sw.py calls build() before stamping the service worker.
"""
import argparse
import json
import re
import sys
from pathlib import Path

HEAD = re.compile(r"^## \[(\d+)\.(\d+)\.(\d+)\] - (\d{4}-\d{2}-\d{2})\s*$")


def parse(text):
    entries, cur = [], None
    for n, line in enumerate(text.splitlines(), 1):
        if line.startswith("## "):
            m = HEAD.match(line)
            if not m:
                raise ValueError(f"CHANGELOG.md:{n}: heading must look like '## [1.2.3] - 2026-10-22'")
            cur = {"version": ".".join(m.group(1, 2, 3)), "key": tuple(int(x) for x in m.group(1, 2, 3)),
                   "date": m.group(4), "items": []}
            entries.append(cur)
        elif cur and line.startswith("- "):
            cur["items"].append(line[2:].strip())
    if not entries:
        raise ValueError("CHANGELOG.md has no versions")
    for a, b in zip(entries, entries[1:]):
        if not a["key"] > b["key"]:
            raise ValueError(f"versions must decrease from top to bottom: {a['version']} then {b['version']}")
    for e in entries:
        if not e["items"]:
            raise ValueError(f"{e['version']} has no items")
    return entries


def build(root="."):
    root = Path(root)
    entries = parse((root / "CHANGELOG.md").read_text(encoding="utf-8"))
    data = [{k: e[k] for k in ("version", "date", "items")} for e in entries]
    out = root / "changelog.json"
    text = json.dumps(data, ensure_ascii=False, indent=1) + "\n"
    if not out.exists() or out.read_text(encoding="utf-8") != text:
        out.write_text(text, encoding="utf-8", newline="\n")
    return data


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--notes")
    ap.add_argument("--versions", action="store_true")
    args = ap.parse_args()
    try:
        data = build()
    except ValueError as e:
        raise SystemExit(f"CHANGELOG error: {e}")
    sys.stdout.reconfigure(encoding="utf-8")
    if args.notes:
        v = args.notes.lstrip("v")
        e = next((e for e in data if e["version"] == v), None)
        if not e:
            raise SystemExit(f"version {v} not in CHANGELOG.md")
        print("\n".join("- " + i for i in e["items"]))
    elif args.versions:
        print("\n".join(e["version"] for e in data))
    else:
        print(f"changelog.json: {len(data)} versions, latest {data[0]['version']}")


if __name__ == "__main__":
    main()
