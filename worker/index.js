/**
 * Gedeelde opslag voor de Graceland-planner.
 *
 * Draait als Cloudflare Worker op gracelandplanner.meulen.dev/api/*, dus voor
 * GitHub Pages langs. Zelfde origin als de planner: geen CORS nodig in de
 * browser, en de planner hoeft geen tweede domein te kennen.
 *
 *   GET  /api/health                 -> { ok }
 *   GET  /api/plan                   -> { people, plans, revs }
 *                                       404 { unknown:true } als de code nog
 *                                       geen groep kent
 *   POST /api/group  { people }      -> groep aanmaken voor deze code
 *   PUT  /api/group  { people }      -> namen wijzigen
 *   PUT  /api/plan/<id> { ids }      -> het lijstje van één persoon
 *
 * Het wachtwoord is de groep. De code zelf komt nooit in de opslag: we leiden
 * er met HMAC-SHA256 en een geheime sleutel een groeps-id uit af. Wie de
 * KV-inhoud in handen krijgt kan daar zonder die sleutel niets mee, en welke
 * codes bestaan is er niet uit af te lezen.
 *
 * Iedereen schrijft alleen zijn eigen lijstje weg, dus twee mensen die tegelijk
 * plannen kunnen elkaar niet overschrijven; alleen twee mensen die tegelijk
 * hetzelfde lijstje bewerken, en dan wint de laatste.
 */

const MAX_IDS = 400;        // ruim boven een vol weekend
const MAX_ID_LEN = 300;
const MAX_PEOPLE = 10;      // meer kolommen worden onleesbaar in "Samen"
const MAX_NAME = 40;
const MIN_CODE = 6;

/* Kleuren in dezelfde tint als de planner. Op volgorde toegekend. */
const COLORS = ["#2F5D8C", "#7A4E8C", "#A9691A", "#B23A48",
                "#3E6B33", "#0F7A6E", "#8C5A2F", "#5A5A52"];

/* De vier van het eerste uur. Gebruikte de planner nog één gedeelde
   PLANNER_KEY, dan verhuist hun planning bij de eerste aanmelding mee. */
const LEGACY = ["matthijs", "ruben", "bart", "lisanne"];
const LEGACY_NAME = { matthijs:"Matthijs", ruben:"Ruben", bart:"Bart", lisanne:"Lisanne" };

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
  "access-control-allow-headers": "content-type, x-planner-key",
  "access-control-max-age": "86400",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...CORS,
    },
  });

/** Vergelijking zonder vroege uitstap, zodat de code niet uit te proberen is. */
function sameSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Groeps-id uit de code. HMAC en niet een kale hash: zonder de geheime sleutel
 * is er geen id te berekenen, ook niet met een woordenlijst en de KV-inhoud
 * ernaast.
 */
async function groupIdFor(code, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(salt), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(code));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}

const groupKey = gid => "groep:" + gid;
const planKey = (gid, pid) => "plan:" + gid + ":" + pid;

const newId = () => [...crypto.getRandomValues(new Uint8Array(5))]
  .map(b => b.toString(16).padStart(2, "0")).join("");

async function readGroup(env, gid) {
  const raw = await env.PLANNER.get(groupKey(gid));
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v.people) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Eenmalige overname van de opzet met één gedeelde PLANNER_KEY: de vier namen
 * en hun bestaande lijstjes worden een gewone groep. De persoons-id's blijven
 * gelijk, zodat de opslag in de browser blijft kloppen.
 */
async function adoptLegacy(env, gid, code) {
  if (!env.PLANNER_KEY || !sameSecret(code, env.PLANNER_KEY)) return null;
  const people = LEGACY.map((id, i) => ({
    id, name: LEGACY_NAME[id], color: COLORS[i % COLORS.length],
  }));
  for (const id of LEGACY) {
    const old = await env.PLANNER.get("plan:" + id);
    if (old) await env.PLANNER.put(planKey(gid, id), old);
  }
  const group = { people, updated: Date.now(), from: "legacy" };
  await env.PLANNER.put(groupKey(gid), JSON.stringify(group));
  return group;
}

/** Namen opschonen. Bestaande id's blijven, nieuwe krijgen er een. */
function cleanPeople(input, previous) {
  if (!Array.isArray(input) || !input.length || input.length > MAX_PEOPLE) return null;
  const known = new Set((previous || []).map(p => p.id));
  const out = [];
  const used = new Set();
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return null;
    const name = String(raw.name == null ? "" : raw.name).trim();
    if (!name || name.length > MAX_NAME) return null;
    let id = typeof raw.id === "string" && known.has(raw.id) ? raw.id : newId();
    while (used.has(id)) id = newId();
    used.add(id);
    out.push({ id, name, color: COLORS[out.length % COLORS.length] });
  }
  return out;
}

