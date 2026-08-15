/**
 * Rooktest voor planner.html in een echte DOM. Geen netwerk: het schema komt
 * uit tests/fixtures/schema.json en de gedeelde opslag is een nepserver in
 * dit bestand, die zich net zo gedraagt als worker/index.js.
 *
 *   npm install jsdom
 *   node tests/smoke_planner.mjs
 */
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const html = fs.readFileSync(path.join(root, 'planner.html'), 'utf8')
  .replace("const SOURCE_URL = '';", "const SOURCE_URL = './schema.json';")
  .replace("const API_URL = '';", "const API_URL = '/api';");
const schema = fs.readFileSync(path.join(here, 'fixtures', 'schema.json'), 'utf8');

let pass = 0; const fail = [];
const check = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else fail.push(`${name}\n    verwacht: ${JSON.stringify(want)}\n    gekregen: ${JSON.stringify(got)}`);
};

/* Nepserver: één groep per code, net als de Worker. */
const server = { groups: {}, puts: [] };
let nextId = 0;
function apiRespond(url, opts) {
  const method = (opts && opts.method) || 'GET';
  const code = (opts && opts.headers && opts.headers['x-planner-key']) || '';
  const g = server.groups[code];

  if (url.endsWith('/api/plan') && method === 'GET') {
    if (!g) return { __status: 404, unknown: true, error: 'deze code kent nog geen groep' };
    return { people: g.people, plans: g.plans, revs: g.revs };
  }
  if (url.endsWith('/api/group') && method === 'POST') {
    if (g) return { __status: 409, error: 'bestaat al' };
    const people = JSON.parse(opts.body).people
      .map(p => ({ id: 'p' + (++nextId), name: p.name, color: '#2F5D8C' }));
    server.groups[code] = { people, plans: {}, revs: {} };
    return { people, plans: {}, revs: {} };
  }
  if (url.endsWith('/api/group') && method === 'PUT') {
    if (!g) return { __status: 404, unknown: true };
    const people = JSON.parse(opts.body).people
      .map(p => ({ id: p.id || ('p' + (++nextId)), name: p.name, color: '#2F5D8C' }));
    const keep = new Set(people.map(p => p.id));
    Object.keys(g.plans).forEach(k => { if (!keep.has(k)) { delete g.plans[k]; delete g.revs[k]; } });
    g.people = people;
    return { people, plans: g.plans, revs: g.revs };
  }
  const m = url.match(/\/api\/plan\/([a-zA-Z0-9_-]+)$/);
  if (m && method === 'PUT') {
    if (!g) return { __status: 404, unknown: true };
    const ids = JSON.parse(opts.body).ids;
    g.plans[m[1]] = ids;
    g.revs[m[1]] = (g.revs[m[1]] || 0) + 1;
    server.puts.push({ person: m[1], ids });
    return { ok: true, person: m[1], rev: g.revs[m[1]] };
  }
  return { __status: 404, error: 'onbekend pad' };
}

const dom = new JSDOM(html, {
  url: 'https://example.test/planner.html',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  beforeParse(w) {
    w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
    w.confirm = () => true;
    // Een keuze uit de eenpersoonsversie, verschoven in het nieuwe schema.
    w.localStorage.setItem('graceland2026:selectie',
      JSON.stringify(['za|Grasland|Nynke Laverman|17:00']));
    w.fetch = async (url, opts) => {
      if (!url.includes('/api/')) {
        return { ok: true, status: 200, json: async () => JSON.parse(schema) };
      }
      const body = apiRespond(url, opts);
      const status = body.__status || 200;
      return { ok: status < 400, status, json: async () => body };
    };
  }
});

const w = dom.window, d = w.document;
const settle = (ms = 150) => new Promise(r => setTimeout(r, ms));
await settle(500);
const q = s => d.querySelector(s), qa = s => [...d.querySelectorAll(s)];
const stored = () => JSON.parse(w.localStorage.getItem('graceland2026:planning') || '{}');
const activeName = () => q('#who .who[aria-pressed="true"]').textContent.replace(/\d+$/, '').trim();

/* --- vergrendeld: programma zichtbaar, namen niet ------------------------ */
check('live schema geladen', q('#status').className, 'status ok');
check('geen namen zichtbaar zonder code', qa('#who .who').length, 0);
check('wel een ontgrendelknop', !!q('#btnUnlock'), true);
check('blokkenschema is gewoon te zien', qa('.block').length > 0, true);
check('status meldt vergrendeld', q('#sync').textContent, 'Vergrendeld');

