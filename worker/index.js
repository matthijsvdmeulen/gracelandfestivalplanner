/**
 * Gedeelde opslag voor de Graceland-planner.
 *
 * Draait als Cloudflare Worker op gracelandplanner.meulen.dev/api/*, dus voor
 * GitHub Pages langs. Zelfde origin als de planner: geen CORS nodig in de
 * browser, en de planner hoeft geen tweede domein te kennen.
 *
 *   GET  /api/plan            -> { plans: {naam: [id, ...]}, revs: {naam: ms} }
 *   PUT  /api/plan/<naam>     -> { ids: [...] }  ->  { ok, person, rev }
 *   GET  /api/health          -> { ok }
 *
 * Elke persoon heeft zijn eigen KV-sleutel. Twee mensen die tegelijk hun eigen
 * lijstje bewerken kunnen elkaar dus niet overschrijven; alleen twee mensen die
 * tegelijk hetzelfde lijstje bewerken, en dan wint de laatste. Dat is voor vier
 * vrienden ruim genoeg, en het scheelt een revisie-onderhandeling.
 *
 * Wie erbij komt: voeg de naam hier toe en in PEOPLE in planner.html.
 */

const PEOPLE = ["bart", "lisanne", "matthijs", "ruben"];

// Ruim boven een vol weekend, maar niet ongelimiteerd: een kapotte client mag
// de namespace niet volschrijven.
const MAX_IDS = 400;
const MAX_ID_LEN = 300;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, PUT, OPTIONS",
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

/** Vergelijking zonder vroege uitstap, zodat de sleutel niet uit te proberen is. */
function sameSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authorised(request, env) {
  // Zonder ingestelde sleutel staat de planner open. Dat is een bewuste keuze
  // voor lokaal proberen; in productie hoort PLANNER_KEY gezet te zijn.
  if (!env.PLANNER_KEY) return true;
  return sameSecret(request.headers.get("x-planner-key") || "", env.PLANNER_KEY);
}

async function readPlan(env, person) {
  const raw = await env.PLANNER.get("plan:" + person);
  if (!raw) return { ids: [], rev: 0 };
  try {
    const v = JSON.parse(raw);
    return { ids: Array.isArray(v.ids) ? v.ids : [], rev: v.rev || 0 };
  } catch {
    return { ids: [], rev: 0 };
  }
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (path === "/api/health") {
      return json({ ok: true, people: PEOPLE });
    }
    if (!env.PLANNER) {
      return json({ error: "KV-binding PLANNER ontbreekt" }, 500);
    }
    if (!authorised(request, env)) {
      return json({ error: "onjuiste toegangscode" }, 401);
    }

    if (path === "/api/plan" && request.method === "GET") {
      const entries = await Promise.all(
        PEOPLE.map(async (p) => [p, await readPlan(env, p)]),
      );
      const plans = {};
      const revs = {};
      for (const [p, v] of entries) {
        plans[p] = v.ids;
        revs[p] = v.rev;
      }
      return json({ plans, revs, people: PEOPLE });
    }

    const m = path.match(/^\/api\/plan\/([a-z0-9_-]{1,32})$/);
    if (m && request.method === "PUT") {
      const person = m[1];
      if (!PEOPLE.includes(person)) {
        return json({ error: "onbekende naam: " + person }, 404);
      }
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "geen geldige JSON" }, 400);
      }
      const ids = cleanIds(body && body.ids);
      if (ids === null) {
        return json({ error: "ids moet een lijst van maximaal " + MAX_IDS + " teksten zijn" }, 400);
      }
      const rev = Date.now();
      await env.PLANNER.put("plan:" + person, JSON.stringify({ ids, rev }));
      return json({ ok: true, person, rev, count: ids.length });
    }

    return json({ error: "onbekend pad: " + path }, 404);
  },
};
