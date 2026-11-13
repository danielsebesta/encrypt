#!/usr/bin/env python3
"""Bulk local one-writer chat bursts for chat-cipher corpora (oversize overnight)."""
from __future__ import annotations

import argparse
import json
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "data"
TZ = timezone(timedelta(hours=1))

BANKS: dict[str, dict[str, list[list[str]]]] = {
    "sk": {
        "errands": [
            ["cau", "idem do obchodu", "treba nieco", "beriem mlieko a chlieb", "ok napis"],
            ["hej", "stojim v lekarni", "fronta je dlha", "este cakam", "uz idem"],
            ["cus", "vratim bundu", "reklamacia", "daju peniaze spat", "super"],
            ["hej", "idem na postu", "balik prisiel", "ok beriem", "cau"],
            ["cau", "zastavim sa v zabke", "chces nieco", "colu a rožok", "jasne"],
            ["hej", "idem po lieky", "lekaren ma otvorene do 8", "ok", "dik"],
        ],
        "food": [
            ["hej", "co na veceru", "dam si pizzu", "alebo cestoviny", "pizzu"],
            ["cau", "objednam kebabu", "chces aj ty", "jasne", "ok"],
            ["hej", "varim kapustnicu", "prideš", "urcite", "beriem chlieb"],
            ["cau", "halusky?", "ano pls", "s bryndzou", "uz varim"],
            ["hej", "ranajky", "rozok a kava", "alebo vajicka", "rozok"],
        ],
        "work": [
            ["hej", "som v calli", "napis neskor", "ok", "cau"],
            ["cau", "notebook zasadol", "restartujem", "uz ide", "fuh"],
            ["hej", "standup o 10", "nestihnem", "ok posuniem", "dik"],
            ["cau", "deadline dnes", "este to dorabam", "drzim palce", "uz skoro"],
        ],
        "smalltalk": [
            ["cau", "ako sa mas", "ok a ty", "ide to", "super"],
            ["hej", "dlho sme sa nevideli", "naozaj", "dame kavu", "napis kedy"],
            ["cus", "co nove", "nic moc", "u teba", "to iste"],
            ["hej", "sak pohoda", "joj dneska zima", "ano", "cau"],
        ],
        "family": [
            ["hej", "deti uz spia", "konecne", "pozeram serial", "cau"],
            ["cau", "mama volala", "pridu v nedelu", "ok nakupim", "dik"],
            ["hej", "svokra pride", "pripravim obed", "halusky", "super"],
            ["cau", "macka zase niekde je", "hladam ju", "nasiel", "fuh"],
        ],
        "weekend": [
            ["hej", "co robis zajtra", "nic", "dame vychodzku", "ak nebude prsat"],
            ["cau", "tatry?", "daleko", "aspon predmestie", "ok"],
            ["hej", "futbal vecer", "slovan?", "jasne", "beriem pivo"],
        ],
        "commute": [
            ["hej", "elektricka meška", "uz 10 minut", "sak klasika", "uz ide"],
            ["cau", "zamrzla cesta", "pojdem opatrne", "daj vediet", "ok"],
        ],
    },
    "pl": {
        "errands": [
            ["hej", "idę do sklepu", "trzeba coś", "biorę mleko i chleb", "ok napisz"],
            ["siema", "stoję w aptece", "kolejka mega", "jeszcze czekam", "już idę"],
            ["hej", "paczkomat pełny", "biorę z innego", "ok", "dzięki"],
            ["elo", "na poczcie", "kolejka", "jeszcze chwilę", "już"],
            ["hej", "oddaję kurtkę", "paragon mam", "git", "zwrot idzie"],
        ],
        "food": [
            ["hej", "co na kolację", "zamawiam pizzę", "albo makaron", "pizza"],
            ["elo", "kebab leci", "chcesz też", "jasne", "ok"],
            ["siema", "pierogi czy żurek", "pierogi", "z mięsem", "lecę"],
            ["hej", "obiad u mamy", "wpadniesz", "jasne", "berę wino"],
        ],
        "work": [
            ["hej", "jestem na callu", "napisz później", "ok", "pa"],
            ["siema", "laptop padł", "restartuję", "działa", "uff"],
            ["hej", "deadline dziś", "dobijam", "trzymam kciuki", "prawie"],
            ["elo", "vpn pada", "hotspot", "działa", "ledwo"],
        ],
        "smalltalk": [
            ["cześć", "co u ciebie", "git a u ciebie", "leci", "super"],
            ["hej", "dawno się nie widzieliśmy", "serio", "kawa", "napisz kiedy"],
            ["siema", "jak nowa praca", "spoko", "fajnie", "trzaskamy"],
        ],
        "family": [
            ["hej", "dzieci śpią", "wreszcie", "serial", "pa"],
            ["siema", "mama dzwoniła", "w niedzielę wpadną", "ok kupię", "dzięki"],
            ["hej", "pies znowu coś zjadł", "skarpeta", "klasyka", "pilnuję"],
        ],
        "weekend": [
            ["hej", "co jutro", "nic", "spacer", "jak nie będzie padać"],
            ["elo", "mecz wieczorem", "u ciebie", "jasne", "piwo biorę"],
        ],
    },
    "de": {
        "errands": [
            ["hey", "ich geh kurz zum rewe", "brauchst du was", "milch und brot", "ok"],
            ["moin", "steh in der apotheke", "schlange ist lang", "warte noch", "bin gleich fertig"],
            ["hey", "packstation voll", "andere hole ich", "ok", "danke"],
            ["na", "zur post", "warteschlange", "noch kurz", "fertig"],
            ["hey", "jacke zurückgeben", "bon hab ich", "gut", "geld kommt"],
        ],
        "food": [
            ["hey", "was essen wir", "ich bestell pizza", "oder pasta", "pizza"],
            ["na", "kebab?", "ja klar", "mit scharf", "ok"],
            ["hey", "reste oder liefern", "liefern", "thai?", "ja bitte"],
            ["moin", "backe kekse", "willst welche", "klar", "heb dir welche auf"],
        ],
        "work": [
            ["hey", "bin noch im call", "schreib später", "ok", "bis dann"],
            ["moin", "laptop ist tot", "neustart", "geht wieder", "uff"],
            ["hey", "deadline heute", "schick noch", "druecke daumen", "fast fertig"],
            ["na", "vpn spinnt", "handy hotspot", "geht", "knapp"],
        ],
        "smalltalk": [
            ["hey", "wie gehts", "ganz ok und dir", "passt", "cool"],
            ["na", "lange nicht gesehen", "stimmt", "kaffee bald", "sag wann"],
            ["hey", "wie die neue whg", "laut nachbarn", "uff", "ohropax zeit"],
        ],
        "family": [
            ["hey", "kids schlafen", "endlich", "serie", "bis morgen"],
            ["hey", "mama hat angerufen", "sonntag kommen sie", "ok ich kauf ein", "danke"],
            ["na", "hund hat socke gefressen", "tierarzt sagt beobachten", "drama", "immer"],
        ],
        "weekend": [
            ["hey", "was machst du morgen", "nix", "spazieren", "wenn kein regen"],
            ["na", "brunch?", "spaet", "so 11", "book ich"],
            ["hey", "fussball abend", "bei dir", "klar", "bier bring ich"],
        ],
    },
    "es": {
        "errands": [
            ["hola", "voy al súper", "necesitas algo", "leche y pan", "ok"],
            ["ey", "estoy en la farmacia", "hay cola", "sigo esperando", "ya salgo"],
            ["hola", "el locker está lleno", "voy a otro", "vale", "gracias"],
            ["ey", "en correos", "cola eterna", "un poco más", "listo"],
            ["hola", "devuelvo la chaqueta", "tengo el ticket", "bien", "reembolso va"],
        ],
        "food": [
            ["hola", "qué cenamos", "pido pizza", "o pasta", "pizza"],
            ["ey", "kebab", "sí", "con picante", "vale"],
            ["hola", "sobras o pedir", "pedir", "thai?", "sí porfa"],
            ["ey", "hago galletas", "quieres", "obvio", "te guardo"],
        ],
        "work": [
            ["hola", "estoy en una call", "te escribo luego", "ok", "chau"],
            ["ey", "se me murió el portátil", "reinicio", "ya va", "uf"],
            ["hola", "deadline hoy", "casi", "suerte", "ya casi"],
            ["ey", "vpn caído", "hotspot", "va", "justo"],
        ],
        "smalltalk": [
            ["hola", "qué tal", "bien y tú", "tirando", "genial"],
            ["ey", "hace mucho", "sí", "un café", "dime cuándo"],
            ["hola", "cómo el piso nuevo", "vecinos ruidosos", "uff", "tapones"],
        ],
        "family": [
            ["hola", "los niños ya duermen", "por fin", "miro una serie", "nos vemos"],
            ["ey", "llamó mamá", "vienen el domingo", "ok compro", "gracias"],
            ["hola", "el perro se comió un calcetín", "el vet dice mirar", "drama", "siempre"],
        ],
        "weekend": [
            ["hola", "qué haces mañana", "nada", "paseo", "si no llueve"],
            ["ey", "brunch?", "tarde", "tipo 11", "lo pillo"],
            ["hola", "partido esta noche", "en tu casa", "claro", "yo llevo cerveza"],
        ],
    },
    "fr": {
        "errands": [
            ["salut", "je passe au super", "tu veux un truc", "lait et pain", "ok"],
            ["hey", "je suis a la pharmacie", "y a la queue", "j attends", "j y vais"],
            ["salut", "casiers pleins", "j en prends un autre", "ok", "merci"],
            ["dis", "a la poste", "file monstrueuse", "encore un peu", "bon"],
            ["salut", "je rends la veste", "ticket ok", "cool", "remboursement part"],
        ],
        "food": [
            ["salut", "on mange quoi", "je commande une pizza", "ou des pates", "pizza"],
            ["dis", "kebab", "ouais", "bien epice", "ok"],
            ["salut", "restes ou livrer", "livrer", "thai?", "oui stp"],
            ["hey", "je fais des cookies", "tu en veux", "evidemment", "je t en garde"],
        ],
        "work": [
            ["salut", "je suis en call", "je te reecris apres", "ok", "a plus"],
            ["hey", "le pc a plante", "je restart", "ca marche", "ouf"],
            ["salut", "deadline aujourdhui", "j y suis", "bon courage", "presque"],
            ["dis", "vpn down", "partage 4g", "ca passe", "tout juste"],
        ],
        "smalltalk": [
            ["salut", "ca va", "tranquille et toi", "ca roule", "cool"],
            ["hey", "ca fait longtemps", "ouais", "un cafe", "dis moi quand"],
            ["salut", "le nouvel appart", "voisins bruyants", "ouf", "bouchons"],
        ],
        "family": [
            ["salut", "les kids dorment", "enfin", "je mate une serie", "a demain"],
            ["dis", "maman a appele", "ils viennent dimanche", "ok je fais les courses", "merci"],
            ["salut", "le chien a mange une chaussette", "le veto dit surveiller", "drama", "toujours"],
        ],
        "weekend": [
            ["salut", "tu fais quoi demain", "rien", "balade", "s il pleut pas"],
            ["dis", "brunch?", "tard", "vers 11", "je reserve"],
            ["salut", "match ce soir", "chez toi", "ouais", "j apporte les bieres"],
        ],
    },
    "en": {
        "errands": [
            ["hey", "running to the store", "need anything", "milk and bread", "ok"],
            ["yo", "stuck at the pharmacy", "line is wild", "still waiting", "heading out"],
            ["hey", "post office closes at 5", "need stamps", "grabbing them now", "cool"],
            ["yo", "returning that jacket", "receipt somewhere", "found it", "refund incoming"],
            ["hey", "dry cleaning ready", "picking it up", "ok", "cya"],
        ],
        "food": [
            ["hey", "what for dinner", "im ordering pizza", "or pasta", "pizza"],
            ["yo", "kebab", "yeah", "extra spicy", "bet"],
            ["hey", "leftovers or takeout", "takeout wins", "thai?", "yes please"],
            ["yo", "baking cookies", "want some", "obviously", "saving you a plate"],
            ["hey", "coffee run", "oat latte?", "same", "omw"],
        ],
        "work": [
            ["hey", "still on a call", "text you later", "ok", "bye"],
            ["yo", "laptop died", "rebooting", "its back", "ugh"],
            ["hey", "standup drifted", "again", "classic", "send notes later"],
            ["yo", "vpn is cooked", "trying phone hotspot", "works", "barely"],
        ],
        "smalltalk": [
            ["hey", "how you doing", "alright you", "same", "cool"],
            ["yo", "been ages", "right", "coffee soon", "lmk when"],
            ["hey", "random but miss hanging", "same tbh", "this weekend?", "maybe sunday"],
            ["yo", "hows the new place", "loud neighbors", "yikes", "earplugs time"],
        ],
        "family": [
            ["hey", "kids finally asleep", "finally", "watching a show", "gn"],
            ["hey", "mom called", "theyre coming sunday", "ok ill shop", "thanks"],
            ["yo", "dog ate a sock", "vet said watch him", "drama", "always"],
            ["hey", "school pickup chaos", "traffic was wild", "made it", "barely"],
        ],
        "weekend": [
            ["hey", "plans tomorrow", "none", "walk maybe", "if it doesnt rain"],
            ["yo", "brunch?", "late one", "11ish", "book it"],
            ["hey", "hike or couch", "couch honestly", "fair", "movie night"],
        ],
        "venting": [
            ["hey", "day was rough", "same here", "want to rant", "go for it"],
            ["yo", "boss moved the deadline", "again", "unreal", "coffee tomorrow"],
        ],
    },
}

