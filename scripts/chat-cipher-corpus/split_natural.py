#!/usr/bin/env python3
"""Split clean JSONL into natural (swe-*) vs local phrasebank tiers."""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "data"
LANGS = ["en", "de", "es", "fr", "sk", "pl"]


def is_natural(model: str) -> bool:
    m = (model or "").lower()
    return any(x in m for x in ("swe-2", "swe2", "high", "flash")) and "local" not in m


def main() -> None:
    summary = []
    for lang in LANGS:
        base = ROOT / f"chat-cipher-{lang}"
        src = base / "clean" / "all.clean.jsonl"
        if not src.exists():
            continue
        nat = base / "clean" / "natural.clean.jsonl"
        loc = base / "clean" / "local.clean.jsonl"
        counts = Counter()
        with src.open(encoding="utf-8") as f, nat.open("w", encoding="utf-8") as nf, loc.open(
            "w", encoding="utf-8"
        ) as lf:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                row = json.loads(line)
                if is_natural(str(row.get("model", ""))):
                    nf.write(json.dumps(row, ensure_ascii=False) + "\n")
                    counts["natural"] += 1
                else:
                    lf.write(json.dumps(row, ensure_ascii=False) + "\n")
                    counts["local"] += 1
        report = {
            "lang": lang,
            "natural": counts["natural"],
            "local": counts["local"],
            "total": counts["natural"] + counts["local"],
            "natural_pct": round(100 * counts["natural"] / max(1, counts["natural"] + counts["local"]), 1),
            "natural_path": str(nat),
            "local_path": str(loc),
        }
        (base / "TIER_REPORT.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        summary.append(report)
        print(
            f"{lang}: natural={report['natural']} local={report['local']} "
            f"({report['natural_pct']}% natural)"
        )
    (ROOT / "chat-cipher-TIER_SUMMARY.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