q('#vMine').click();
check('mijn programma zit achter de code',
  /code van je groep/.test(q('.empty').textContent), true);
check('het slot nodigt uit tot aanmaken',
  /aanmaken/i.test(q('#btnUnlock').textContent), true);
check('voettekst noemt de disclaimer en Claude',
  /Geen offici\u00eble uitgave/.test(q('footer').textContent) &&
  /Claude Code/.test(q('footer').textContent), true);

/* --- klikken op een blok vraagt om de code ------------------------------- */
q('#vSchema').click();
qa('.block')[0].click();
await settle();
check('blok aanklikken opent de poort', q('#gate').hasAttribute('open'), true);
check('niets gekozen zolang het op slot zit', server.puts.length, 0);

/* --- onbekende code leidt niet stilzwijgend tot een lege groep ----------- */
q('#gCode').value = 'vriendengroep-een';
q('#gGo').click();
await settle(400);
check('onbekende code vraagt om bevestiging',
  /kent nog geen groep/.test(q('#gate').textContent), true);
check('aanmaken is de duidelijke uitweg', /aanmaken/i.test(q('#gNew').textContent), true);
check('nog steeds vergrendeld', qa('#who .who').length, 0);

/* --- groep aanmaken ------------------------------------------------------ */
q('#gNew').click();
await settle();
check('namenscherm verschijnt', /Wie plannen er mee/.test(q('#gate h2').textContent), true);
check('de dialoog zweeft en sleept de pagina niet mee',
  w.getComputedStyle(q('#detail')).position, 'fixed');
const typ = (i, v) => {
  const inp = qa('#gList input')[i];
  inp.value = v;
  inp.dispatchEvent(new w.Event('input'));
};
typ(0, 'Matthijs');
q('#gAdd').click(); await settle(); typ(1, 'Ruben');
q('#gAdd').click(); await settle(); typ(2, 'Bart');
q('#gSave').click();
await settle(1000);

check('groep aangemaakt, drie namen', qa('#who .who').map(e => e.textContent.replace(/\d+$/, '').trim()),
  ['Matthijs', 'Ruben', 'Bart']);
check('poort gesloten', q('#gate').hasAttribute('open'), false);
check('status meldt gedeeld', /Gedeeld/.test(q('#sync').textContent), true);
check('namenknop beschikbaar', !!q('#btnNames'), true);

const ids = server.groups['vriendengroep-een'].people.map(p => p.id);
check('keuze uit de eenpersoonsversie alsnog overgenomen en gemigreerd',
  stored()[ids[0]], ['za|Grasland|Nynke Laverman|17:30']);
check('wijziging gemeld', /verplaatst/.test(q('#notice').textContent), true);

/* --- alle podia staan er, ook Kinderdorp en The Lounge ------------------- */
q('#vSchema').click();
q('#tabs [data-day="vr"]').click();
check('geen podium wordt verborgen',
  qa('.lane .nm').map(e => e.firstChild.textContent.trim()),
  ['Grasland', 'Bospodium', 'Kinderdorp', 'The Lounge', 'Stiltekapel']);

// Een kwartier duurt maar 34px breed. Ook daar hoort de informatieknop te
// staan; die zat eerder achter een drempel van 96px.
const kort = qa('.block').find(b => /Getijdengebeden/.test(b.textContent));
check('kort blok is er', !!kort, true);
check('kort blok telt als smal', kort.classList.contains('narrow'), true);
check('en heeft toch een informatieknop', !!kort.querySelector('.info'), true);
// Alleen blokken waarvan we de beschrijving kennen krijgen de knop; Kinderdorp
// en The Lounge staan niet in programs van de fixture.
check('elk blok met een beschrijving heeft er een',
  qa('.block.metinfo').length, qa('.block .info').length);
check('en blokken zonder beschrijving juist niet',
  qa('.block:not(.metinfo) .info').length, 0);

/* --- kiezen synchroniseert ----------------------------------------------- */
qa('.block')[0].click();
await settle(900);
check('keuze naar de server', server.puts.at(-1).person, ids[0]);
check('server heeft beide keuzes', server.groups['vriendengroep-een'].plans[ids[0]].length, 2);

