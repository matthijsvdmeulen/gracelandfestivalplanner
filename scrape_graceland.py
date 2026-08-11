#!/usr/bin/env python3
"""
Graceland Festival -> schema.json

Haalt het volledige programma op: elk onderdeel met beschrijving, categorie,
partner, afbeelding, links, en de speeltijden uit de tabel "Waar en wanneer"
op de detailpagina. Die tabel noemt dag, tijd EN podium, dus het podium hoeft
niet meer uit de volgorde van het blokkenschema afgeleid te worden.

Het blokkenschema wordt nog wel opgehaald, maar alleen als controle: alles wat
daar staat en niet op een detailpagina, wordt gemeld en alsnog toegevoegd.

    pip install requests beautifulsoup4
    python scrape_graceland.py --out schema.json

Detailpagina's worden gecachet in .graceland-cache.json en pas na 24 uur
opnieuw opgehaald, dus een herhaalde run kost een handvol requests.

    --refresh              negeer de cache, haal alles opnieuw op
    --max-age-hours 24     hoe lang een gecachete beschrijving meegaat
    --inspect <slug>       toon wat er van een detailpagina gelezen wordt
    --no-timetable         sla de controle tegen het blokkenschema over

Bij een fout wordt er niets weggeschreven en is de exitcode 1, zodat een
bestaande schema.json blijft staan en de planner terugvalt op zijn cache.
"""

import argparse
import datetime
import json
import os
import re
import sys
import time
from collections import OrderedDict

import requests
from bs4 import BeautifulSoup

SITE = "https://gracelandfestival.nl"
INDEX = SITE + "/programma/"
HEADERS = {"User-Agent": "graceland-planner/2.0 (persoonlijke festivalplanner)"}

DAY_KEYS = {"donderdag": "do", "vrijdag": "vr", "zaterdag": "za", "zondag": "zo"}
DAY_META = OrderedDict([
    ("do", ("Donderdag", "13 aug", "20260813", "donderdag-13-augustus")),
    ("vr", ("Vrijdag",   "14 aug", "20260814", "vrijdag-14-augustus")),
    ("za", ("Zaterdag",  "15 aug", "20260815", "zaterdag-15-augustus")),
    ("zo", ("Zondag",    "16 aug", "20260816", "zondag-16-augustus")),
])

# categorie -> code in de planner; volgorde = voorrang bij meerdere categorieen
CATEGORY_ORDER = [
    ("Kinderen", "K"), ("Tieners", "T"), ("Muziek", "M"), ("Performance", "P"),
    ("Spreker", "S"), ("Workshop", "W"), ("Veld", "V"),
]
CATEGORY_CODE = dict(CATEGORY_ORDER)

# vaste rijvolgorde van de podia; onbekende podia komen erachter
STAGE_ORDER = [
    "Grasland", "Bospodium", "Vindplaats", "Circus",
    "Graceland Bij Je Thuiskamer", "Kinderdorp", "The Lounge", "Aan Tafel",
    "De Werkelijkheid", "Heilige Aard", "Stiltekapel", "Wilde nis", "Veld",
]

TIME_RE = re.compile(r"(\d{1,2}:\d{2})\s*[-\u2013\u2014]\s*(\d{1,2}:\d{2})")
DAY_RE = re.compile(r"^(donderdag|vrijdag|zaterdag|zondag)\b", re.I)
BOILERPLATE = re.compile(
    r"^(share the love|deel deze pagina|copyright|volg ons|bekijk het programma|"
    r"koop hier je tickets|open main menu|direct naar content)", re.I)


# --------------------------------------------------------------------------- #
# http                                                                         #
# --------------------------------------------------------------------------- #
class Fetcher:
    def __init__(self, delay=0.4):
        self.s = requests.Session()
        self.s.headers.update(HEADERS)
        self.delay = delay
        self.count = 0

    def get(self, url):
        if self.count:
            time.sleep(self.delay)
        r = self.s.get(url, timeout=30)
        r.raise_for_status()
        self.count += 1
        return r.text


def soup_of(html):
    return BeautifulSoup(html, "html.parser")


def txt(el):
    return " ".join(el.get_text(" ", strip=True).split())


# --------------------------------------------------------------------------- #
# index: alle slugs                                                            #
# --------------------------------------------------------------------------- #
def parse_index(html):
    soup = soup_of(html)
    slugs = OrderedDict()
    for a in soup.select('a[href*="/programma/"]'):
        m = re.search(r"/programma/([^/?#]+)/?$", a.get("href", ""))
        if not m:
            continue                      # de overzichtspagina zelf
        slug, title = m.group(1), txt(a)
        if slug not in slugs and title:
            slugs[slug] = title
    return slugs


