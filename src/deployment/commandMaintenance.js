"use strict";

const { createHash } = require("node:crypto");
const snowflake = value => typeof value === "string" && /^\d{15,21}$/.test(value);
const failure = error => ({ status: error?.status ?? null, code: error?.code ?? null });
// Compare writable command schema, excluding Discord-generated metadata/defaults.
function schema(commands) {
  function normalize(value) {
    if (Array.isArray(value)) return value.map(normalize);
    if (!value || typeof value !== "object") return value;
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (["id", "application_id", "guild_id", "version", "name_localized", "description_localized"].includes(key)) continue;
      const v = value[key];
      if (v === null || v === undefined || (Array.isArray(v) && !v.length) || v === false) continue;
      if (key === "dm_permission" && v === true) continue;
      if (key === "default_permission" && v === true) continue;
      if (key === "nsfw" && v === false) continue;
      out[key] = normalize(v);
    }
    return out;
  }
  return JSON.stringify(commands.map(command => { const copy = { ...command }; if (copy.type === 1) delete copy.type; return normalize(copy); }).sort((a,b) => a.name.localeCompare(b.name)));
}

/** Only GET guild discovery and GET/PUT application-command collections. No other writes. */
async function maintainCommands({ rest, clientId, adminGuildId, action, targets, catalog, apply = false, confirm = null }) {
  if (!snowflake(clientId) || !snowflake(adminGuildId) || !["clear", "deploy", "list"].includes(action)) throw new Error("Invalid maintenance configuration");
  if (!targets || (!targets.global && !targets.allGuilds && !targets.guildIds?.length)) throw new Error("Explicit targets required");
  const ids = targets.guildIds || [];
  if (!Array.isArray(ids) || ids.some(id => !snowflake(id))) throw new Error("Invalid guild target");
  if (action === "deploy" && (!catalog || catalog.global.some(c => c.name === "admin") || catalog.technical.length !== 1 || catalog.technical[0].name !== "admin")) throw new Error("Invalid /admin scope");
  const result = { ok: false, action, applied: false, discovery: { ok: true }, scopes: [] };
  const guilds = new Set(ids);
  if (targets.allGuilds) {
    let after = "0";
    try {
      for (;;) {
        const page = await rest.get(`/users/@me/guilds?limit=200&after=${after}`);
        if (!Array.isArray(page) || page.some(g => !snowflake(g.id))) throw new Error("Invalid guild page");
        for (const g of page) guilds.add(g.id);
        if (page.length < 200) break;
        const next = page.reduce((max,g) => BigInt(g.id) > BigInt(max) ? g.id : max, after);
        if (BigInt(next) <= BigInt(after)) throw new Error("Pagination did not advance");
        after = next;
      }
    } catch (error) { result.discovery = { ok: false, ...failure(error) }; }
  }
  const routes = [];
  if (targets.global) routes.push({ scope: "global", route: `/applications/${clientId}/commands` });
  for (const guildId of [...guilds].sort()) routes.push({ scope: "guild", guildId, route: `/applications/${clientId}/guilds/${guildId}/commands` });
  for (const target of routes) {
    const body = action !== "deploy" ? [] : target.scope === "global" ? catalog.global : target.guildId === adminGuildId ? catalog.technical : [];
    const entry = { ...target, desired: body, ok: false };
    try {
      entry.before = await rest.get(target.route);
      if (!Array.isArray(entry.before)) throw new Error("Invalid command inventory");
      entry.ok = true;
    } catch (error) { entry.error = failure(error); }
    result.scopes.push(entry);
  }
  const ready = result.discovery.ok && result.scopes.every(s => s.ok);
  result.confirmation = createHash("sha256").update(JSON.stringify({ clientId, adminGuildId, action, scopes: result.scopes.map(s => ({ route:s.route, before:s.before, desired:s.desired })) })).digest("hex");
  result.ok = ready;
  if (!apply || action === "list") return result;
  if (!ready || confirm !== result.confirmation) return { ...result, ok: false, blocked: "Inventory incomplete or confirmation mismatch" };
  result.applied = true;
  for (const entry of result.scopes) {
    entry.ok = false;
    try {
      // Recheck immediately before writing: never overwrite a stale preview.
      const current = await rest.get(entry.route);
      if (!Array.isArray(current) || schema(current) !== schema(entry.before)) throw new Error("Inventory changed");
      await rest.put(entry.route, { body: entry.desired });
      entry.written = true;
      entry.after = await rest.get(entry.route);
      entry.ok = Array.isArray(entry.after) && schema(entry.after) === schema(entry.desired);
      if (!entry.ok) entry.error = { reason: "Read-back mismatch" };
    } catch (error) { entry.error = failure(error); }
  }
  result.ok = result.scopes.every(s => s.ok);
  return result;
}
module.exports = { maintainCommands, schema };
