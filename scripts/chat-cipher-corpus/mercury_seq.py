#!/usr/bin/env python3
"""Sequential Mercury-3 high-reasoning generator until 14:00 Prague.

Free tier 429s under parallel load; one request at a time + backoff
maximizes successful high-quality bursts without burning the whole grant.
"""
from __future__ import annotations

import json
import random
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mercury_gen import TOPICS, build_prompt, chat, write_bursts  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
TZ = timezone(timedelta(hours=1))
LANGS = ["sk", "de", "fr", "pl", "es", "en"]


def load_named_key(env_name: str) -> str:
    import os

    key = os.environ.get(env_name, "").strip()
    if key:
        return key
    env_path = ROOT / ".env.local"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith(env_name + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit(f"{env_name} missing")


def main() -> int:
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--key-env", default="INCEPTION_API_KEY")
    ap.add_argument("--tag", default="seq", help="worker/log tag")
    ap.add_argument("--lang-offset", type=int, default=0, help="rotate starting lang")
    ap.add_argument(
        "--until",
        default="14:00",
        help="local Europe/Prague HH:MM stop time (default 14:00)",
    )
    args = ap.parse_args()

    log_path = ROOT / "data" / f"mercury-{args.tag}.log"

    def log(msg: str) -> None:
        print(msg, flush=True)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with log_path.open("a", encoding="utf-8") as f:
            f.write(msg + "\n")

    hh, mm = (int(x) for x in args.until.split(":", 1))
    until = datetime.now(TZ).replace(hour=hh, minute=mm, second=0, microsecond=0)
    if datetime.now(TZ) >= until:
        log(f"stop time already passed ({args.until})")
        return 0
    key = load_named_key(args.key_env)
    i = 0
    stats = {"ok": 0, "fail": 0, "written": 0, "out": 0, "key_env": args.key_env}
    log(
        f"SEQ start {datetime.now(TZ).isoformat()} until {args.until} effort=high "
        f"tag={args.tag} key={args.key_env}"
    )
    while datetime.now(TZ) < until:
        lang = LANGS[(i + args.lang_offset) % len(LANGS)]
        i += 1
        seed = int(time.time()) + i * 17 + args.lang_offset * 1009
        rng = random.Random(seed)
        pick = rng.sample(TOPICS[lang], k=min(6, len(TOPICS[lang])))
        try:
            data = chat(
                key,
                build_prompt(lang, pick, 8, seed),
                effort="high",
                temperature=0.9,
                max_tokens=8192,
            )
            if not isinstance(data, dict):
                raise ValueError(f"api non-dict payload: {type(data).__name__}")
            usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
            msg = (data.get("choices") or [{}])[0]
            if isinstance(msg, dict):
                msg = msg.get("message") or {}
            if not isinstance(msg, dict):
                raise ValueError(f"api message type: {type(msg).__name__}")
            content = msg.get("content")
            if content is None:
                raise ValueError("empty model content")
            if isinstance(content, list):
                content = "".join(
                    x.get("text", "") if isinstance(x, dict) else str(x) for x in content
                )
            parsed = json.loads(content)
            if isinstance(parsed, dict):
                bursts = parsed.get("bursts") or []
            elif isinstance(parsed, list):
                bursts = parsed
            else:
                bursts = []
            path, n = write_bursts(
                lang, f"merc-{args.tag}-{i}", bursts, 1 + i * 20 + args.lang_offset * 100000
            )
            out = int(usage.get("completion_tokens") or 0)
            stats["ok"] += 1
            stats["written"] += n
            stats["out"] += out
            log(
                f"OK {lang} +{n} out={out} total={usage.get('total_tokens')} "
                f"-> {path.name} written={stats['written']}"
            )
            time.sleep(12)
        except Exception as e:
            stats["fail"] += 1
            msg = str(e)
            log(f"FAIL {lang}: {msg[:220]}")
            if "output token" in msg.lower():
                time.sleep(90)
            elif "429" in msg or "rate_limit" in msg:
                time.sleep(45)
            else:
                time.sleep(8)
    log(f"SEQ DONE {stats}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

