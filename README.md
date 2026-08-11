# Ons Graceland 2026

Gedeelde planner voor Graceland Festival 2026 (13–16 augustus, Landgoed
Velder, Liempde). Een scraper haalt het programma van gracelandfestival.nl op,
een enkel HTML-bestand laat je daaruit je weekend samenstellen. Met z'n vieren:
ieder heeft een eigen lijstje, en je ziet van elkaar waar je heen gaat.

Geen officiële uitgave van Graceland Festival. Het
[officiële tijdschema](https://gracelandfestival.nl/tijdschema/) blijft de bron.

## Wat het doet

- Blokkenschema per dag, met filters op soort en drie zoomniveaus
- Programmaoverzicht met beschrijvingen, foto's en zoeken
- Eigen selectie met overlapwaarschuwing, export naar tekst en `.ics`
- Gedeeld met z'n vieren: kies bovenin wie je bent, zie op elk blok wie er nog
  meer heen gaat, en in **Samen** de vier planningen naast elkaar
- Doorlopende onderdelen (het veldprogramma) zelf inplannen per half uur
- Kinderdorp en The Lounge blijven buiten beeld
- Wijzigt het schema, dan verhuist je keuze mee en krijg je te zien wat er
  veranderd is
- Werkt zonder netwerk: het laatst opgehaalde schema staat in de browser, en
  er zit een noodschema in het bestand zelf. Ligt de gedeelde opslag eruit, dan
  blijft je keuze lokaal staan en gaat hij later alsnog mee.

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
`planner.html` als `index.html` neer met `SOURCE_URL` op `./schema.json` en
`API_URL` op `/api`, dus planner, data en opslag staan op dezelfde origin en
CORS speelt geen rol.

Draai de workflow daarna één keer handmatig via **Actions → Run workflow**.

Let op: scheduled workflows op GitHub lopen bij drukte wat achter, en worden
uitgezet als er 60 dagen niets in de repo gebeurt.

## Gedeelde opslag

De planning van de vier staat in Cloudflare KV, achter een Worker die op
`gracelandplanner.meulen.dev/api/*` voor GitHub Pages langs hangt. Zelfde
origin als de planner, dus geen CORS.

Uitrollen gaat via `.github/workflows/worker.yml`, dus vanuit de browser en
zonder wrangler op je eigen machine. Eenmalig:

1. **Cloudflare → Storage & Databases → KV → Create**, naam `PLANNER`. Zet de
   namespace-id in `worker/wrangler.toml`.
2. **Cloudflare → My Profile → API Tokens**, een token met het sjabloon
   *Edit Cloudflare Workers*. Het account-id staat rechts op de
   Workers-overzichtspagina.
3. **GitHub → Settings → Secrets and variables → Actions**, drie secrets:
   `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` en `PLANNER_KEY` (de
   gedeelde toegangscode die jullie vier invullen).
4. **Actions → Worker uitrollen → Run workflow**.

Daarna rolt elke wijziging in `worker/` zichzelf uit. Liever lokaal:

```bash
cd worker
npm install -g wrangler && wrangler login
wrangler kv namespace create PLANNER     # vul de id in wrangler.toml
wrangler secret put PLANNER_KEY          # gedeelde toegangscode
wrangler deploy
```

De route werkt alleen als het DNS-record van `gracelandplanner.meulen.dev` in
Cloudflare **geproxyd** staat (oranje wolk). Bij het allereerste opzetten moet
hij juist op DNS-only (grijs) staan tot GitHub het certificaat heeft
uitgegeven; daarna omzetten naar geproxyd.

Iedereen schrijft alleen zijn eigen lijstje weg (`PUT /api/plan/<naam>`), dus
twee mensen die tegelijk plannen kunnen elkaar niet overschrijven. De planner
kijkt elke twintig seconden of er iets gewijzigd is.

Namen toevoegen of wijzigen: `PEOPLE` in `planner.html` én in
`worker/index.js`.

## Testen

```bash
python tests/test_scraper.py     # offline, op fixtures
npm install jsdom
node tests/smoke_planner.mjs     # offline, echte DOM
```

Beide draaien zonder netwerk, dus ook in omgevingen waar gracelandfestival.nl
niet bereikbaar is; de rooktest praat tegen een nepserver in het testbestand.

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