FILLERS = {
    "sk": ["hm", "no", "naozaj", "ok", "jasne", "sekundu", "este", "neviem", "sak", "joj", "vazne"],
    "pl": ["hm", "no", "serio", "ok", "jasne", "sekunda", "jeszcze", "nie wiem", "mega", "xd"],
    "de": ["hm", "na", "echt", "ok", "klar", "kurz", "noch", "keine ahnung"],
    "es": ["hm", "pues", "en serio", "ok", "vale", "un segundo", "aún", "no sé"],
    "fr": ["hm", "bon", "grave", "ok", "ouais", "deux sec", "encore", "je sais pas"],
    "en": ["hm", "yeah", "for real", "ok", "bet", "one sec", "still", "idk"],
}


def vary(base: list[str], lang: str, rng: random.Random, pool: list[list[str]]) -> list[str]:
    # remix lines from 2–3 skeletons in the same topic
    alts = rng.sample(pool, k=min(3, len(pool)))
    max_len = max(len(s) for s in alts)
    out: list[str] = []
    for i in range(max_len):
        cands = [s[i] for s in alts if i < len(s)]
        if not cands:
            continue
        out.append(rng.choice(cands))
    fillers = FILLERS[lang]
    if rng.random() < 0.55:
        out.insert(rng.randint(1, max(1, len(out) - 1)), rng.choice(fillers))
    if rng.random() < 0.4:
        out.append(rng.choice(fillers))
    # splice a random mid line from another skeleton
    if len(pool) > 1 and rng.random() < 0.5:
        extra = rng.choice(rng.choice(pool))
        out.insert(rng.randint(1, max(1, len(out) - 1)), extra)
    if rng.random() < 0.25 and len(out) > 5:
        del out[rng.randrange(1, len(out) - 1)]
    if rng.random() < 0.35 and len(out) > 3:
        mid = out[1:-1]
        rng.shuffle(mid)
        out = [out[0], *mid, out[-1]]
    # light typo noise (skip SK — doubled letters looked like corruption)
    if lang != "sk" and rng.random() < 0.12:
        i = rng.randrange(len(out))
        w = out[i].split()
        if w and w[-1]:
            w[-1] = w[-1] + w[-1][-1]
            out[i] = " ".join(w)
    if rng.random() < 0.1:
        out = [m.replace("'", "") for m in out]
    while len(out) < 4:
        out.append(rng.choice(fillers))
    # ensure uniqueness within burst
    dedup = []
    seen = set()
    for m in out:
        key = m.strip().lower()
        if key in seen:
            continue
        seen.add(key)
        dedup.append(m)
    return dedup[:20]


