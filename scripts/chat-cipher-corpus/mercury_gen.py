#!/usr/bin/env python3
"""Generate natural one-writer chat bursts via Inception Mercury 3.

Reads INCEPTION_API_KEY from env or repo .env.local (gitignored).
Never prints the key.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
API = "https://api.inceptionlabs.ai/v1/chat/completions"
MODEL = "mercury-3"
TZ = timezone(timedelta(hours=1))

TOPICS = {
    "en": [
        "errands", "food", "work", "smalltalk", "family", "weekend", "venting",
        "commute", "shopping", "pets", "weather", "fitness", "gaming", "plans-meetups",
    ],
    "de": [
        "errands", "essen", "arbeit", "smalltalk", "familie", "wochenende", "verkehr",
        "wetter", "pets", "fussball", "plaene", "serie",
    ],
    "es": [
        "errands", "food", "work", "smalltalk", "family", "weekend", "commute",
        "shopping", "pets", "plans-meetups", "venting", "weather",
    ],
    "fr": [
        "errands", "food", "work", "smalltalk", "family", "weekend", "commute",
        "shopping", "pharmacy", "plans-meetups", "venting",
    ],
    "sk": [
        "errands", "food", "work", "smalltalk", "family", "weekend", "commute",
        "shopping", "pets", "plans-meetups", "weather", "sports",
    ],
    "pl": [
        "errands", "food", "work", "smalltalk", "family", "weekend", "commute",
        "shopping", "pets", "plans-meetups", "weather", "sports",
    ],
}

LANG_HINT = {
    "en": "Casual informal English (Messenger/WhatsApp). Lowercase ok. Contractions u/ur/gonna/wanna/rn/tbh. Light typos ok. No markdown.",
    "de": "Umgangssprachliches Deutsch, duzen. Abkürzungen (grad, ham, is). Kein Englisch-Sätze. Kein Markdown.",
    "es": "Español informal de tú (LatAm/Spain mix). Sin usted/vosotros. Sin markdown.",
    "fr": "Français familier, tutoiement. Style Messenger. Pas de vouvoiement. Pas de markdown.",
    "sk": "Genuine Slovak only (not Czech). Use hej/nie/čo/keď/aj/lebo/sa/môj. No Czech letters ě/ř/ů, no protože/zkusím/mluvit. Casual chat. No markdown.",
    "pl": "Potoczny polski, forma ty. Fillers: no dobra, serio, mega, xd. Bez czeskiego/angielskiego. Bez markdown.",
}

SCHEMA = {
    "name": "ChatBursts",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "bursts": {
                "type": "array",
                "minItems": 1,
                "items": {
                    "type": "object",
                    "properties": {
                        "topic": {"type": "string"},
                        "messages": {
                            "type": "array",
                            "minItems": 4,
                            "maxItems": 12,
                            "items": {"type": "string"},
                        },
                    },
                    "required": ["topic", "messages"],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["bursts"],
        "additionalProperties": False,
    },
}


def load_key() -> str:
    key = os.environ.get("INCEPTION_API_KEY", "").strip()
    if key:
        return key
    env_path = ROOT / ".env.local"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("INCEPTION_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("INCEPTION_API_KEY missing (env or .env.local)")


def chat(key: str, prompt: str, *, effort: str, temperature: float, max_tokens: int) -> dict:
    body = {
        "model": MODEL,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You write realistic ONE-WRITER chat bursts for a privacy cover-text corpus. "
                    "Critical: every message in a burst is from the SAME person continuing a monologue "
                    "to a friend (updates, venting, planning aloud). NEVER write back-and-forth dialogue, "
                    "NEVER answer your own questions as a second person, NEVER use speaker labels. "
                    "No timestamps inside messages, no URLs, no phone numbers, no real PII. "
                    "Output only structured JSON matching the schema."
                ),
            },
            {"role": "user", "content": prompt},
        ],
        "reasoning_effort": effort,
        "temperature": temperature,
        "max_completion_tokens": max_tokens,
        "response_format": {"type": "json_schema", "json_schema": SCHEMA},
    }
    req = urllib.request.Request(
        API,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code}: {err[:500]}") from e


def build_prompt(lang: str, topics: list[str], n: int, seed: int) -> str:
    topic_line = ", ".join(topics)
    return (
        f"Language: {lang}\n"
        f"Style: {LANG_HINT[lang]}\n"
        f"Write exactly {n} distinct ONE-WRITER chat bursts (same person only).\n"
        f"Assign topics from this set (spread evenly, invent distinct scenarios): {topic_line}\n"
        f"Each burst: 5–9 short messages as a continuous stream from one texter "
        f"(e.g. 'running late', 'ugh traffic', 'be there in 10') — NOT a Q&A dialogue.\n"
        f"Natural topic drift ok, varied openers/endings. No duplicated first lines.\n"
        f"Seed hint: {seed}. Return JSON object with key bursts."
    )


def next_shard(lang: str, worker: str) -> Path:
    base = DATA / f"chat-cipher-{lang}"
    shards = base / "shards"
    shards.mkdir(parents=True, exist_ok=True)
    k = 1
    while True:
        path = shards / f"{lang}-{worker}-batch-{k:03d}.jsonl"
        if not path.exists():
            return path
        k += 1


def write_bursts(lang: str, worker: str, bursts: list[dict], start_id: int) -> tuple[Path, int]:
    path = next_shard(lang, worker)
    start = datetime.now(TZ)
    written = 0
    with path.open("w", encoding="utf-8") as f:
        for i, b in enumerate(bursts):
            if not isinstance(b, dict):
                continue
            msgs = [m.strip() for m in b.get("messages", []) if isinstance(m, str) and m.strip()]
            if not (4 <= len(msgs) <= 20):
                continue
            topic = str(b.get("topic") or "smalltalk").strip().lower() or "smalltalk"
            row = {
                "id": f"{lang}-{worker}-{start_id + written:06d}",
                "topic": topic,
                "messages": msgs,
                "worker": worker,
                "model": MODEL,
                "created_at": (start + timedelta(minutes=written)).isoformat(),
            }
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
            written += 1
    man = DATA / f"chat-cipher-{lang}" / "manifests"
    man.mkdir(parents=True, exist_ok=True)
    meta = {
        "worker": worker,
        "model": MODEL,
        "shard": path.name,
        "burst_count": written,
        "id_start": start_id,
    }
    (man / f"{worker}-{path.stem}.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return path, written


def generate_batch(key: str, lang: str, n: int, seed: int, effort: str) -> list[dict]:
    topics = TOPICS[lang]
    # pick a rotating subset so prompts stay focused
    rng = random.Random(seed)
    pick = rng.sample(topics, k=min(6, len(topics)))
    data = chat(
        key,
        build_prompt(lang, pick, n, seed),
        effort=effort,
        temperature=0.85,
        max_tokens=4096,
    )
    content = data["choices"][0]["message"]["content"]
    if isinstance(content, list):
        # some APIs return content parts
        content = "".join(
            part.get("text", "") if isinstance(part, dict) else str(part) for part in content
        )
    parsed = json.loads(content)
    bursts = parsed.get("bursts") if isinstance(parsed, dict) else None
    if not isinstance(bursts, list):
        raise RuntimeError("bad structured response")
    usage = data.get("usage") or {}
    print(
        f"  api lang={lang} got={len(bursts)} tokens={usage.get('total_tokens')} "
        f"reason={usage.get('completion_tokens_details', {}).get('reasoning_tokens', 0)}",
        flush=True,
    )
    return bursts


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lang", action="append", default=[])
    ap.add_argument("--per-batch", type=int, default=8)
    ap.add_argument("--batches", type=int, default=1, help="API calls per language")
    ap.add_argument("--rounds", type=int, default=1, help="full language cycles")
    ap.add_argument("--worker", default="mercury")
    ap.add_argument("--effort", default="low", choices=["instant", "low", "medium", "high"])
    ap.add_argument("--sleep", type=float, default=0.4)
    ap.add_argument("--start-id", type=int, default=1)
    args = ap.parse_args()
    langs = args.lang or ["sk", "de", "fr", "pl", "es", "en"]
    key = load_key()
    id_cursors = {lang: args.start_id for lang in langs}
    total_written = 0
    for rnd in range(args.rounds):
        for lang in langs:
            collected: list[dict] = []
            for b in range(args.batches):
                seed = (rnd + 1) * 100000 + hash(lang) % 10000 + b * 17 + int(time.time()) % 1000
                try:
                    collected.extend(
                        generate_batch(key, lang, args.per_batch, seed, args.effort)
                    )
                except Exception as e:
                    print(f"  FAIL {lang} batch {b}: {e}", file=sys.stderr, flush=True)
                    time.sleep(2)
                    continue
                time.sleep(args.sleep)
            if not collected:
                continue
            path, n = write_bursts(lang, f"{args.worker}-r{rnd+1}", collected, id_cursors[lang])
            id_cursors[lang] += n
            total_written += n
            print(f"wrote {n} -> {path}", flush=True)
    print(f"DONE total_written={total_written}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