/* --- doorlopend zelf inplannen ------------------------------------------- */
q('#vMine').click();
check('doorlopend-paneel staat er', !!q('#fAdd'), true);
// De dag begint nu om 10:00: Kinderdorp staat er weer bij en telt mee.
check('halfuurstappen', [...q('#fStart').options].slice(0, 3).map(o => o.textContent),
  ['09:30', '10:00', '10:30']);
q('#fWhat').value = 'Labyrint';
q('#fStart').value = [...q('#fStart').options].find(o => o.textContent === '20:30').value;
q('#fDur').value = '90';
q('#fDur').dispatchEvent(new w.Event('change'));
q('#fStart').dispatchEvent(new w.Event('change'));
q('#fAdd').click();
await settle(900);
check('doorlopend ingepland',
  (stored()[ids[0]] || []).filter(x => x.startsWith('zelf|')), ['zelf|vr|Veld|Labyrint|20:30|22:00']);
check('doorlopend zichtbaar', qa('.item .what').some(e => /Labyrint/.test(e.textContent)), true);

/* --- ieder zijn eigen lijstje -------------------------------------------- */
qa('#who .who')[1].click();
await settle(200);
check('wisselen van persoon', activeName(), 'Ruben');
check('Ruben begint leeg', /Nog niets gekozen voor Ruben/.test(q('.empty').textContent), true);

q('#vSchema').click();
qa('.block')[0].click();
await settle(900);
check('Ruben schrijft onder eigen naam weg', server.puts.at(-1).person, ids[1]);
check('lijstje van Matthijs blijft staan', stored()[ids[0]].length, 3);
check('stipje van de ander op het blok', qa('.block .crowd i').length >= 1, true);

/* --- samen --------------------------------------------------------------- */
q('#vAll').click();
check('drie kolommen', qa('.samen .col').length, 3);
check('samen-melding noemt beide namen',
  /Matthijs/.test(q('.samen .both').textContent) && /Ruben/.test(q('.samen .both').textContent), true);

/* --- namen wijzigen ------------------------------------------------------ */
q('#btnNames').click();
await settle();
check('namenscherm toont de huidige namen',
  qa('#gList input').map(i => i.value), ['Matthijs', 'Ruben', 'Bart']);
typ(0, 'Matthijs vd M');
qa('#gList .rmn')[2].click();          // Bart eruit
await settle();
q('#gSave').click();
await settle(500);
check('hernoemd en ingekort', qa('#who .who').map(e => e.textContent.replace(/\d+$/, '').trim()),
  ['Matthijs vd M', 'Ruben']);
check('hernoemen kost geen planning', stored()[ids[0]].length, 3);
check('de weggehaalde is ook op de server weg',
  server.groups['vriendengroep-een'].plans[ids[2]], undefined);

/* --- programma en detail -------------------------------------------------- */
q('#vProg').click();
check('programmalijst', qa('.prog h3').map(e => e.textContent),
  ['Ezra', 'Getijdengebeden', 'Labyrint', 'Lucky Fonz III', 'Nynke Laverman']);

// Labyrint is een veldprogramma, geen muziek: die hoort geen Spotify-link
// te krijgen.
check('alleen muziekartiesten krijgen een Spotify-link in de lijst',
  qa('.prog').filter(k => k.querySelector('a.sp'))
    .map(k => k.querySelector('h3').textContent).sort(),
  ['Ezra', 'Lucky Fonz III', 'Nynke Laverman']);

