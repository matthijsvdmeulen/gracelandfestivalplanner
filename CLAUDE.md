# Graceland Festival planner — context voor Claude Code

Persoonlijke festivalplanner voor Graceland Festival 2026 (13–16 augustus,
Landgoed Velder, Liempde). Een scraper haalt het programma van
gracelandfestival.nl op naar `schema.json`; een enkel HTML-bestand laat je
daaruit je eigen weekend samenstellen. Alles in het Nederlands: interface,
commentaar, commitberichten.

## Bestanden

| Pad | Wat |
| --- | --- |
| `scrape_graceland.py` | Scraper. Overzichtspagina → slugs → detailpagina's → `schema.json`. |
| `planner.html` | De hele applicatie: één bestand, geen build, geen dependencies. |
| `schema.json` | Gegenereerd. Handmatig bewerken heeft geen zin, de volgende run overschrijft het. |
| `.graceland-cache.json` | Gegenereerd. Beschrijvingen per slug met timestamp, wordt meegecommit. |
| `worker/` | Cloudflare Worker + KV: de gedeelde planning van de vier. |
| `.github/workflows/schema.yml` | Elk half uur scrapen + publiceren op GitHub Pages. |
| `tests/` | Draait offline op fixtures. |

## Draaien

```bash
pip install -r requirements.txt
python scrape_graceland.py --out schema.json     # ~1 min de eerste keer
python tests/test_scraper.py                     # offline, geen netwerk
node tests/smoke_planner.mjs                     # vereist: npm install jsdom
```

De rooktest zet `API_URL` op `/api` en praat tegen een nepserver in het
testbestand zelf, dus ook die draait zonder netwerk.

## Netwerk in cloudsessies

De standaardomgeving van Claude Code op het web gebruikt Trusted network
access: pakketregisters zijn bereikbaar, `gracelandfestival.nl` niet. De
scraper zal in een sessie dus falen op DNS of een timeout — dat is geen bug in
de code. Werk tegen `tests/fixtures/`, of voeg het domein toe aan de
netwerkinstellingen van de omgeving. In GitHub Actions is er wel gewoon
netwerk, dus daar draait de scraper normaal.

## Afspraken die je niet moet omzeilen

**De scraper schrijft niets weg bij twijfel.** Bij een fout: melding op stderr
en exitcode 1, zodat de vorige `schema.json` blijft staan en de planner op zijn
cache terugvalt. De drempels `--min-programs` (80) en `--min-items` (100)
bestaan om te voorkomen dat een gewijzigde site een halfleeg schema oplevert.
Verlaag ze niet om een run "te laten slagen"; zoek uit waarom er minder
gevonden wordt.

**Podia komen van de detailpagina.** Elke `/programma/<slug>/` heeft een tabel
"Waar en wanneer" met dag, tijd en podium. Dát is de bron voor het podium. Het
blokkenschema (`/tijdschema/<dag>/`) wordt ter controle gelezen: wat daar staat
en nergens anders, wordt gemeld en toegevoegd — met de categorie en slug van
het gelijknamige programma als we dat kennen, anders categorie `O`. Een eerdere
versie leidde het podium af uit de documentvolgorde — niet naar terug.

**Het blokkenschema staat in twee kolommen.** `.timetable__grid--column-locations`
bevat per podium alleen de naam, `.timetable__grid--column-timeline` alleen de
blokken; de volgorde koppelt de twee. Zoek de podiumnaam niet binnen de lane
zelf — dan pak je de eerste programmatitel en verzin je een podium. Dat leverde
ooit een podium "Gracetalent" op plus zo'n 150 valse "podium verschilt"-meldingen.
Lopen beide kolommen niet gelijk, dan levert `parse_timetable` niets: geen
podium is beter dan een verzonnen podium.

**Bij een verschoven tijd wint het blokkenschema.** Staat hetzelfde programma
op dezelfde dag en hetzelfde podium maar op een andere tijd, dan is dat geen
tweede optreden maar een verschoven tijd; het blok krijgt de tijd van het
blokkenschema en dat wordt gemeld. Het blokkenschema wordt eerder bijgewerkt
dan de losse detailpagina's. Zonder deze regel stond Luchtkasteel donderdag
twee keer op Bospodium, om 21:00 én om 22:00.

