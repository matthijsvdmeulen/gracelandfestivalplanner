# Eerste opdrachten voor Claude Code

Dit bestand hoort niet bij de applicatie; het is een spiekbriefje. Plak een van
onderstaande opdrachten in claude.ai/code nadat je deze repo geselecteerd hebt.

## Eerst even weten

Cloudsessies draaien standaard met beperkt netwerk: pakketregisters zijn
bereikbaar, gracelandfestival.nl niet. De scraper zal in een sessie dus falen
op DNS of een timeout. De tests draaien wel, want die gebruiken
`tests/fixtures/`. Wil je in een sessie tegen de echte site werken, voeg het
domein dan toe aan de netwerkinstellingen van je omgeving.

Claude werkt op een branch en zet er een pull request van. Een sessie sluit
niet af als er gepusht is, dus je kunt in hetzelfde gesprek doorpraten.

---

## Controleren of alles draait

> Lees CLAUDE.md. Draai daarna `python tests/test_scraper.py` en
> `node tests/smoke_planner.mjs` (installeer jsdom als dat nodig is) en vertel
> me wat er uitkomt. Verander nog niets.

## Als de site veranderd is en de scraper faalt

> De scraper faalt met de melding die ik hieronder plak. Kijk in
> `scrape_graceland.py` welke aanname niet meer klopt, pas de fixtures in
> `tests/fixtures/` aan zodat ze de nieuwe structuur weerspiegelen, en repareer
> de parser. Houd je aan de afspraken in CLAUDE.md: de drempels
> `--min-programs` en `--min-items` blijven staan, en podia blijven van de
> detailpagina komen. Voeg een test toe die het nieuwe geval afdekt.
>
> [melding hier]

## Een kaartje van het terrein toevoegen

> Voeg aan `planner.html` een vierde weergave "Terrein" toe met een
> schematische plattegrond van de podia, waarbij je op een podium kunt tikken
> om alleen dat podium in het blokkenschema te zien. Gebruik inline SVG, geen
> externe bibliotheken, en houd je aan de bestaande CSS-variabelen en het
> lettertypegebruik. Voeg de podiumposities toe als data in het bestand zelf,
> niet in schema.json.

## Delen met vrienden

> Maak het mogelijk om een selectie te delen via een URL: codeer de gekozen
> id's compact in de hash van de adresbalk, en laat de planner bij het openen
> vragen of de bezoeker die selectie wil overnemen of naast zijn eigen keuze
> wil zien. De opslag in de browser blijft leidend; een gedeelde link mag nooit
> ongevraagd iemands eigen programma overschrijven. Voeg een test toe aan
> `tests/smoke_planner.mjs`.

## Melding als iets bijna begint

> Voeg aan de weergave "Mijn programma" een aftelfunctie toe die tijdens het
> festival laat zien wat er nu bezig is en wat er hierna komt, op basis van de
> echte klok. Buiten 13–16 augustus 2026 hoort die strook er niet te staan.
> Denk aan tijden na middernacht: die horen bij de dag ervoor, zie `to_min()`.

## Onderhoud

> Draai de scraper, vergelijk het resultaat met de `schema.json` die nu in de
> repo staat, en vat samen wat er in het programma veranderd is: nieuwe
> onderdelen, verplaatste tijden, geschrapte items. Commit het resultaat alleen
> als de tests slagen.
