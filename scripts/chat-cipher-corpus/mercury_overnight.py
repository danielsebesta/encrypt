#!/usr/bin/env python3
"""Overnight Mercury natural corpus loop until soft natural targets or max rounds."""
from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
PY = sys.executable
GEN = Path(__file__).with_name("mercury_gen.py")
FILTER = Path(__file__).with_name("validate_filter.py")
SPLIT = Path(__file__).with_name("split_natural.py")

# Soft natural floors (stretch) — keep going until hit or max_cycles
TARGETS = {"en": 4000, "sk": 2500, "de": 2500, "es": 2500, "fr": 2500, "pl": 2500}
LANG_ORDER = ["sk", "de", "fr", "pl", "es", "en"]


def natural_counts() -> dict[str, int]:
    out = {}
    for lang in LANG_ORDER:
        p = DATA / f"chat-cipher-{lang}" / "clean" / "natural.clean.jsonl"
        if not p.exists():
            out[lang] = 0
            continue
        out[lang] = sum(1 for line in p.open(encoding="utf-8") if line.strip())
    return out


def run(cmd: list[str]) -> int:
    print("+", " ".join(cmd), flush=True)
    return subprocess.call(cmd, cwd=str(ROOT))


def main() -> int:
    max_cycles = int(sys.argv[1]) if len(sys.argv) > 1 else 40
    for cycle in range(1, max_cycles + 1):
        counts = natural_counts()
        print(f"\n=== cycle {cycle}/{max_cycles} natural={counts} ===", flush=True)
        remaining = [lang for lang in LANG_ORDER if counts.get(lang, 0) < TARGETS[lang]]
        if not remaining:
            print("All natural soft targets reached.", flush=True)
            break
        # Prefer thin langs; 2 batches x 8 bursts each per cycle
        code = run(
            [
                PY,
                str(GEN),
                "--worker",
                f"mercury-c{cycle:02d}",
                "--effort",
                "low",
                "--per-batch",
                "8",
                "--batches",
                "2",
                "--rounds",
                "1",
                *[a for lang in remaining for a in ("--lang", lang)],
            ]
        )
        if code != 0:
            print(f"gen exit {code}, sleeping", flush=True)
            time.sleep(5)
        run([PY, str(FILTER)])
        run([PY, str(SPLIT)])
        time.sleep(0.5)
    counts = natural_counts()
    (DATA / "chat-cipher-MERCURY_STATUS.json").write_text(
        json.dumps({"natural": counts, "targets": TARGETS}, indent=2) + "\n",
        encoding="utf-8",
    )
    print("FINAL", counts, flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