/** Dubbelen eruit, lengtes begrensd, alleen strings. */
function cleanIds(input) {
  if (!Array.isArray(input)) return null;
  const out = [];
  const seen = new Set();
  for (const raw of input) {
    if (typeof raw !== "string") return null;
    const id = raw.trim();
    if (!id || id.length > MAX_ID_LEN || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length > MAX_IDS) return null;
  }
  return out;
}

async function readPlans(env, gid, people) {
  const entries = await Promise.all(people.map(async p => {
    const raw = await env.PLANNER.get(planKey(gid, p.id));
    if (!raw) return [p.id, { ids: [], rev: 0 }];
    try {
      const v = JSON.parse(raw);
      return [p.id, { ids: Array.isArray(v.ids) ? v.ids : [], rev: v.rev || 0 }];
    } catch {
      return [p.id, { ids: [], rev: 0 }];
    }
  }));
  const plans = {}, revs = {};
  for (const [id, v] of entries) { plans[id] = v.ids; revs[id] = v.rev; }
  return { plans, revs };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (path === "/api/health") {
      // Bewust zonder namen: die horen achter de code te blijven.
      return json({ ok: true, saltSet: !!env.GROUP_SALT });
    }
    if (!env.PLANNER) {
      return json({ error: "KV-binding PLANNER ontbreekt" }, 500);
    }

    const code = (request.headers.get("x-planner-key") || "").trim();
    if (code.length < MIN_CODE) {
      return json({ error: "toegangscode van minstens " + MIN_CODE + " tekens nodig" }, 401);
    }
    const gid = await groupIdFor(code, env.GROUP_SALT || "graceland-2026-standaardzout");
    const group = await readGroup(env, gid) || await adoptLegacy(env, gid, code);

    if (path === "/api/plan" && request.method === "GET") {
      if (!group) {
        // Geen fout, maar een nog onbekende code. De planner vraagt dan of er
        // een nieuwe groep gemaakt moet worden, in plaats van stilzwijgend een
        // lege groep te tonen alsof alle planning weg is.
        return json({ unknown: true, error: "deze code kent nog geen groep" }, 404);
      }
      const { plans, revs } = await readPlans(env, gid, group.people);
      return json({ people: group.people, plans, revs });
    }

    if (path === "/api/group" && request.method === "POST") {
      if (group) return json({ error: "deze code heeft al een groep" }, 409);
      let body;
      try { body = await request.json(); } catch { return json({ error: "geen geldige JSON" }, 400); }
      const people = cleanPeople(body && body.people, []);
      if (!people) {
        return json({ error: "geef 1 tot " + MAX_PEOPLE + " namen van hoogstens " + MAX_NAME + " tekens" }, 400);
      }
      await env.PLANNER.put(groupKey(gid), JSON.stringify({ people, updated: Date.now() }));
      return json({ people, plans: {}, revs: {} }, 201);
    }

    if (path === "/api/group" && request.method === "PUT") {
      if (!group) return json({ unknown: true, error: "deze code kent nog geen groep" }, 404);
      let body;
      try { body = await request.json(); } catch { return json({ error: "geen geldige JSON" }, 400); }
      const people = cleanPeople(body && body.people, group.people);
      if (!people) {
        return json({ error: "geef 1 tot " + MAX_PEOPLE + " namen van hoogstens " + MAX_NAME + " tekens" }, 400);
      }
      // Wie eruit gaat, gaat met planning en al weg.
      const keep = new Set(people.map(p => p.id));
      for (const p of group.people) {
        if (!keep.has(p.id)) await env.PLANNER.delete(planKey(gid, p.id));
      }
      await env.PLANNER.put(groupKey(gid), JSON.stringify({ people, updated: Date.now() }));
      const { plans, revs } = await readPlans(env, gid, people);
      return json({ people, plans, revs });
    }

    const m = path.match(/^\/api\/plan\/([a-zA-Z0-9_-]{1,32})$/);
    if (m && request.method === "PUT") {
      if (!group) return json({ unknown: true, error: "deze code kent nog geen groep" }, 404);
      const person = m[1];
      if (!group.people.some(p => p.id === person)) {
        return json({ error: "onbekende naam in deze groep" }, 404);
      }
      let body;
      try { body = await request.json(); } catch { return json({ error: "geen geldige JSON" }, 400); }
      const ids = cleanIds(body && body.ids);
      if (ids === null) {
        return json({ error: "ids moet een lijst van maximaal " + MAX_IDS + " teksten zijn" }, 400);
      }
      const rev = Date.now();
      await env.PLANNER.put(planKey(gid, person), JSON.stringify({ ids, rev }));
      return json({ ok: true, person, rev, count: ids.length });
    }

    return json({ error: "onbekend pad: " + path }, 404);
  },
};