q('.more').click();
check('detailvenster opent', q('#detail h2').textContent, 'Ezra');
const frame = q('#detail .vid iframe');
check('video-embed staat erin', !!frame, true);
check('embed wijst naar de juiste video, zonder cookies',
  frame.getAttribute('src'), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
check('embed laadt pas als het nodig is', frame.getAttribute('loading'), 'lazy');
check('titel van de video erboven', q('#detail .vid h3').textContent, 'Ezra - Live');
const sp = [...q('#detail').querySelectorAll('.dlinks a')]
  .find(a => /Spotify/.test(a.textContent));
check('Spotify-link bij een muziekartiest', !!sp, true);
check('en dat is een zoeklink op de naam',
  sp.getAttribute('href'), 'https://open.spotify.com/search/Ezra');
// Hetzelfde optreden staat ook in de lijst erachter; dat moet meebewegen.
const inModal = q('#detail .occ');
const zelfdeId = inModal.dataset.id;
const inLijst = qa('.proglist .occ').find(b => b.dataset.id === zelfdeId);
check('optreden staat in lijst en modal', !!inLijst, true);
const wasAan = inModal.classList.contains('on');
inModal.click();
await settle();
check('aanvinken in de modal licht ook in de lijst op',
  inLijst.classList.contains('on'), !wasAan);
check('en de modal zelf ook', inModal.classList.contains('on'), !wasAan);
inModal.click();
await settle();
q('#closeDetail').click();

/* --- wat een ander wijzigt komt binnen ----------------------------------- */
server.groups['vriendengroep-een'].plans[ids[1]] = ['vr|Grasland|Lucky Fonz III|19:00'];
server.groups['vriendengroep-een'].revs[ids[1]] = 99;
await w.eval('pullPlans()');
await settle(300);
check('wijziging van een ander opgehaald', stored()[ids[1]], ['vr|Grasland|Lucky Fonz III|19:00']);

/* --- een andere code is een andere groep --------------------------------- */
server.groups['andere-vrienden'] = {
  people: [{ id: 'z1', name: 'Zed', color: '#000' }], plans: {}, revs: {},
};
q('#sync').click();
await settle();
q('#gCode').value = 'andere-vrienden';
q('#gGo').click();
await settle(500);
check('andere code toont een andere groep',
  qa('#who .who').map(e => e.textContent.replace(/\d+$/, '').trim()), ['Zed']);

/* --- een grote groep ----------------------------------------------------- */
const groot = Array.from({ length: 24 }, (_, i) => ({ id: 'g' + i, name: 'Naam' + i, color: '#2F5D8C' }));
server.groups['grote-groep-24'] = {
  people: groot,
  // iedereen op hetzelfde blok, om de stipjes te testen
  plans: Object.fromEntries(groot.map(p => [p.id, ['vr|Grasland|Lucky Fonz III|19:00']])),
  revs: Object.fromEntries(groot.map(p => [p.id, 1])),
};
q('#sync').click();
await settle();
q('#gCode').value = 'grote-groep-24';
q('#gGo').click();
await settle(600);
check('vierentwintig mensen in de balk', qa('#who .who').length, 24);
q('#vAll').click();
check('vierentwintig kolommen in Samen', qa('.samen .col').length, 24);
q('#vSchema').click();
q('#tabs [data-day="vr"]').click();
const blok = qa('.block').find(b => /Lucky Fonz/.test(b.textContent));
check('stipjes blijven beperkt', blok.querySelectorAll('.crowd i').length, 4);
check('en de rest wordt geteld', blok.querySelector('.crowd b').textContent, '+19');
check('de namen staan wel in de tooltip', /ook Naam/.test(blok.getAttribute('title')), true);
check('polling vertraagt mee met de groep', await w.eval('pollDelay()'), 48000);

/* --- de nu-streep --------------------------------------------------------- */
const zetTijd = async iso => {
  await w.eval(`nowFn = () => new Date(${JSON.stringify(iso)})`);
  await w.eval('render(true)');
  await settle();
};
q('#vSchema').click();

// Vrijdagavond 21:15. De x vragen we op bij de planner zelf, zodat deze tests
// niet omvallen zodra er een vroeger blok bij komt en de dag eerder begint.
// jsdom rekent geen opmaak uit, dus clientWidth is 0 en de streep komt precies
// op die x te staan.
await zetTijd('2026-08-14T21:15:00+02:00');
q('#tabs [data-day="vr"]').click();
await settle();
const verwachtX = await w.eval('nowX(DAYS.find(x => x.key === "vr")).x');
check('nu-streep staat er op de dag zelf', qa('.nowline').length > 0, true);
check('label noemt de tijd', q('#nowtick').textContent, 'nu 21:15');
check('streep op de juiste plek', q('#nowtick').style.left, verwachtX + 'px');
check('per podium een stukje streep', qa('.nowline').length, qa('.row .track').length);

check('schema schuift bij het openen naar nu', q('#scroller').scrollLeft, verwachtX);

// Na het laden komt het live schema binnen en wordt alles opnieuw getekend.
// Zonder deze fix stond je dan weer helemaal links.
await w.eval('render()');
await settle();
check('en blijft daar na een hertekening', q('#scroller').scrollLeft, verwachtX);

// Een ronde die de positie herstelt is ons eigen schuiven en mag de sprong
// niet uitschakelen.
await settle(500);
await w.eval('render(true)');
await settle();
check('een ronde schakelt de sprong niet uit', q('#scroller').scrollLeft, verwachtX);

// Zodra je zelf schuift houdt de planner op met sturen: een ronde die je
// positie kan herstellen laat hem gewoon staan.
await settle(500);
q('#scroller').scrollLeft = 300;
q('#scroller').dispatchEvent(new w.Event('scroll'));
await w.eval('render(true)');
await settle();
check('na zelf schuiven blijft je eigen plek staan', q('#scroller').scrollLeft, 300);

// Opnieuw ophalen gebeurt ook bij elke visibilitychange, dus als je je telefoon
// ontgrendelt. Dat mag je plek niet kosten.
await w.eval('loadRemote(false)');
await settle(400);
check('opnieuw ophalen houdt je plek', q('#scroller').scrollLeft, 300);

// Valt er echt niets te herstellen, dan is de nu-streep een betere landingsplek
// dan het begin van de dag.
await w.eval('render()');
await settle();
check('zonder positie landt hij op nu', q('#scroller').scrollLeft, verwachtX);

// Het schema opnieuw openen springt weer naar nu.
q('#vProg').click();
q('#vSchema').click();
await settle();
check('opnieuw openen springt weer naar nu', q('#scroller').scrollLeft, verwachtX);

// Zelfde moment, maar je kijkt naar een andere dag: dan hoort er niets te staan.
q('#tabs [data-day="za"]').click();
await settle();
check('geen streep op een andere dag', qa('.nowline').length, 0);

// Na middernacht hoor je nog bij de avond ervoor: zondag 00:00 telt als
// zaterdag, op 24:00 van de tijdas.
await zetTijd('2026-08-16T00:00:00+02:00');
q('#tabs [data-day="za"]').click();
await settle();
check('na middernacht nog bij de dag ervoor', qa('.nowline').length > 0, true);
check('en op het einde van de tijdas', q('#nowtick').textContent, 'nu 00:00');

// Buiten het festival helemaal geen streep.
await zetTijd('2026-09-01T14:00:00+02:00');
check('buiten het festival geen streep', qa('.nowline').length, 0);
check('en geen label', !!q('#nowtick'), false);

// Ver voor het begin van de dag ook niet.
await zetTijd('2026-08-14T07:00:00+02:00');
q('#tabs [data-day="vr"]').click();
await settle();
check('voor het eerste blok nog geen streep', qa('.nowline').length, 0);

await zetTijd('2026-09-01T14:00:00+02:00');

/* --- breedte wordt onthouden --------------------------------------------- */
q('#zoom [data-z="1.4"]').click();
await settle();
check('breedte in de opslag', w.localStorage.getItem('graceland2026:breedte'), '1.4');
check('gekozen knop staat aan', q('#zoom [data-z="1.4"]').getAttribute('aria-pressed'), 'true');
check('en de vorige uit', q('#zoom [data-z="2.2"]').getAttribute('aria-pressed'), 'false');
check('ppm mee', await w.eval('ppm'), 1.4);

// Zoals bij het laden: uit de opslag terugzetten.
check('herstellen lukt', await w.eval('setZoom("3.2")'), true);
check('ppm hersteld', await w.eval('ppm'), 3.2);
check('en de knop volgt', q('#zoom [data-z="3.2"]').getAttribute('aria-pressed'), 'true');

// Een waarde die geen knop is, mag de opmaak niet slopen.
check('onzinwaarde wordt genegeerd', await w.eval('setZoom("99")'), false);
check('ppm blijft dan staan', await w.eval('ppm'), 3.2);
check('en een lege opslag ook', await w.eval('setZoom(null)'), false);

await w.eval('setZoom("2.2")');
await w.eval('render()');
await settle();

/* --- een groep die van de server verdwenen is ---------------------------- */
delete server.groups['grote-groep-24'];
await w.eval('pullPlans()');
await settle(300);
check('verdwenen groep vergrendelt', qa('#who .who').length, 0);
check('gecachete namen zijn opgeruimd',
  w.localStorage.getItem('graceland2026:groep') || '', '');
q('#btnUnlock').click();
await settle();
check('en de melding is een andere dan bij een nieuwe code',
  /bestaat niet meer/.test(q('#gate h2').textContent), true);
check('andere code invullen is de hoofdactie',
  /Andere code/.test(q('#gBack').textContent), true);
q('#gClose').click();

console.log(`${pass} geslaagd, ${fail.length} gefaald`);
fail.forEach(f => console.log('\nGEFAALD: ' + f));
process.exit(fail.length ? 1 : 0);