# --------------------------------------------------------------------------- #
# detailpagina                                                                 #
# --------------------------------------------------------------------------- #
def parse_detail(html, slug):
    soup = soup_of(html)
    main = soup.find("main") or soup

    h1 = main.find("h1")
    if h1 is None:
        raise ValueError("geen <h1> gevonden")
    title = txt(h1)

    og = soup.find("meta", property="og:image")
    image = og["content"] if og and og.get("content") else None

    # categorieen en partners: de lijst direct onder de titel
    cats, partners = [], []
    lst = h1.find_next(["ul", "ol"])
    if lst is not None:
        for li in lst.find_all("li"):
            t = txt(li)
            if not t or len(t) > 60:
                continue
            (cats if t in CATEGORY_CODE else partners).append(t)

    # speeltijden uit "Waar en wanneer"
    when, table = [], None
    for tb in main.find_all("table"):
        head = txt(tb).lower()
        if "podium" in head or "tijd" in head:
            table = tb
            break
    if table is not None:
        for tr in table.find_all("tr"):
            cells = [c for c in (txt(td) for td in tr.find_all(["td", "th"])) if c]
            if len(cells) < 3:
                continue
            dm, tm = DAY_RE.match(cells[0]), TIME_RE.search(cells[1])
            if not dm or not tm:
                continue                  # kopregel
            when.append({"day": DAY_KEYS[dm.group(1).lower()],
                         "st": tm.group(1).zfill(5),
                         "en": tm.group(2).zfill(5),
                         "stage": cells[2]})

    # beschrijving: alinea's na de tabel (of na de categorielijst)
    anchor = table if table is not None else (lst if lst is not None else h1)
    body, links = [], []
    for p in anchor.find_all_next("p"):
        if main not in p.parents:
            break
        t = txt(p)
        if not t or BOILERPLATE.match(t):
            continue
        if re.match(r"^https?://\S+$", t):
            links.append(t)
            continue
        body.append(t)
    for a in anchor.find_all_next("a", href=True):
        if main not in a.parents:
            break
        href = a["href"]
        if re.search(r"(youtube|youtu\.be|spotify|bandcamp|vimeo|soundcloud)", href) \
                and href not in links:
            links.append(href)

    return {"slug": slug, "title": title,
            "url": SITE + "/programma/" + slug + "/", "image": image,
            "cats": cats, "partners": partners, "when": when,
            "body": body, "links": links[:4]}


def code_for(cats):
    for name, code in CATEGORY_ORDER:
        if name in cats:
            return code
    return "O"


# --------------------------------------------------------------------------- #
# blokkenschema, alleen als controle                                           #
# --------------------------------------------------------------------------- #
def _label_of(loc):
    for el in loc.find_all(True):
        if el.find(True):
            continue
        t = txt(el)
        if t and not TIME_RE.search(t):
            return t
    return None


def parse_timetable(html):
    """(podium, titel, begin, eind) op basis van de echte CSS-klassen."""
    soup = soup_of(html)
    out = []
    for loc in soup.select(".timetable__location"):
        label = _label_of(loc)
        for perf in loc.select(".timetable__performance"):
            tm_el = perf.select_one(".timetable__performance-times")
            if tm_el is None:
                continue
            stamp = txt(tm_el)
            m = TIME_RE.search(stamp)
            if not m:
                continue
            name = " ".join(txt(perf).replace(stamp, "").split())
            out.append((label, name.strip(" \u00b7-\u2013"),
                        m.group(1).zfill(5), m.group(2).zfill(5)))
    return out