def generate(lang: str, worker: str, n: int, seed: int) -> Path:
    bank = BANKS[lang]
    topics = list(bank)
    rng = random.Random(seed)
    base = ROOT / f"chat-cipher-{lang}"
    shard = base / "shards" / f"{lang}-{worker}-batch-001.jsonl"
    # avoid overwrite: bump batch number
    k = 1
    while shard.exists():
        k += 1
        shard = base / "shards" / f"{lang}-{worker}-batch-{k:03d}.jsonl"
    man = base / "manifests" / f"{worker}.json"
    base.joinpath("shards").mkdir(parents=True, exist_ok=True)
    base.joinpath("manifests").mkdir(parents=True, exist_ok=True)
    start = datetime(2026, 11, 5, 23, 50, tzinfo=TZ)
    counts = {t: 0 for t in topics}
    prefix = f"{lang}-{worker}"
    with shard.open("w", encoding="utf-8") as f:
        for i in range(1, n + 1):
            topic = topics[(i - 1) % len(topics)]
            counts[topic] += 1
            pool = bank[topic]
            msgs = vary(rng.choice(pool), lang, rng, pool)
            row = {
                "id": f"{prefix}-{i:06d}",
                "topic": topic,
                "messages": msgs,
                "worker": worker,
                "model": "local-bulk-phrasebank",
                "created_at": (start + timedelta(minutes=i)).isoformat(),
            }
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    meta = {
        "worker": worker,
        "model": "local-bulk-phrasebank",
        "burst_count": n,
        "shard": shard.name,
        "topics": counts,
        "note": "overnight oversize local bulk",
    }
    # merge if manifest exists
    if man.exists():
        try:
            prev = json.loads(man.read_text(encoding="utf-8"))
            if isinstance(prev, dict):
                batches = prev.get("batches") or []
                if not isinstance(batches, list):
                    batches = []
                batches.append(meta)
                prev["batches"] = batches
                prev["burst_count_total"] = int(prev.get("burst_count_total") or 0) + n
                man.write_text(json.dumps(prev, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            else:
                man.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        except json.JSONDecodeError:
            man.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    else:
        man.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return shard


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lang", required=True, choices=sorted(BANKS))
    ap.add_argument("--worker", required=True)
    ap.add_argument("--n", type=int, default=300)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()
    seed = args.seed or (hash(args.lang + args.worker) & 0xFFFFFFFF)
    path = generate(args.lang, args.worker, args.n, seed)
    print(f"wrote {args.n} -> {path}")


if __name__ == "__main__":
    main()
