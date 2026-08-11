/**
 * Rooktest voor planner.html in een echte DOM. Geen netwerk: het schema komt
 * uit tests/fixtures/schema.json en de gedeelde opslag is een nepserver in
 * dit bestand, die onthoudt wat de planner wegschrijft.
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

/* Nepserver: houdt per persoon een lijstje bij, net als de Worker. */
const server = { plans: {}, revs: {}, puts: [] };
function apiRespond(url, opts) {
  const method = (opts && opts.method) || 'GET';
  if (url.endsWith('/api/plan') && method === 'GET') {
    return { plans: server.plans, revs: server.revs };
  }
  const m = url.match(/\/api\/plan\/([a-z]+)$/);
  if (m && method === 'PUT') {
    const person = m[1];
    const ids = JSON.parse(opts.body).ids;
    server.plans[person] = ids;
    server.revs[person] = (server.revs[person] || 0) + 1;
    server.puts.push({ person, ids });
    return { ok: true, person, rev: server.revs[person] };
  }
  return { error: 'onbekend pad' };
}

const dom = new JSDOM(html, {
  url: 'https://example.test/planner.html',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  beforeParse(w) {
    // jsdom kent <dialog> niet volledig
    w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
    // Een keuze uit de eenpersoonsversie, die verschoven is in het nieuwe
    // schema: test zowel de overname als migrate().
    w.localStorage.setItem('graceland2026:selectie',
      JSON.stringify(['za|Grasland|Nynke Laverman|17:00']));
    w.fetch = async (url, opts) => {
      const body = url.includes('/api/') ? apiRespond(url, opts) : JSON.parse(schema);
      return { ok: true, status: 200, json: async () => body };
    };
  }
});

const w = dom.window, d = w.document;
const settle = (ms = 120) => new Promise(r => setTimeout(r, ms));
await settle(500);
const q = s => d.querySelector(s), qa = s => [...d.querySelectorAll(s)];
const stored = () => JSON.parse(w.localStorage.getItem('graceland2026:planning') || '{}');
/* De naamknop draagt ook een telbadge; die hoort niet bij de naam. */
const activeName = () => q('#who .who[aria-pressed="true"]').textContent.replace(/\d+$/, '').trim();

check('live schema geladen', q('#status').className, 'status ok');
check('keuze uit de eenpersoonsversie overgenomen en gemigreerd',
  stored().matthijs, ['za|Grasland|Nynke Laverman|17:30']);
check('wijziging gemeld', /verplaatst/.test(q('#notice').textContent), true);
check('vier mensen in de balk', qa('#who .who').length, 4);
check('eerste persoon is actief', activeName(), 'Matthijs');

/* --- verborgen podia --------------------------------------------------- */
q('#tabs [data-day="vr"]').click();
const lanes = qa('.lane .nm').map(e => e.firstChild.textContent.trim());
check('Kinderdorp en The Lounge zijn eruit', lanes, ['Grasland', 'Bospodium']);

/* --- kiezen synchroniseert naar de server ------------------------------ */
qa('.block')[0].click();
await settle(900);
check('keuze naar de server gestuurd', server.puts.at(-1).person, 'matthijs');
check('server heeft beide keuzes',
  server.plans.matthijs.length, 2);

/* --- doorlopend zelf inplannen ----------------------------------------- */
q('#vMine').click();
check('doorlopend-paneel staat er', !!q('#fAdd'), true);
check('halfuurstappen in de keuzelijst',
  [...q('#fStart').options].slice(0, 3).map(o => o.textContent), ['19:00', '19:30', '20:00']);
q('#fWhat').value = 'Labyrint';
q('#fStart').value = [...q('#fStart').options].find(o => o.textContent === '20:30').value;
q('#fDur').value = '90';
q('#fDur').dispatchEvent(new w.Event('change'));
q('#fStart').dispatchEvent(new w.Event('change'));
q('#fAdd').click();
await settle(900);
const own = (stored().matthijs || []).filter(x => x.startsWith('zelf|'));
check('doorlopend onderdeel ingepland', own, ['zelf|vr|Veld|Labyrint|20:30|22:00']);
check('doorlopend staat in mijn programma',
  qa('.item .what').some(e => /Labyrint/.test(e.textContent)), true);
check('doorlopend ook naar de server',
  server.plans.matthijs.some(x => x.startsWith('zelf|')), true);

/* --- iedereen zijn eigen lijstje --------------------------------------- */
qa('#who .who')[1].click();
await settle(200);
check('wisselen van persoon', activeName(), 'Ruben');
check('Ruben begint leeg', /Nog niets gekozen voor Ruben/.test(q('.empty').textContent), true);

q('#vSchema').click();
qa('.block')[0].click();
await settle(900);
check('Ruben schrijft onder eigen naam weg', server.puts.at(-1).person, 'ruben');
check('Matthijs zijn lijstje blijft staan', stored().matthijs.length, 3);
check('stipje van de ander op het blok', qa('.block .crowd i').length >= 1, true);

/* --- samen ------------------------------------------------------------- */
q('#vAll').click();
check('vier kolommen', qa('.samen .col').length, 4);
check('samen-melding noemt beide namen',
  /Matthijs/.test(q('.samen .both').textContent) && /Ruben/.test(q('.samen .both').textContent), true);

/* --- programma en detail ----------------------------------------------- */
q('#vProg').click();
check('programmalijst', qa('.prog h3').map(e => e.textContent),
  ['Ezra', 'Labyrint', 'Lucky Fonz III', 'Nynke Laverman']);
check('doorlopend zonder tijden', qa('.cont').length, 1);

q('#q').value = 'nachtset';
q('#q').dispatchEvent(new w.Event('input'));
check('zoeken doorzoekt beschrijvingen', qa('.prog h3').map(e => e.textContent), ['Ezra']);
q('#q').value = '';
q('#q').dispatchEvent(new w.Event('input'));

q('.more').click();
check('detailvenster opent', q('#detail h2').textContent, 'Ezra');
q('#closeDetail').click();

/* --- wat een ander wijzigt komt binnen --------------------------------- */
server.plans.bart = ['vr|Grasland|Lucky Fonz III|19:00'];
server.revs.bart = 9;
await w.eval('pullPlans()');
await settle(200);
check('wijziging van een ander opgehaald', stored().bart,
  ['vr|Grasland|Lucky Fonz III|19:00']);

console.log(`${pass} geslaagd, ${fail.length} gefaald`);
fail.forEach(f => console.log('\nGEFAALD: ' + f));
process.exit(fail.length ? 1 : 0);
