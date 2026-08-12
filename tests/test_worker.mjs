/**
 * Test voor worker/index.js, met een KV-namespace in het geheugen.
 * Geen netwerk, geen wrangler, geen Cloudflare-account.
 *
 *   node tests/test_worker.mjs
 */
import worker from '../worker/index.js';

let pass = 0; const fail = [];
const check = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else fail.push(`${name}\n    verwacht: ${JSON.stringify(want)}\n    gekregen: ${JSON.stringify(got)}`);
};

/** KV in het geheugen, met net genoeg van de echte API. */
function makeKV(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    async get(k) { return map.has(k) ? map.get(k) : null; },
    async put(k, v) { map.set(k, v); },
    async delete(k) { map.delete(k); },
  };
}

const CODE = 'graceland-geheim';
const env0 = () => ({ PLANNER: makeKV(), GROUP_SALT: 'testzout' });

async function call(env, method, path, { code = CODE, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (code !== null) headers['x-planner-key'] = code;
  const res = await worker.fetch(new Request('https://x' + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  let json = null;
  try { json = await res.json(); } catch { /* leeg antwoord */ }
  return { status: res.status, body: json };
}

/* --- health lekt geen namen ---------------------------------------------- */
{
  const env = env0();
  const r = await call(env, 'GET', '/api/health', { code: null });
  check('health werkt zonder code', r.status, 200);
  check('health noemt geen namen', 'people' in r.body, false);
}

/* --- een te korte code komt er niet in ----------------------------------- */
{
  const env = env0();
  check('korte code geweigerd', (await call(env, 'GET', '/api/plan', { code: 'kort' })).status, 401);
  check('geen code geweigerd', (await call(env, 'GET', '/api/plan', { code: null })).status, 401);
}

/* --- onbekende code: geen lege groep, maar een duidelijk signaal --------- */
{
  const env = env0();
  const r = await call(env, 'GET', '/api/plan');
  check('onbekende code geeft 404', r.status, 404);
  check('onbekende code is als zodanig herkenbaar', r.body.unknown, true);
}

/* --- groep aanmaken en gebruiken ----------------------------------------- */
{
  const env = env0();
  const made = await call(env, 'POST', '/api/group', { body: { people: [{ name: 'Ann' }, { name: 'Bo' }] } });
  check('groep aangemaakt', made.status, 201);
  check('twee namen', made.body.people.map(p => p.name), ['Ann', 'Bo']);
  check('ieder een eigen kleur', new Set(made.body.people.map(p => p.color)).size, 2);

  const again = await call(env, 'POST', '/api/group', { body: { people: [{ name: 'Cis' }] } });
  check('tweede keer aanmaken geweigerd', again.status, 409);

  const ann = made.body.people[0].id;
  check('lijstje wegschrijven',
    (await call(env, 'PUT', '/api/plan/' + ann, { body: { ids: ['vr|Grasland|Fenster|15:00'] } })).status, 200);

  const got = await call(env, 'GET', '/api/plan');
  check('lijstje komt terug', got.body.plans[ann], ['vr|Grasland|Fenster|15:00']);
  check('de ander is leeg', got.body.plans[made.body.people[1].id], []);
}

/* --- een andere code is een andere groep --------------------------------- */
{
  const env = env0();
  await call(env, 'POST', '/api/group', { body: { people: [{ name: 'Ann' }] } });
  const other = await call(env, 'GET', '/api/plan', { code: 'andere-vriendengroep' });
  check('andere code ziet de eerste groep niet', other.status, 404);

  await call(env, 'POST', '/api/group', { code: 'andere-vriendengroep', body: { people: [{ name: 'Zed' }] } });
  const a = await call(env, 'GET', '/api/plan');
  const b = await call(env, 'GET', '/api/plan', { code: 'andere-vriendengroep' });
  check('groep een houdt eigen namen', a.body.people.map(p => p.name), ['Ann']);
  check('groep twee houdt eigen namen', b.body.people.map(p => p.name), ['Zed']);
}

/* --- de code staat nergens in de opslag ---------------------------------- */
{
  const env = env0();
  await call(env, 'POST', '/api/group', { body: { people: [{ name: 'Ann' }] } });
  const dump = [...env.PLANNER.map.entries()].map(([k, v]) => k + ' ' + v).join('\n');
  check('code niet terug te vinden in KV', dump.includes(CODE), false);
  check('groeps-id is een hash, niet de code', /^groep:[0-9a-f]{64}$/.test([...env.PLANNER.map.keys()][0]), true);
}

/* --- namen wijzigen ------------------------------------------------------ */
{
  const env = env0();
  const made = await call(env, 'POST', '/api/group', { body: { people: [{ name: 'Ann' }, { name: 'Bo' }] } });
  const [ann, bo] = made.body.people;
  await call(env, 'PUT', '/api/plan/' + ann.id, { body: { ids: ['x|y|z|1'] } });
  await call(env, 'PUT', '/api/plan/' + bo.id, { body: { ids: ['p|q|r|2'] } });

  // hernoemen met behoud van id: de planning blijft hangen
  const renamed = await call(env, 'PUT', '/api/group', {
    body: { people: [{ id: ann.id, name: 'Anna' }, { id: bo.id, name: 'Bo' }] } });
  check('hernoemen lukt', renamed.body.people.map(p => p.name), ['Anna', 'Bo']);
  check('hernoemen behoudt de planning', renamed.body.plans[ann.id], ['x|y|z|1']);

  // iemand toevoegen
  const added = await call(env, 'PUT', '/api/group', {
    body: { people: [{ id: ann.id, name: 'Anna' }, { id: bo.id, name: 'Bo' }, { name: 'Cis' }] } });
  check('toevoegen lukt', added.body.people.length, 3);
  check('nieuwe krijgt een eigen id', added.body.people[2].id !== ann.id, true);

  // iemand verwijderen: die planning hoort ook weg te zijn
  const removed = await call(env, 'PUT', '/api/group', {
    body: { people: [{ id: ann.id, name: 'Anna' }] } });
  check('verwijderen lukt', removed.body.people.map(p => p.name), ['Anna']);
  check('planning van de verwijderde is opgeruimd',
    await env.PLANNER.get('plan:' + [...env.PLANNER.map.keys()][0].slice(6) + ':' + bo.id), null);
  check('planning van wie blijft is intact', removed.body.plans[ann.id], ['x|y|z|1']);
}

/* --- rommel wordt geweigerd ---------------------------------------------- */
{
  const env = env0();
  await call(env, 'POST', '/api/group', { body: { people: [{ name: 'Ann' }] } });
  const bad = [
    ['lege namenlijst', { people: [] }],
    ['naamloos', { people: [{ name: '   ' }] }],
    ['te veel namen', { people: Array.from({ length: 25 }, (_, i) => ({ name: 'P' + i })) }],
    ['te lange naam', { people: [{ name: 'x'.repeat(41) }] }],
  ];
  for (const [naam, body] of bad) {
    check('geweigerd: ' + naam, (await call(env, 'PUT', '/api/group', { body })).status, 400);
  }
  const vierentwintig = { people: Array.from({ length: 24 }, (_, i) => ({ name: 'P' + i })) };
  const groot = await call(env, 'PUT', '/api/group', { body: vierentwintig });
  check('vierentwintig namen mag wel', groot.status, 200);
  check('en die krijgen allemaal een eigen id',
    new Set(groot.body.people.map(p => p.id)).size, 24);
  const pid = (await call(env, 'GET', '/api/plan')).body.people[0].id;
  check('geweigerd: ids die geen tekst zijn',
    (await call(env, 'PUT', '/api/plan/' + pid, { body: { ids: [1, 2] } })).status, 400);
  check('geweigerd: onbekende persoon',
    (await call(env, 'PUT', '/api/plan/bestaatniet', { body: { ids: [] } })).status, 404);
}

/* --- overname van de eenkoppige opzet met PLANNER_KEY -------------------- */
{
  const env = {
    PLANNER: makeKV({
      'plan:matthijs': JSON.stringify({ ids: ['do|Bospodium|Gracetalent|19:00'], rev: 5 }),
      'plan:bart': JSON.stringify({ ids: ['vr|Grasland|Fenster|15:00'], rev: 7 }),
    }),
    GROUP_SALT: 'testzout',
    PLANNER_KEY: 'oude-gedeelde-code',
  };
  const r = await call(env, 'GET', '/api/plan', { code: 'oude-gedeelde-code' });
  check('oude code krijgt gewoon een groep', r.status, 200);
  check('de vier namen staan er', r.body.people.map(p => p.name),
    ['Matthijs', 'Ruben', 'Bart', 'Lisanne']);
  check('bestaande planning is meeverhuisd',
    r.body.plans.matthijs, ['do|Bospodium|Gracetalent|19:00']);
  check('en die van de ander ook', r.body.plans.bart, ['vr|Grasland|Fenster|15:00']);
  check('wie niets had begint leeg', r.body.plans.ruben, []);

  // tweede keer mag niet opnieuw overnemen en zo wijzigingen terugdraaien
  const pid = 'matthijs';
  await call(env, 'PUT', '/api/plan/' + pid, { code: 'oude-gedeelde-code', body: { ids: [] } });
  const again = await call(env, 'GET', '/api/plan', { code: 'oude-gedeelde-code' });
  check('overname gebeurt maar één keer', again.body.plans.matthijs, []);

  const vreemd = await call(env, 'GET', '/api/plan', { code: 'niet-de-oude-code' });
  check('een andere code erft niets', vreemd.status, 404);
}

console.log(`${pass} geslaagd, ${fail.length} gefaald`);
fail.forEach(f => console.log('\nGEFAALD: ' + f));
process.exit(fail.length ? 1 : 0);
