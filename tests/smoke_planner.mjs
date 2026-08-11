/**
 * Rooktest voor planner.html in een echte DOM. Geen netwerk: fetch wordt
 * vervangen door tests/fixtures/schema.json.
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
  .replace("const SOURCE_URL = '';", "const SOURCE_URL = './schema.json';");
const schema = fs.readFileSync(path.join(here, 'fixtures', 'schema.json'), 'utf8');

let pass = 0; const fail = [];
const check = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else fail.push(`${name}\n    verwacht: ${JSON.stringify(want)}\n    gekregen: ${JSON.stringify(got)}`);
};

const dom = new JSDOM(html, {
  url: 'https://example.test/planner.html',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  beforeParse(w) {
    // jsdom kent <dialog> niet volledig
    w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
    // een keuze die in het nieuwe schema verschoven is, om migrate() te testen
    w.localStorage.setItem('graceland2026:selectie',
      JSON.stringify(['za|Grasland|Nynke Laverman|17:00']));
    w.fetch = async () => ({ ok: true, status: 200, json: async () => JSON.parse(schema) });
  }
});

const w = dom.window, d = w.document;
await new Promise(r => setTimeout(r, 400));
const q = s => d.querySelector(s), qa = s => [...d.querySelectorAll(s)];

check('live schema geladen', q('#status').className, 'status ok');
check('verplaatste keuze gemigreerd',
  JSON.parse(w.localStorage.getItem('graceland2026:selectie')),
  ['za|Grasland|Nynke Laverman|17:30']);
check('wijziging gemeld', /verplaatst/.test(q('#notice').textContent), true);

q('#tabs [data-day="za"]').click();
check('blokken op zaterdag', qa('.block').length, 2);
check('informatieknop bij programma met beschrijving', qa('.block .info').length >= 1, true);

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

qa('.occ')[0].click();
check('aanvinken vanuit programmalijst',
  JSON.parse(w.localStorage.getItem('graceland2026:selectie')).length, 2);

q('#vMine').click();
check('mijn programma toont beide', qa('.item').length, 2);

console.log(`${pass} geslaagd, ${fail.length} gefaald`);
fail.forEach(f => console.log('\nGEFAALD: ' + f));
process.exit(fail.length ? 1 : 0);
