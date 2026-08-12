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
| `worker/` | Cloudflare Worker + KV: de gedeelde planning, één groep per toegangscode. |
| `.github/workflows/schema.yml` | Elk half uur scrapen + publiceren op GitHub Pages. |
| `tests/` | Draait offline op fixtures. |

## Draaien

```bash
pip install -r requirements.txt
python scrape_graceland.py --out schema.json     # ~1 min de eerste keer
python tests/test_scraper.py                     # offline, geen netwerk
node tests/test_worker.mjs                       # KV in het geheugen
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

**De polling groeit mee met de groep.** Elke ronde kost een leesbewerking per
persoon, dus in een groep van N kost het N x (N+1) leesbewerkingen per ronde
als iedereen kijkt. Bij 24 mensen op 20 seconden is dat ruim 200.000 per dag,
en de gratis KV-tier stopt bij 100.000. `pollDelay()` schaalt daarom mee
(2 seconden per persoon, minimaal 20). Zet dat niet terug op een vast interval
zonder de rekensom opnieuw te maken; `MAX_PEOPLE` staat op 24.

**Iedereen schrijft alleen zijn eigen lijstje.** `PUT /api/plan/<id>` raakt
alleen die persoon, dus twee mensen die tegelijk plannen kunnen elkaar niet
overschrijven. Ga niet over op één document met iedereen erin zonder een
revisie-onderhandeling mee te leveren.

**De code is de groep.** Uit de toegangscode leidt de Worker met HMAC-SHA256 en
`GROUP_SALT` een groeps-id af; de code zelf komt nooit in KV terecht. Vervang
dat niet door een kale hash: met HMAC is er zonder die sleutel geen groeps-id
te berekenen, ook niet met een woordenlijst en de KV-inhoud ernaast. `GROUP_SALT`
wijzigen maakt alle bestaande groepen onvindbaar.

**Een onbekende code levert nooit stilzwijgend een lege groep op.** De Worker
antwoordt met 404 en `unknown: true`, en de planner vraagt dan om bevestiging.
Zonder die stap is een typefout in je code niet te onderscheiden van "al mijn
planning is verdwenen" - en dat is precies het moment waarop iemand in paniek
opnieuw begint te klikken.

**Namen horen bij de groep, niet bij de code.** `PEOPLE` staat niet meer in
`planner.html`: de planner haalt de namen op en cachet ze onder
`graceland2026:groep`, zodat een netwerkhapering het scherm niet leegmaakt.
Persoons-id's zijn los van de weergavenaam, zodat hernoemen niemand zijn
planning kost; verwijderen ruimt de planning van die persoon wél op.

**Alle podia staan in beeld.** Kinderdorp en The Lounge waren een tijd
verborgen omdat de eerste groep ze niet gebruikte; nu de planner ook door
anderen gebruikt wordt, staan ze er weer bij. Wie ze niet wil zien gebruikt de
soortfilters (Kinderen, Tieners). Filter podia niet weg in de scraper - dan is
het niet meer terug te draaien zonder opnieuw te scrapen.

**Een groep die de server niet kent, wordt niet stilzwijgend hersteld.** Bij
`unknown` gooit de planner de gecachete namen weg en meldt hij iets anders dan
bij een nog onbekende code: anders komt een oude browser telkens terug met een
verdwenen groep en maakt iemand hem per ongeluk opnieuw aan. De Worker maakt
zelf nooit een groep aan; dat kan alleen met een expliciete `POST /api/group`.

**Het programma blijft zonder code te bekijken.** Alleen de namen en de
planning zitten achter het slot. Zet het blokkenschema en de programmalijst er
niet ook achter: dat is openbare festivalinformatie, en de planner is zo meteen
bruikbaar voor wie hem opent.

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
