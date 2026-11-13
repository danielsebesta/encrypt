#!/usr/bin/env python3
"""Max-throughput Mercury-3 high-reasoning corpus blast until stop time.

Respects Free-tier caps (soft):
  - 1000 req/min
  - 3M input tokens/min
  - 100k output tokens/min  ← binding constraint with reasoning=high

Does NOT try to burn the whole free token grant — runs until --until local time.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Reuse generators from sibling module
sys.path.insert(0, str(Path(__file__).resolve().parent))
from mercury_gen import (  # noqa: E402
    TOPICS,
    load_key,
    write_bursts,
)

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
TZ = timezone(timedelta(hours=1))  # Europe/Prague winter (+01); fine for stop clock
LANGS = ["sk", "de", "fr", "pl", "es", "en"]

# Soft rate limits (leave headroom). Free tier 429'd hard at 14-way burst
# despite advertised 1000 RPM — treat effective RPM as much lower.
# Tuned up for max burn across 3 keys (one process per key).
OUT_TPM = 90_000
REQ_PM = 12
IN_TPM = 2_500_000
STAGGER_S = 0.5


class RateGate:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.out_window: list[tuple[float, int]] = []
        self.in_window: list[tuple[float, int]] = []
        self.req_window: list[float] = []

    def _prune(self, now: float) -> None:
        cut = now - 60.0
        self.out_window = [(t, n) for t, n in self.out_window if t >= cut]
        self.in_window = [(t, n) for t, n in self.in_window if t >= cut]
        self.req_window = [t for t in self.req_window if t >= cut]

    def wait_slot(self, est_out: int, est_in: int) -> None:
        while True:
            with self.lock:
                now = time.time()
                self._prune(now)
                out_used = sum(n for _, n in self.out_window)
                in_used = sum(n for _, n in self.in_window)
                req_used = len(self.req_window)
                if (
                    out_used + est_out <= OUT_TPM
                    and in_used + est_in <= IN_TPM
                    and req_used + 1 <= REQ_PM
                ):
                    self.req_window.append(now)
                    return
                # sleep until oldest entry expires
                times = [t for t, _ in self.out_window] + [t for t, _ in self.in_window] + self.req_window
                wake = (min(times) + 60.1) if times else now + 0.5
                delay = max(0.2, wake - now)
            time.sleep(min(delay, 2.0))

    def record(self, out_tok: int, in_tok: int) -> None:
        with self.lock:
            now = time.time()
            self.out_window.append((now, out_tok))
            self.in_window.append((now, in_tok))


def until_reached(until: datetime) -> bool:
    return datetime.now(TZ) >= until


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
    if env_name == "INCEPTION_API_KEY":
        return load_key()
    raise SystemExit(f"{env_name} missing")


def one_job(
    key: str,
    lang: str,
    worker: str,
    batch_n: int,
    start_id: int,
    gate: RateGate,
    stats: dict,
    stats_lock: threading.Lock,
) -> tuple[str, int]:
    # high reasoning → expect fat output; reserve conservatively
    time.sleep(STAGGER_S * (hash(worker) % 8))
    gate.wait_slot(est_out=3500, est_in=600)
    seed = int(time.time() * 1000) % 10_000_000 + start_id
    try:
        from mercury_gen import chat, build_prompt
        import random

        topics = TOPICS[lang]
        rng = random.Random(seed)
        pick = rng.sample(topics, k=min(6, len(topics)))
        prompt = build_prompt(lang, pick, batch_n, seed)
        data = chat(key, prompt, effort="high", temperature=0.9, max_tokens=8192)
        usage = data.get("usage") or {}
        out_tok = int(usage.get("completion_tokens") or 0)
        in_tok = int(usage.get("prompt_tokens") or 0)
        if out_tok == 0:
            out_tok = int((usage.get("total_tokens") or 3000) * 0.8)
        if in_tok == 0:
            in_tok = 400
        gate.record(out_tok, in_tok)
        content = data["choices"][0]["message"]["content"]
        if isinstance(content, list):
            content = "".join(
                part.get("text", "") if isinstance(part, dict) else str(part) for part in content
            )
        parsed = json.loads(content)
        bursts = parsed.get("bursts") if isinstance(parsed, dict) else None
        if not isinstance(bursts, list) or not bursts:
            return lang, 0
        path, n = write_bursts(lang, worker, bursts, start_id)
        with stats_lock:
            stats["written"] += n
            stats["calls"] += 1
            stats["out_tokens"] += out_tok
            stats["in_tokens"] += in_tok
            stats["by_lang"][lang] = stats["by_lang"].get(lang, 0) + n
        print(
            f"OK {lang} +{n} out={out_tok} in={in_tok} -> {path.name} "
            f"(total_written={stats['written']})",
            flush=True,
        )
        return lang, n
    except Exception as e:
        with stats_lock:
            stats["errors"] += 1
        msg = str(e)
        print(f"FAIL {lang}: {msg[:240]}", file=sys.stderr, flush=True)
        time.sleep(8.0 if "429" in msg or "rate_limit" in msg else 2.0)
        return lang, 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--until", default="14:00", help="Europe/Prague HH:MM stop")
    ap.add_argument("--workers", type=int, default=8, help="parallel API callers")
    ap.add_argument("--per-batch", type=int, default=8)
    ap.add_argument("--filter-every", type=int, default=80, help="validate_filter every N successes")
    ap.add_argument("--key-env", default="INCEPTION_API_KEY")
    ap.add_argument("--tag", default="blast", help="log/stats tag")
    args = ap.parse_args()
    hh, mm = map(int, args.until.split(":"))
    now = datetime.now(TZ)
    until = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
    if until <= now:
        until += timedelta(days=1)

    key = load_named_key(args.key_env)
    gate = RateGate()
    stats_lock = threading.Lock()
    stats = {"written": 0, "calls": 0, "errors": 0, "out_tokens": 0, "in_tokens": 0, "by_lang": {}}
    id_lock = threading.Lock()
    id_cursors = {lang: int(time.time()) % 100000 for lang in LANGS}
    success_since_filter = 0
    log_path = DATA / f"mercury-{args.tag}.log"

    def log(msg: str) -> None:
        print(msg, flush=True)
        with log_path.open("a", encoding="utf-8") as f:
            f.write(msg + "\n")

    log(
        f"BLAST start Prague={now.strftime('%H:%M')} until={until.isoformat()} "
        f"workers={args.workers} effort=high per_batch={args.per_batch} "
        f"tag={args.tag} key={args.key_env}"
    )

    round_i = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        while not until_reached(until):
            round_i += 1
            futures = []
            for i, lang in enumerate(LANGS):
                if until_reached(until):
                    break
                with id_lock:
                    start_id = id_cursors[lang]
                    id_cursors[lang] += 200  # reserve
                worker = f"merc-{args.tag}-r{round_i}-{i}"
                futures.append(
                    pool.submit(
                        one_job,
                        key,
                        lang,
                        worker,
                        args.per_batch,
                        start_id,
                        gate,
                        stats,
                        stats_lock,
                    )
                )
            for fut in as_completed(futures):
                lang, n = fut.result()
                if n > 0:
                    success_since_filter += 1
                if success_since_filter >= args.filter_every:
                    success_since_filter = 0
                    log("refilter…")
                    subprocess.call(
                        [sys.executable, str(Path(__file__).with_name("validate_filter.py"))],
                        cwd=str(ROOT),
                    )
            with stats_lock:
                log(
                    f"STATUS written={stats['written']} calls={stats['calls']} "
                    f"errors={stats['errors']} out_tok={stats['out_tokens']} "
                    f"by_lang={stats['by_lang']}"
                )

    subprocess.call(
        [sys.executable, str(Path(__file__).with_name("validate_filter.py"))],
        cwd=str(ROOT),
    )
    (DATA / f"chat-cipher-MERCURY_{args.tag}.json").write_text(
        json.dumps(stats, indent=2) + "\n", encoding="utf-8"
    )
    log(f"BLAST DONE {stats}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
