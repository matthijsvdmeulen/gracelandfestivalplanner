# Mijn Graceland 2026

Persoonlijke planner voor Graceland Festival 2026 (13–16 augustus, Landgoed
Velder, Liempde). Een scraper haalt het programma van gracelandfestival.nl op,
een enkel HTML-bestand laat je daaruit je eigen weekend samenstellen. Je keuze
blijft in je eigen browser staan.

Geen officiële uitgave van Graceland Festival. Het
[officiële tijdschema](https://gracelandfestival.nl/tijdschema/) blijft de bron.

## Wat het doet

- Blokkenschema per dag, met filters op soort en drie zoomniveaus
- Programmaoverzicht met beschrijvingen, foto's en zoeken
- Eigen selectie met overlapwaarschuwing, export naar tekst en `.ics`
- Wijzigt het schema, dan verhuist je keuze mee en krijg je te zien wat er
  veranderd is
- Werkt zonder netwerk: het laatst opgehaalde schema staat in de browser, en
  er zit een noodschema in het bestand zelf

## Aan de praat

```bash
pip install -r requirements.txt
python scrape_graceland.py --out schema.json
```

De eerste run duurt ongeveer een minuut, daarna zit het meeste in
`.graceland-cache.json` en gaat het in seconden. Open daarna `planner.html`
en zet bovenin `SOURCE_URL` op het pad naar je `schema.json`, of laat hem leeg
om het ingebouwde noodschema te gebruiken.

## Publiceren op GitHub Pages

`.github/workflows/schema.yml` scrapet elk half uur en publiceert het geheel.
Eenmalig: **Settings → Pages → Source: GitHub Actions**. De workflow zet
`planner.html` als `index.html` neer met `SOURCE_URL` op `./schema.json`, dus
planner en data staan op dezelfde origin en CORS speelt geen rol.

Draai de workflow daarna één keer handmatig via **Actions → Run workflow**.

Let op: scheduled workflows op GitHub lopen bij drukte wat achter, en worden
uitgezet als er 60 dagen niets in de repo gebeurt.

## Testen

```bash
python tests/test_scraper.py     # offline, op fixtures
npm install jsdom
node tests/smoke_planner.mjs     # offline, echte DOM
```

Beide draaien zonder netwerk, dus ook in omgevingen waar gracelandfestival.nl
niet bereikbaar is.

## Hoe het in elkaar zit

Elke `/programma/<slug>/` heeft een tabel "Waar en wanneer" met dag, tijd en
podium. Dat is de bron voor het schema. Het blokkenschema wordt daarnaast
opgehaald als controle: wat daar wel staat en op geen detailpagina, wordt
gemeld en alsnog toegevoegd. Bij een fout of een verdacht mager resultaat
schrijft de scraper niets weg en eindigt met exitcode 1, zodat een bestaande
`schema.json` intact blijft.

Beschrijvingen en foto's blijven van het festival: ze staan in `schema.json`,
foto's worden rechtstreeks vanaf gracelandfestival.nl geladen en er komen geen
kopieën in de repo. Ga je dit breder delen dan met wat vrienden, laat het
Graceland dan even weten.

Meer achtergrond en de afspraken waar de code zich aan houdt: `CLAUDE.md`.
