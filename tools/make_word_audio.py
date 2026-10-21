"""Generate the single-word recordings audio/<id>.mp3 with edge-tts (Microsoft neural voices).

Run from the repo root:
    python tools/make_word_audio.py            # every word in words.json
    python tools/make_word_audio.py heap debug # only these ids
Options: --voice (default en-US-AvaNeural), --volume (edge-tts percentage, default +50%:
roughly matches the loudness of the example-sentence recordings; +100% is no louder).

Example-sentence recordings (audio/<id>-ex.mp3) are not touched. The service pads each
clip with ~1 s of trailing silence; frames after the end of speech (+TAIL) are dropped,
using the word-boundary timing edge-tts returns. Needs: pip install edge-tts==7.3.1
"""
import argparse
import asyncio
import json
from pathlib import Path

import edge_tts

TAIL = 0.25  # seconds kept after the spoken word
# MPEG audio header tables (Layer III only)
BITRATES = {1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
            2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]}
RATES = {3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000]}


def frames(data):
    """Yield (offset, length, seconds) for each MPEG Layer III frame."""
    i = 0
    if data[:3] == b"ID3":
        i = 10 + ((data[6] & 0x7F) << 21 | (data[7] & 0x7F) << 14 | (data[8] & 0x7F) << 7 | (data[9] & 0x7F))
    while i + 4 <= len(data):
        b1, b2, b3 = data[i + 1], data[i + 2], data[i + 3]
        if data[i] != 0xFF or (b1 & 0xE0) != 0xE0 or (b1 >> 1) & 3 != 1:
            raise ValueError(f"not an MPEG Layer III frame at byte {i}")
        ver = (b1 >> 3) & 3                     # 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
        kbps = BITRATES[1 if ver == 3 else 2][b2 >> 4]
        rate = RATES[ver][(b2 >> 2) & 3]
        samples = 1152 if ver == 3 else 576
        length = samples // 8 * kbps * 1000 // rate + ((b2 >> 1) & 1)
        yield i, length, samples / rate
        i += length


def trim(data, end_sec):
    out, t = bytearray(), 0.0
    for off, length, dur in frames(data):
        if t > end_sec:
            break
        out += data[off:off + length]
        t += dur
    return bytes(out)


async def synth(text, voice, volume, tries=4):
    for k in range(tries):
        try:
            audio, end = bytearray(), 0.0
            com = edge_tts.Communicate(text, voice, volume=volume, boundary="WordBoundary")
            async for c in com.stream():
                if c["type"] == "audio":
                    audio += c["data"]
                elif c["type"] == "WordBoundary":
                    end = max(end, (c["offset"] + c["duration"]) / 1e7)  # 100-ns units
            if audio:
                return bytes(audio), end
        except edge_tts.exceptions.NoAudioReceived:
            pass
        await asyncio.sleep(1.5 * (k + 1))
    raise RuntimeError(f"no audio for {text!r}")


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ids", nargs="*")
    ap.add_argument("--voice", default="en-US-AvaNeural")
    ap.add_argument("--volume", default="+50%")
    args = ap.parse_args()

    words = json.loads(Path("words.json").read_text(encoding="utf-8"))
    if args.ids:
        unknown = set(args.ids) - {w["id"] for w in words}
        if unknown:
            raise SystemExit(f"not in words.json: {sorted(unknown)}")
        words = [w for w in words if w["id"] in args.ids]
    for n, w in enumerate(words, 1):
        audio, end = await synth(w["word"], args.voice, args.volume)
        clip = trim(audio, end + TAIL) if end else audio
        Path("audio", w["id"] + ".mp3").write_bytes(clip)
        print(f"[{n}/{len(words)}] {w['id']}: speech ends {end:.2f}s, {len(audio)} -> {len(clip)} bytes")


if __name__ == "__main__":
    asyncio.run(main())
