#!/usr/bin/env python3
"""
Offline tests voor scrape_graceland.py. Geen netwerk nodig: alles draait op de
opgeslagen HTML in tests/fixtures/.

    python tests/test_scraper.py

Pas de fixtures aan zodra de site verandert; ze zijn een vereenvoudigde maar
structureel getrouwe kopie van de echte pagina's.
"""

import importlib.util
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIX = ROOT / "tests" / "fixtures"

spec = importlib.util.spec_from_file_location("scraper", ROOT / "scrape_graceland.py")
S = importlib.util.module_from_spec(spec)
spec.loader.exec_module(S)

passed, failed = 0, []


def check(name, got, want):
    global passed
    if got == want:
        passed += 1
    else:
        failed.append("%s\n    verwacht: %r\n    gekregen: %r" % (name, want, got))


def read(n):
    return (FIX / n).read_text(encoding="utf-8")


# --- overzichtspagina ------------------------------------------------------ #
slugs = S.parse_index(read("index.html"))
check("index: slugs, ontdubbeld en in volgorde",
      list(slugs), ["testartiest", "doorlopend-veldding"])

# --- detailpagina met speeltijden ------------------------------------------ #
d = S.parse_detail(read("detail_muziek.html"), "testartiest")
check("detail: titel", d["title"], "Testartiest")
check("detail: categorie", d["cats"], ["Muziek"])
check("detail: partner is geen categorie", d["partners"], ["LCC+"])
check("detail: speeltijden met podium", d["when"], [
    {"day": "za", "st": "17:00", "en": "18:00", "stage": "Grasland"},
    {"day": "vr", "st": "09:30", "en": "09:45", "stage": "Stiltekapel"},
])
check("detail: alinea's zonder boilerplate", d["body"],
      ["Eerste alinea.", "Tweede alinea met wat meer tekst."])
check("detail: losse url wordt een link",
      d["links"], ["https://open.spotify.com/embed/artist/123"])
check("detail: afbeelding", d["image"], "https://gracelandfestival.nl/img/x.jpg")

# --- detailpagina zonder tabel --------------------------------------------- #
c = S.parse_detail(read("detail_doorlopend.html"), "doorlopend-veldding")
check("doorlopend: geen speeltijden", c["when"], [])
check("doorlopend: wel een beschrijving", len(c["body"]), 1)
check("doorlopend: categoriecode", S.code_for(c["cats"]), "V")

# --- blokkenschema --------------------------------------------------------- #
rows = S.parse_timetable(read("tijdschema.html"))
check("blokkenschema: podium, titel en tijden", rows, [
    ("Grasland", "Testartiest", "17:00", "18:00"),
    ("Grasland", "Alleen In Het Blokkenschema", "21:00", "22:00"),
    ("Wilde nis", "Nachtset", "22:00", "00:00"),
])

# --- samenstellen ---------------------------------------------------------- #
warn = []
days, extra = S.build_days(
    {"testartiest": d, "doorlopend-veldding": c},
    [("za", s, t, a, b) for s, t, a, b in rows], warn)
by_key = {x["key"]: x["items"] for x in days}

check("bouw: doorlopend komt niet in de dagen",
      any(i[1] == "Doorlopend Veldding" for it in by_key.values() for i in it), False)
check("bouw: podium komt van de detailpagina",
      by_key["vr"], [["Stiltekapel", "Testartiest", "09:30", "09:45", "M", "testartiest"]])
check("bouw: alleen-in-blokkenschema krijgt code O",
      [i for i in by_key["za"] if i[1] == "Alleen In Het Blokkenschema"],
      [["Grasland", "Alleen In Het Blokkenschema", "21:00", "22:00", "O", None]])
check("bouw: dubbeling wordt niet twee keer opgenomen",
      len([i for i in by_key["za"] if i[1] == "Testartiest"]), 1)
check("bouw: rijen in podiumvolgorde, dan op tijd",
      [(i[0], i[2]) for i in by_key["za"]],
      [("Grasland", "17:00"), ("Grasland", "21:00"), ("Wilde nis", "22:00")])
# Twee blokken in de fixture staan alleen in het blokkenschema, dus twee meldingen.
check("bouw: melding per ontbrekend programma", len(warn), 2)
check("bouw: melding noemt het programma",
      sorted(w.split("kenschema, niet op een detailpagina: ")[1] for w in warn),
      ["za 21:00 Alleen In Het Blokkenschema (Grasland)",
       "za 22:00 Nachtset (Wilde nis)"])
check("bouw: geen onbekende podia", extra, [])

# --- tijdrekenen ----------------------------------------------------------- #
check("tijd: middernacht hoort bij de dag ervoor", S.to_min("00:15") > S.to_min("23:00"), True)
check("tijd: 02:00 telt door", S.to_min("02:00"), 26 * 60)
check("tijd: 09:00 blijft staan", S.to_min("09:00"), 9 * 60)

# --- categorievoorrang ------------------------------------------------------ #
check("categorie: kinderen gaat voor performance",
      S.code_for(["Performance", "Kinderen"]), "K")
check("categorie: onbekend wordt O", S.code_for(["Iets Nieuws"]), "O")

# --------------------------------------------------------------------------- #
print("%d geslaagd, %d gefaald" % (passed, len(failed)))
for f in failed:
    print("\nGEFAALD: " + f)
sys.exit(1 if failed else 0)
