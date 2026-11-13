#!/usr/bin/env python3
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "data"

print("=== CLEAN vs RAW ===")
for lang in ["en", "de", "es", "fr", "sk", "pl"]:
    r = json.loads((ROOT / f"chat-cipher-{lang}" / "QUALITY_REPORT.json").read_text(encoding="utf-8"))
    keep = 100 * r["kept"] / r["total"] if r["total"] else 0
    print(f"{lang}: raw={r['total']} kept={r['kept']} keep%={keep:.0f} reasons={r['reasons']}")

print()
for lang in ["sk", "en", "de", "fr", "es", "pl"]:
    path = ROOT / f"chat-cipher-{lang}" / "clean" / "all.clean.jsonl"
    models: Counter[str] = Counter()
    topics: Counter[str] = Counter()
    workers: Counter[str] = Counter()
    local = 0
    natural = 0
    n = 0
    for line in path.open(encoding="utf-8"):
        o = json.loads(line)
        n += 1
        m = str(o.get("model", "?"))
        models[m] += 1
        topics[str(o.get("topic", "?"))] += 1
        workers[str(o.get("worker", "?"))] += 1
        if "local" in m or "phrasebank" in m or "bulk" in m:
            local += 1
        else:
            natural += 1
    print(f"=== {lang} clean === bursts={n} topics={len(topics)}")
    print(f"  local-ish={local} natural-ish={natural} ({100*natural/n:.0f}% natural)")
    for m, c in models.most_common(6):
        print(f"  {c:5d} {m}")

# sample 3 SK local bursts for quality sniff
print("\n=== SK sample (local-bulk) ===")
path = ROOT / "chat-cipher-sk" / "clean" / "all.clean.jsonl"
shown = 0
for line in path.open(encoding="utf-8"):
    o = json.loads(line)
    if "local" not in str(o.get("model", "")):
        continue
    print(json.dumps({"id": o["id"], "topic": o["topic"], "messages": o["messages"]}, ensure_ascii=False))
    shown += 1
    if shown >= 3:
        break

print("\n=== SK sample (swe/high) ===")
shown = 0
for line in path.open(encoding="utf-8"):
    o = json.loads(line)
    m = str(o.get("model", ""))
    if "swe" not in m and "high" not in m:
        continue
    print(json.dumps({"id": o["id"], "topic": o["topic"], "messages": o["messages"], "model": m}, ensure_ascii=False))
    shown += 1
    if shown >= 2:
        break
