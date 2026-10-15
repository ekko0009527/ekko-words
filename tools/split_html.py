"""Split the original single-file ekko-words.html into words.json and audio/*.mp3.

Usage:
    python tools/split_html.py <ekko-words.html> [--out .]

The original file keeps the word list in a `const WORDS = [ ... ];` block
(one array per line: [word, ipa, pos, zh, example, exampleZh, deck]) and the
recordings in a single `const AUDIO = {id: [wordB64, exampleB64]};` line.
Only data is extracted; HTML/CSS/JS are maintained by hand in this repo.
"""
import argparse
import base64
import json
import re
from pathlib import Path

FIELDS = ["word", "ipa", "pos", "zh", "ex", "exZh", "deck"]
ID_RE = re.compile(r"[a-z0-9-]+")


def find_line(lines, prefix, start=0):
    for i in range(start, len(lines)):
        if lines[i].startswith(prefix):
            return i
    raise SystemExit(f"marker not found: {prefix!r}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("html")
    ap.add_argument("--out", default=".")
    args = ap.parse_args()

    out = Path(args.out)
    lines = Path(args.html).read_text(encoding="utf-8").split("\n")

    w0 = find_line(lines, "const WORDS = [")
    w1 = find_line(lines, "];", w0)
    rows = json.loads("[" + "\n".join(lines[w0 + 1:w1]).rstrip().rstrip(",") + "]")

    a0 = find_line(lines, "const AUDIO = ")
    audio = json.loads(lines[a0][len("const AUDIO = "):].rstrip().rstrip(";"))

    words = []
    for r in rows:
        if len(r) != len(FIELDS):
            raise SystemExit(f"bad row: {r!r}")
        item = {"id": r[0], **dict(zip(FIELDS, r))}
        if not ID_RE.fullmatch(item["id"]):
            raise SystemExit(f"id not filename-safe: {item['id']!r}")
        words.append(item)

    ids = [w["id"] for w in words]
    if len(set(ids)) != len(ids):
        raise SystemExit("duplicate ids")
    missing = [i for i in ids if i not in audio]
    extra = [k for k in audio if k not in set(ids)]
    if missing or extra:
        raise SystemExit(f"audio mismatch: missing={missing} extra={extra}")

    body = ",\n".join("  " + json.dumps(w, ensure_ascii=False) for w in words)
    (out / "words.json").write_text("[\n" + body + "\n]\n", encoding="utf-8")

    adir = out / "audio"
    adir.mkdir(parents=True, exist_ok=True)
    total = 0
    for i in ids:
        for name, b64 in ((f"{i}.mp3", audio[i][0]), (f"{i}-ex.mp3", audio[i][1])):
            data = base64.b64decode(b64)
            if not data.startswith(b"ID3"):
                raise SystemExit(f"{name}: not an MP3 with ID3 header")
            (adir / name).write_bytes(data)
            total += len(data)

    print(f"words: {len(words)}  audio files: {len(ids) * 2}  audio bytes: {total}")


if __name__ == "__main__":
    main()
