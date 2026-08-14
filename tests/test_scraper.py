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

check("video: id en titel uit de embed", d["videos"],
      [{"id": "abc123XYZ_-", "title": "Testartiest - Officiele video"},
       {"id": "tweede12345", "title": "Nog een video"}])
check("video: niet meer dan twee", len(d["videos"]), 2)
check("video: alleen YouTube, geen Spotify-embed",
      any("spotify" in v["id"].lower() for v in d["videos"]), False)

# --- detailpagina zonder tabel --------------------------------------------- #
c = S.parse_detail(read("detail_doorlopend.html"), "doorlopend-veldding")
check("doorlopend: geen speeltijden", c["when"], [])
check("doorlopend: geen video's", c["videos"], [])
check("doorlopend: wel een beschrijving", len(c["body"]), 1)
check("doorlopend: categoriecode", S.code_for(c["cats"]), "V")

# --- blokkenschema --------------------------------------------------------- #
rows = S.parse_timetable(read("tijdschema.html"))
check("blokkenschema: podium, titel en tijden", rows, [
    ("Grasland", "Testartiest", "17:00", "18:00"),
    ("Grasland", "Alleen In Het Blokkenschema", "21:00", "22:00"),
    ("Wilde nis", "Nachtset", "22:00", "00:00"),
])

# De podiumnaam staat in een aparte kolom, niet in de lane zelf. Wie hem in de
# lane zoekt pakt de eerste programmatitel en verzint zo een podium - dat gaf
# ooit een "Gracetalent"-podium met David Benjamin Blower eronder.
check("blokkenschema: titel wordt nooit een podium",
      [s for s, _t, _a, _b in rows if s in {t for _s, t, _a, _b in rows}], [])

# Loopt het aantal podia niet gelijk met het aantal lanes, dan is de structuur
# gewijzigd: liever niets terugmelden dan blokken onder een verzonnen podium.
check("blokkenschema: scheve structuur levert niets",
      S.parse_timetable(
          '<div class="timetable__grid--column-locations">'
          '<div class="timetable__location"><div class="timetable__stage">A</div></div>'
          '</div><div class="timetable__grid--column-timeline">'
          '<div class="timetable__location"><div class="timetable__performance">'
          '<span>X</span><div class="timetable__performance-times">17:00 - 18:00</div>'
          '</div></div><div class="timetable__location"></div></div>'), [])

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

# --- blokkenschema leidend bij een verschoven tijd ------------------------- #
# Zelfde dag, zelfde podium, zelfde titel, andere tijd: geen tweede optreden
# maar een verschoven tijd. Zonder dit stond Luchtkasteel donderdag twee keer
# op Bospodium, om 21:00 (detailpagina) en om 22:00 (blokkenschema).
shifted = {"luchtkasteel": {
    "slug": "luchtkasteel", "title": "Luchtkasteel", "cats": ["Muziek"],
    "when": [{"day": "do", "st": "21:00", "en": "22:00", "stage": "Bospodium"}]}}
warn2 = []
by2 = {x["key"]: x["items"] for x in S.build_days(
    shifted, [("do", "Bospodium", "Luchtkasteel", "22:00", "23:00")], warn2)[0]}
check("verschoven tijd: blijft één blok", len(by2["do"]), 1)
check("verschoven tijd: blokkenschema wint, soort en slug blijven",
      by2["do"], [["Bospodium", "Luchtkasteel", "22:00", "23:00", "M", "luchtkasteel"]])
check("verschoven tijd: wordt gemeld", len(warn2), 1)

# Een echt tweede optreden op een andere tijd moet er juist wel bij komen.
warn3 = []
by3 = {x["key"]: x["items"] for x in S.build_days(
    shifted, [("do", "Bospodium", "Luchtkasteel", "21:00", "22:00"),
              ("do", "Bospodium", "Luchtkasteel", "23:00", "23:30")], warn3)[0]}
check("tweede optreden: komt er wel bij",
      sorted(i[2] for i in by3["do"]), ["21:00", "23:00"])

# Een blok dat alleen in het blokkenschema staat maar wel een bekend programma
# is, houdt zijn soort en link in plaats van als "overig" te eindigen.
warn4 = []
by4 = {x["key"]: x["items"] for x in S.build_days(
    shifted, [("do", "Bospodium", "Luchtkasteel", "21:00", "22:00"),
              ("vr", "Bospodium", "Luchtkasteel", "15:00", "16:00")], warn4)[0]}
check("bekende titel: erft soort en slug",
      by4["vr"], [["Bospodium", "Luchtkasteel", "15:00", "16:00", "M", "luchtkasteel"]])

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