**`SOURCE_URL` en `API_URL` in `planner.html` blijven leeg in de repo.** De
workflow vult met `sed` het relatieve pad `./schema.json` en `/api` in tijdens
het publiceren, zodat het bestand ook los op een schijf blijft werken. Verander
die regels niet van vorm zonder de `sed` en de twee `grep`-controles in de
workflow mee te nemen.

**De planner werkt ook zonder gedeelde opslag.** Is `API_URL` leeg of ligt de
Worker eruit, dan blijft alles werken met de opslag in de browser; wat je
wijzigt gaat bij de volgende geslaagde ronde alsnog mee. Bouw geen scherm dat
op een geslaagde serveraanroep wacht.

**Iedereen schrijft alleen zijn eigen lijstje.** `PUT /api/plan/<naam>` raakt
alleen die persoon, dus twee mensen die tegelijk plannen kunnen elkaar niet
overschrijven. Ga niet over op één document met alle vier erin zonder een
revisie-onderhandeling mee te leveren. De namen in `PEOPLE` staan zowel in
`planner.html` als in `worker/index.js`; die twee moeten gelijk blijven, en een
sleutel wijzigen betekent bestaande planning verhuizen.

**Verborgen podia zijn een keuze van de planner, niet van de scraper.**
`HIDDEN_STAGES` in `planner.html` haalt Kinderdorp en The Lounge uit het beeld;
`schema.json` blijft compleet. Filter ze niet weg in de scraper - dan is het
niet meer terug te draaien zonder opnieuw te scrapen.

**Geen `localStorage` als enige opslag.** `planner.html` gebruikt
`window.storage` als die bestaat en valt anders terug op `localStorage`, met
een in-memory laatste redmiddel. Dat is nodig omdat het bestand ook binnen een
Claude-artifact moet draaien, waar `localStorage` niet beschikbaar is.

**Beschrijvingen horen niet in `planner.html`.** De teksten en foto's zijn van
het festival. De planner laadt ze op het moment zelf uit `schema.json` en linkt
foto's rechtstreeks naar gracelandfestival.nl; er worden geen kopieën in de
repo gezet. Het ingebouwde noodschema in `planner.html` bevat alleen titels,
tijden en podia.

**Keuzes overleven een schemawijziging.** `migrate()` koppelt een selectie die
niet meer bestaat opnieuw op dag + titel, en meldt "verplaatst" of "vervallen".
Selectie-id's hebben de vorm `dag|podium|titel|begintijd`. Verander dat formaat
alleen als je migratie voor bestaande opslag meelevert.

## Waar het snel misgaat

- De site draait op WordPress met WP Rocket ervoor. HTML-structuur kan zonder
  aankondiging veranderen; `parse_timetable` leunt op de klassen
  `.timetable__grid--column-locations`, `.timetable__grid--column-timeline`,
  `.timetable__location`, `.timetable__stage`, `.timetable__performance` en
  `.timetable__performance-times`. Verandert daar iets, dan meldt de scraper
  "geen blokken herkend" in plaats van stilletjes onzin op te leveren.
- Tijden na middernacht horen bij de dag ervoor. `to_min()` telt 24 uur op bij
  een uur onder de 6. Zowel Python als JavaScript hebben hun eigen kopie van
  die regel; houd ze gelijk.
- Categorie per programma komt van de site, met voorrangsvolgorde
  Kinderen → Tieners → Muziek → Performance → Spreker → Workshop → Veld.
  Partnerlabels (LCC+, IJM, Protestantse Kerk Nederland, Spectrum, Leger des
  Heils, VIAA, Windesheim) zijn geen categorie.
- Zonder tijden-tabel is een programma "doorlopend" en komt het in `always`
  terecht, niet in `days`. Dat klopt: het veldprogramma heeft geen speeltijd.
  In de planner kun je er zelf een half uur voor prikken; zo'n zelfgemaakt blok
  krijgt een id `zelf|dag|podium|titel|begin|eind` en draagt alles wat nodig is
  om het te tonen. `migrate()` laat die ids met rust.

## Handige opdrachten

- `python scrape_graceland.py --inspect <slug>` — toont wat er van één
  detailpagina gelezen wordt, zonder iets weg te schrijven.
- `python scrape_graceland.py --refresh` — negeert de cache.
- `python scrape_graceland.py --no-timetable` — slaat de kruiscontrole over.