# --------------------------------------------------------------------------- #
# cache                                                                        #
# --------------------------------------------------------------------------- #
def load_cache(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:                                       # noqa: BLE001
        return {}


def save_cache(path, cache):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(cache, fh, ensure_ascii=False)
    os.replace(tmp, path)


# --------------------------------------------------------------------------- #
# opbouw                                                                       #
# --------------------------------------------------------------------------- #
def to_min(hhmm):
    h, m = (int(x) for x in hhmm.split(":"))
    t = h * 60 + m
    return t + 1440 if h < 6 else t


def build_days(programs, timetable_rows, warn):
    extra_stages = []

    def rank(name):
        if name in STAGE_ORDER:
            return STAGE_ORDER.index(name)
        if name not in extra_stages:
            extra_stages.append(name)
        return len(STAGE_ORDER) + extra_stages.index(name)

    per_day = OrderedDict((k, []) for k in DAY_META)
    seen = {}
    for p in programs.values():
        code = code_for(p["cats"])
        for w in p["when"]:
            if w["day"] not in per_day:
                warn.append("onbekende dag bij %s" % p["slug"])
                continue
            seen[(w["day"], p["title"], w["st"])] = w["stage"]
            per_day[w["day"]].append(
                [w["stage"], p["title"], w["st"], w["en"], code, p["slug"]])

    for day, stage, title, st, en in timetable_rows:
        key = (day, title, st)
        if key in seen:
            if stage and seen[key] != stage:
                warn.append("podium verschilt voor %s (%s %s): detailpagina zegt "
                            "%s, blokkenschema %s" % (title, day, st, seen[key], stage))
            continue
        warn.append("wel in het blokkenschema, niet op een detailpagina: "
                    "%s %s %s (%s)" % (day, st, title, stage))
        per_day[day].append([stage, title, st, en, "O", None])

    days = []
    for key, (label, date, iso, _slug) in DAY_META.items():
        items = sorted(per_day[key], key=lambda i: (rank(i[0]), to_min(i[2])))
        days.append({"key": key, "label": label, "date": date, "iso": iso,
                     "items": items})
    return days, extra_stages


# --------------------------------------------------------------------------- #
# hoofdprogramma                                                               #
# --------------------------------------------------------------------------- #
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="schema.json")
    ap.add_argument("--cache", default=".graceland-cache.json")
    ap.add_argument("--max-age-hours", type=float, default=24.0)
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--no-timetable", action="store_true")
    ap.add_argument("--inspect", metavar="SLUG")
    ap.add_argument("--min-programs", type=int, default=80)
    ap.add_argument("--min-items", type=int, default=100)
    ap.add_argument("--delay", type=float, default=0.4)
    args = ap.parse_args()

    f = Fetcher(args.delay)

    if args.inspect:
        d = dict(parse_detail(f.get(SITE + "/programma/" + args.inspect + "/"),
                              args.inspect))
        d["body"] = ["%d alinea's, %d tekens"
                     % (len(d["body"]), sum(len(b) for b in d["body"]))]
        print(json.dumps(d, ensure_ascii=False, indent=2))
        return 0

    warn = []

    # 1. overzichtspagina
    try:
        slugs = parse_index(f.get(INDEX))
    except Exception as exc:                                # noqa: BLE001
        print("FOUT: overzichtspagina niet te lezen: %s" % exc, file=sys.stderr)
        return 1
    if len(slugs) < args.min_programs:
        print("FOUT: maar %d programma's gevonden, verwacht minstens %d"
              % (len(slugs), args.min_programs), file=sys.stderr)
        return 1
    print("%d programma's op de overzichtspagina" % len(slugs))

    # 2. detailpagina's, met cache
    cache = {} if args.refresh else load_cache(args.cache)
    now = time.time()
    programs, fetched, failed = OrderedDict(), 0, []
    for i, slug in enumerate(slugs, 1):
        hit = cache.get(slug)
        if hit and now - hit.get("at", 0) < args.max_age_hours * 3600:
            programs[slug] = hit["data"]
            continue
        try:
            data = parse_detail(f.get(SITE + "/programma/" + slug + "/"), slug)
        except Exception as exc:                            # noqa: BLE001
            if hit:
                programs[slug] = hit["data"]
                warn.append("%s: verversen mislukt (%s), oude versie gebruikt"
                            % (slug, exc))
            else:
                failed.append("%s (%s)" % (slug, exc))
            continue
        programs[slug] = data
        cache[slug] = {"at": now, "data": data}
        fetched += 1
        if fetched and fetched % 25 == 0:
            print("  %d/%d opgehaald..." % (i, len(slugs)))
    save_cache(args.cache, cache)
    print("%d detailpagina's opgehaald, %d uit cache"
          % (fetched, len(programs) - fetched))

    if failed:
        print("FOUT: %d detailpagina's onleesbaar: %s"
              % (len(failed), ", ".join(failed[:5])), file=sys.stderr)
        return 1

    # 3. blokkenschema als controle
    rows = []
    if not args.no_timetable:
        for key, (_l, _d, _i, slug) in DAY_META.items():
            try:
                found = parse_timetable(f.get(SITE + "/tijdschema/" + slug + "/"))
            except Exception as exc:                        # noqa: BLE001
                warn.append("blokkenschema %s niet opgehaald: %s" % (key, exc))
                continue
            if not found:
                warn.append("blokkenschema %s: geen blokken herkend "
                            "(CSS-klassen gewijzigd?)" % key)
            rows.extend((key, s, t, a, b) for s, t, a, b in found)
        print("%d blokken uit het blokkenschema ter controle" % len(rows))

    # 4. samenstellen
    days, extra_stages = build_days(programs, rows, warn)
    total = sum(len(d["items"]) for d in days)
    if total < args.min_items:
        print("FOUT: maar %d blokken samengesteld, verwacht minstens %d "
              "- niets weggeschreven" % (total, args.min_items), file=sys.stderr)
        return 1

    always = [{"slug": p["slug"], "title": p["title"], "cat": code_for(p["cats"])}
              for p in programs.values() if not p["when"]]

    payload = {
        "generated": datetime.datetime.now(datetime.timezone.utc)
                      .astimezone().isoformat(timespec="seconds"),
        "source": INDEX,
        "days": days,
        "always": always,
        "programs": {p["slug"]: {k: v for k, v in p.items() if k != "slug"}
                     for p in programs.values()},
    }
    tmp = args.out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    os.replace(tmp, args.out)

    print("\n%d blokken, %d programma's, %d doorlopend  ->  %s (%.0f kB)"
          % (total, len(programs), len(always), args.out,
             os.path.getsize(args.out) / 1024))
    for d in days:
        print("  %-10s %3d blokken" % (d["label"], len(d["items"])))
    if extra_stages:
        print("  nieuw podium, achteraan gezet: %s" % ", ".join(extra_stages))
    for w in warn[:20]:
        print("  let op:", w)
    if len(warn) > 20:
        print("  ... en nog %d meldingen" % (len(warn) - 20))
    return 0


if __name__ == "__main__":
    sys.exit(main())
