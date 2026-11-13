#!/usr/bin/env python3
"""Validate Chat-cipher JSONL shards; write clean/ + rejected/ copies and a report."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "data"
REQUIRED = ("id", "topic", "messages", "worker", "model", "created_at")
MARKDOWN = re.compile(r"(^|\s)([-*`]|#{1,6}\s|\[.+\]\(.+\))")
SPEAKER = re.compile(r"^(me|user|assistant|speaker)\s*:", re.I)
URL = re.compile(r"https?://|www\.", re.I)
PHONE = re.compile(r"\b\+?\d[\d\s\-()]{8,}\b")
# Rough language bleed: Latin chat with heavy English function words in non-EN packs
# English-looking tokens that are NOT also common words in other target langs.
EN_BLEED = re.compile(
    r"\b(the|and|you|that|this|with|have|just|gonna|wanna|lol|hey|okay|because|really|something)\b",
    re.I,
)
# Tokens that look English in isolation but are native in PL/SK/DE/FR/ES — never count as bleed.
EN_BLEED_ALLOW = {
    "pl": {"no", "was", "to", "on", "do", "po", "za", "na", "co", "ok", "hej", "papa", "super"},
    "sk": {"to", "on", "do", "po", "za", "na", "co", "ok", "hej", "super", "ale"},
    "de": {"ok", "hey", "so", "war", "in", "an", "am", "im", "lol"},
    "fr": {"ok", "hey", "a", "an", "on", "or", "as", "si", "la", "le"},
    "es": {"ok", "hey", "a", "si", "no", "la", "el", "un", "me", "te"},
}

LANG_EXPECT_EN = {"en"}

# Czech orthography / strongly Czech-only forms that should not appear in SK shards.
# Unaccented nic/chlieb/mlieko stay allowed (casual SK drops marks); ě/ř/ů are Czech-only letters.
CZ_ORTHO = re.compile(r"[ěřů]")
CZ_WORD = re.compile(
    r"\b(protože|protoze|zkusím|zkusim|mluvit|uklízám|uklizam|pramůjdeme|pramojdme|"
    r"fakt\s+jo|děkuju|dekuju|prosím\s+tě|prosim\s+te)\b",
    re.I,
)


def msg_sig(messages: list[str]) -> str:
    norm = "\n".join(m.strip().lower() for m in messages)
    return hashlib.sha1(norm.encode("utf-8")).hexdigest()


def reasons(row: dict, lang: str, seen_ids: set[str], seen_sigs: Counter) -> list[str]:
    bad: list[str] = []
    for k in REQUIRED:
        if k not in row:
            bad.append(f"missing:{k}")
    if bad:
        return bad
    rid = row["id"]
    if not isinstance(rid, str) or not rid:
        bad.append("bad_id")
    elif rid in seen_ids:
        bad.append("dup_id")
    msgs = row["messages"]
    if not isinstance(msgs, list) or not all(isinstance(m, str) and m.strip() for m in msgs):
        bad.append("bad_messages")
        return bad
    if not (4 <= len(msgs) <= 20):
        bad.append(f"msg_count:{len(msgs)}")
    joined = "\n".join(msgs)
    if MARKDOWN.search(joined):
        bad.append("markdown")
    if any(SPEAKER.match(m.strip()) for m in msgs):
        bad.append("speaker_label")
    if URL.search(joined):
        bad.append("url")
    if PHONE.search(joined):
        bad.append("phone")
    sig = msg_sig(msgs)
    if seen_sigs[sig] > 0:
        bad.append("dup_messages")
    if lang not in LANG_EXPECT_EN:
        allow = EN_BLEED_ALLOW.get(lang, set())
        tokens = re.findall(r"[A-Za-zÀ-ž]+", joined)
        if tokens:
            en_hits = sum(
                1
                for t in tokens
                if EN_BLEED.fullmatch(t) and t.casefold() not in allow
            )
            if en_hits >= max(3, len(tokens) // 4):
                bad.append("en_bleed")
    if lang == "sk":
        # Slovak reflexive is "sa"; bare Czech "se" / Czech letters / Czech lemmas → reject.
        if CZ_ORTHO.search(joined) or CZ_WORD.search(joined):
            bad.append("czech_bleed")
        # doubled-letter corruption from noisy local gens (nemamm, uzz)
        if re.search(r"\b\w*([a-záäčďéíĺľňóôŕšťúýž])\1{2,}\w*\b", joined, re.I):
            bad.append("corrupt_token")
    return bad


def process_lang(lang: str) -> dict:
    base = ROOT / f"chat-cipher-{lang}"
    shards = base / "shards"
    clean_dir = base / "clean"
    rej_dir = base / "rejected"
    clean_dir.mkdir(parents=True, exist_ok=True)
    rej_dir.mkdir(parents=True, exist_ok=True)

    seen_ids: set[str] = set()
    seen_sigs: Counter = Counter()
    stats = Counter()
    reason_counts = Counter()
    clean_path = clean_dir / "all.clean.jsonl"
    rej_path = rej_dir / "all.rejected.jsonl"

    files = sorted(shards.glob("*.jsonl")) if shards.exists() else []
    with clean_path.open("w", encoding="utf-8") as clean_f, rej_path.open(
        "w", encoding="utf-8"
    ) as rej_f:
        for path in files:
            for line_no, line in enumerate(path.open(encoding="utf-8"), 1):
                line = line.strip()
                if not line:
                    continue
                stats["total"] += 1
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    stats["rejected"] += 1
                    reason_counts["json"] += 1
                    rej_f.write(
                        json.dumps(
                            {"file": path.name, "line": line_no, "reasons": ["json"], "raw": line[:500]},
                            ensure_ascii=False,
                        )
                        + "\n"
                    )
                    continue
                if not isinstance(row, dict):
                    stats["rejected"] += 1
                    reason_counts["not_object"] += 1
                    continue
                bad = reasons(row, lang, seen_ids, seen_sigs)
                sig = msg_sig(row["messages"]) if isinstance(row.get("messages"), list) else ""
                if bad:
                    stats["rejected"] += 1
                    for r in bad:
                        reason_counts[r] += 1
                    rej_f.write(
                        json.dumps(
                            {"file": path.name, "line": line_no, "reasons": bad, "id": row.get("id")},
                            ensure_ascii=False,
                        )
                        + "\n"
                    )
                    continue
                seen_ids.add(row["id"])
                seen_sigs[sig] += 1
                stats["kept"] += 1
                clean_f.write(json.dumps(row, ensure_ascii=False) + "\n")

    report = {
        "lang": lang,
        "files": len(files),
        "total": stats["total"],
        "kept": stats["kept"],
        "rejected": stats["rejected"],
        "reasons": dict(reason_counts),
        "clean": str(clean_path),
        "rejected_path": str(rej_path),
    }
    (base / "QUALITY_REPORT.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return report


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--lang", action="append", default=[])
    args = p.parse_args(argv)
    langs = args.lang or ["en", "de", "es", "fr", "sk", "pl"]
    reports = [process_lang(lang) for lang in langs]
    print(json.dumps(reports, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
