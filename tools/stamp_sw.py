"""Set `const VERSION = "...";` in sw.js to a hash of every file the service worker caches.

Run from the repo root before deploying (the GitHub Pages workflow runs it too):
    python tools/stamp_sw.py
Same content -> same version, so redeploying unchanged files does not make users
re-download the audio; any change to a cached file gives a new version.
"""
import hashlib
import re
from pathlib import Path

FILES = ["index.html", "css/style.css", "js/app.js", "words.json", "manifest.webmanifest"]
DIRS = ["icons", "audio"]


def main():
    h = hashlib.sha256()
    paths = [Path(f) for f in FILES]
    for d in DIRS:
        paths += sorted(p for p in Path(d).rglob("*") if p.is_file())
    for p in paths:
        h.update(p.as_posix().encode() + b"\0" + p.read_bytes() + b"\0")
    version = h.hexdigest()[:12]

    sw = Path("sw.js")
    text = sw.read_text(encoding="utf-8")
    new, n = re.subn(r'const VERSION = "[^"]*";', f'const VERSION = "{version}";', text, count=1)
    if n != 1:
        raise SystemExit("VERSION line not found in sw.js")
    if new != text:
        sw.write_text(new, encoding="utf-8", newline="\n")
    print("sw.js VERSION =", version)


if __name__ == "__main__":
    main()
