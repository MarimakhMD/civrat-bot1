"use strict";

// ─────────────────────────────────────────────────────────────────────────
// 4G — tests de sécurité du module Tickets.
//
// Six familles, correspondant aux contrôles identifiés par l'audit 4G :
//   1. cross-guilde sur les SIX méthodes qui résolvent un ticket par salon ;
//   2. claimTicket avec un guildId erroné (garde qui n'était pas testée) ;
//   3. findByChannel scopé par guild_id dans la REQUÊTE (4G C2) ;
//   4. identifiants panel / configuration invalides (4G C3 + C4) ;
//   5. permissions fail-closed ;
//   6. contrat d'utilisation du client privilégié (4G C1).
//
// Chaque test de refus vérifie aussi l'ABSENCE d'effet de bord : un refus qui
// aurait déjà appelé Discord ou écrit en base ne protège rien.
// ─────────────────────────────────────────────────────────────────────────

const test = require("node:test");
const assert = require("node:assert/strict");

const { TicketService } = require("../services/TicketService");
const { SupabaseTicketRepository } = require("../persistence/SupabaseTicketRepository");
const { InMemoryTicketPanelRepository } = require("../persistence/TicketPanelRepository");
const { submitPanelEdit } = require("../interactions/ticketPanelRoutes");
const { selectTicket } = require("../interactions/configureTickets");
const { TicketComponentId: Id } = require("../configuration/ticketConstants");
const { PermissionService } = require("../../../core/permissions/PermissionService");
const { PermissionName } = require("../../../core/permissions/permissionNames");
const { createDiscordMemberCapability } = require("../../../adapters/discord/DiscordMemberCapability");
const { DiscordPermission } = require("../../../adapters/discord/discordPermissionMap");
const { createDatabaseRuntime } = require("../../../config/database");

const CAT = "111111111111111111";
const ROLE = "222222222222222222";

/**
 * Fixture qui enregistre CHAQUE appel au transport et CHAQUE écriture.
 * Un refus doit laisser `calls` vide.
 */
function makeFixture({ ticket = null, support = true } = {}) {
  const calls = [];
  const writes = [];
  const repository = {
    findByChannel: async () => ticket,
    findOpen: async () => null,
    create: async (r) => { writes.push(["create", r]); return r; },
    updateByChannel: async (guildId, channelId, updates) => { writes.push(["update", guildId, channelId, updates]); return updates; },
  };
  const transport = {
    isMemberInRole: async () => { calls.push("isMemberInRole"); return support; },
    getCategory: async () => { calls.push("getCategory"); return { id: CAT, type: 4 }; },
    getSupportRole: async () => { calls.push("getSupportRole"); return { id: ROLE }; },
    getMember: async (id) => { calls.push("getMember"); return { id }; },
    getBotMember: async () => { calls.push("getBotMember"); return { id: "bot" }; },
    closeTicketChannel: async () => { calls.push("closeTicketChannel"); return { closed: true }; },
    reopenTicketChannel: async () => { calls.push("reopenTicketChannel"); return { reopened: true }; },
    deleteTicketChannel: async () => { calls.push("deleteTicketChannel"); return { deleted: true }; },
    renameTicketChannel: async () => { calls.push("renameTicketChannel"); return { renamed: true }; },
    claimTicketChannel: async () => { calls.push("claimTicketChannel"); return { claimed: true }; },
    getGuildMember: async (id) => { calls.push("getGuildMember"); return { id }; },
    addTicketMemberAccess: async () => { calls.push("addTicketMemberAccess"); return { changed: true }; },
    removeTicketMemberAccess: async () => { calls.push("removeTicketMemberAccess"); return { changed: true }; },
    // Nécessaires au contraste positif de createTicket.
    createTicketChannel: async ({ name }) => { calls.push("createTicketChannel"); return { id: "chan-new", name }; },
    applyTicketOverwrites: async () => { calls.push("applyTicketOverwrites"); return { applied: true }; },
    sendTicketWelcome: async () => { calls.push("sendTicketWelcome"); return {}; },
  };
  const service = new TicketService({
    repository,
    transport,
    configService: { read: async () => ({ tickets_enabled: true, ticket_category_id: CAT, ticket_support_role_id: ROLE }) },
    counterRepository: { next: async () => 1 },
    channelNamingService: { build: () => "ticket-001" },
  });
  return { service, calls, writes };
}

const foreignTicket = { guild_id: "GUILDE-B", user_id: "creator", channel_id: "chan-1", status: "open", closed: false };

// ─────────────────────────────────────────────────────────────────────────
// 1 + 2 · Cross-guilde sur les six méthodes.
//
// Le scénario : le salon appartient à la guilde A, mais la ligne résolue
// porte le guild_id de la guilde B. Les six méthodes doivent refuser avec
// TICKET_GUILD_MISMATCH sans AUCUN effet de bord.
// ─────────────────────────────────────────────────────────────────────────

const SIX_METHODS = [
  ["closeTicket", (s, i) => s.closeTicket(i), "closeTicketChannel"],
  ["reopenTicket", (s, i) => s.reopenTicket(i), "reopenTicketChannel"],
  ["deleteTicket", (s, i) => s.deleteTicket(i), "deleteTicketChannel"],
  ["renameTicket", (s, i) => s.renameTicket({ ...i, name: "ticket-002" }), "renameTicketChannel"],
  ["updateMemberAccess", (s, i) => s.updateMemberAccess({ ...i, targetMemberId: "somebody", action: "add" }), "getGuildMember"],
  ["claimTicket", (s, i) => s.claimTicket(i), "claimTicketChannel"],
];

for (const [method, invoke, sideEffect] of SIX_METHODS) {
  test(`4G security: ${method} refuses a ticket from another guild, with no side effect`, async () => {
    const { service, calls, writes } = makeFixture({ ticket: foreignTicket });
    const input = { guildId: "GUILDE-A", channelId: "chan-1", member: { id: "staff" } };

    const result = await invoke(service, input);

    assert.equal(result.code, "TICKET_GUILD_MISMATCH", method + " : refus cross-guilde");
    assert.equal(calls.includes(sideEffect), false, method + " : aucun appel Discord " + sideEffect);
    assert.equal(writes.length, 0, method + " : aucune écriture en base");
  });
}

// Le contrôle positif : le même appel sur un ticket de la BONNE guilde passe.
// Sans ce contraste, les six tests ci-dessus pourraient être vacuous.
test("4G security: the same calls succeed on a ticket of the right guild", async () => {
  const own = { ...foreignTicket, guild_id: "GUILDE-A" };
  const { service, calls } = makeFixture({ ticket: own });
  const input = { guildId: "GUILDE-A", channelId: "chan-1", member: { id: "staff" } };

  assert.equal((await service.claimTicket(input)).code, "TICKET_CLAIMED");
  assert.ok(calls.includes("claimTicketChannel"), "le transport est bien appelé quand la guilde correspond");
});

// 2 (explicite) · claimTicket exige en plus le rôle support.
test("4G security: claimTicket requires the support role even in the right guild", async () => {
  const own = { ...foreignTicket, guild_id: "GUILDE-A" };
  const { service, calls, writes } = makeFixture({ ticket: own, support: false });
  const result = await service.claimTicket({ guildId: "GUILDE-A", channelId: "chan-1", member: { id: "random" } });
  assert.equal(result.code, "TICKET_UNAUTHORIZED");
  assert.equal(calls.includes("claimTicketChannel"), false);
  assert.equal(writes.length, 0);
});

// ─────────────────────────────────────────────────────────────────────────
// 3 · findByChannel scopé par guild_id dans la requête elle-même.
// ─────────────────────────────────────────────────────────────────────────

test("4G security: findByChannel puts guild_id in the query, not only in the caller", async () => {
  const filters = [];
  const repository = new SupabaseTicketRepository({ supabase: { from: () => ({
    select: () => {
      const chain = {
        eq: (field, value) => { filters.push([field, value]); return chain; },
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return chain;
    },
  }) } });

  await repository.findByChannel("GUILDE-A", "chan-1");

  assert.deepEqual(filters, [["guild_id", "GUILDE-A"], ["channel_id", "chan-1"]],
    "le filtre guild_id doit précéder channel_id dans la requête");
});

test("4G security: TicketService forwards guildId to findByChannel on every path", async () => {
  const seen = [];
  const repository = {
    findByChannel: async (guildId, channelId) => { seen.push([guildId, channelId]); return null; },
    updateByChannel: async () => ({}),
  };
  const service = new TicketService({
    repository,
    transport: { isMemberInRole: async () => true },
    configService: { read: async () => ({ ticket_support_role_id: ROLE }) },
  });
  const input = { guildId: "GUILDE-A", channelId: "chan-1", member: { id: "staff" } };

  await service.closeTicket(input);
  await service.reopenTicket(input);
  await service.deleteTicket(input);
  await service.renameTicket({ ...input, name: "ticket-002" });
  await service.updateMemberAccess({ ...input, targetMemberId: "x", action: "add" });
  await service.claimTicket(input);

  assert.equal(seen.length, 6, "les six méthodes passent par findByChannel");
  for (const [guildId, channelId] of seen) {
    assert.equal(guildId, "GUILDE-A", "guildId transmis");
    assert.equal(channelId, "chan-1", "channelId transmis");
  }
});

// ─────────────────────────────────────────────────────────────────────────
// 4 · Identifiants invalides (4G C3 + C4).
// ─────────────────────────────────────────────────────────────────────────

const FORGED = ["'; DROP TABLE tickets;--", "cat-1", "1234", "9".repeat(23), "<@&222222222222222222>", "null"];

test("4G security: a panel refuses a non-snowflake category or support role", async () => {
  for (const forged of FORGED) {
    const repo = new InMemoryTicketPanelRepository();
    const panel = await repo.create({ guildId: "g", channelId: "c", messageId: "m", categoryId: CAT, supportRoleId: ROLE, buttons: [{ label: "S" }] });

    assert.equal(await repo.updatePanel("g", panel.id, { categoryId: forged }), null, "categoryId refusé : " + JSON.stringify(forged));
    assert.equal(await repo.updatePanel("g", panel.id, { supportRoleId: forged }), null, "supportRoleId refusé : " + JSON.stringify(forged));

    const after = await repo.findActive("g", panel.id);
    assert.equal(after.categoryId, CAT, "aucune écriture partielle sur categoryId");
    assert.equal(after.supportRoleId, ROLE, "aucune écriture partielle sur supportRoleId");

    await assert.rejects(
      () => repo.create({ guildId: "g", channelId: "c2", messageId: "m2", categoryId: forged, supportRoleId: ROLE, buttons: [{ label: "S" }] }),
      TypeError,
      "create refuse categoryId : " + JSON.stringify(forged),
    );
  }
});

test("4G security: submitPanelEdit rejects a forged identifier before any write", async () => {
  for (const forged of FORGED) {
    const repo = new InMemoryTicketPanelRepository();
    const panel = await repo.create({ guildId: "g", channelId: "c", messageId: "m", categoryId: CAT, supportRoleId: ROLE, buttons: [{ label: "S" }] });

    const replies = [];
    let redelivered = 0;
    const context = {
      guildId: "g",
      t: (k) => k,
      panelRepository: {
        findActive: async () => panel,
        listActive: async () => [],
        updatePanel: async () => { redelivered += 1; return panel; },
      },
      service: { read: async () => ({ tickets_enabled: true, ticket_category_id: CAT, ticket_support_role_id: ROLE }) },
      envelope: {
        customId: `${Id.PANELS_EDIT_SUBMIT_PREFIX}${panel.id}`,
        fields: { category_id: forged, support_role_id: ROLE, button_label: "S", button_emoji: "", buttons_extra: "" },
        transport: {
          reply: async (r) => replies.push(r),
          update: async () => {},
          editPanel: async () => {},
          sendPanel: async () => ({ id: "m" }),
        },
      },
    };

    await submitPanelEdit(context);
    assert.equal(replies.length, 1, "une seule réponse pour " + JSON.stringify(forged));
    assert.equal(replies[0].view.content, "tickets.TICKET_INVALID_DISCORD_ID");
    assert.equal(redelivered, 0, "aucune écriture en base pour " + JSON.stringify(forged));
  }
});

test("4G security: ticket configuration selectors refuse a forged identifier", async () => {
  for (const [customId, key] of [[Id.CATEGORY, "ticket_category_id"], [Id.SUPPORT_ROLE, "ticket_support_role_id"], [Id.LOG_CHANNEL, "ticket_log_channel_id"]]) {
    for (const forged of FORGED) {
      let config = { tickets_enabled: true };
      const replies = [];
      const context = {
        guildId: "g", t: (k) => k,
        service: { read: async () => config, update: async (_g, p) => (config = { ...config, ...p }) },
        envelope: {
          customId,
          values: [forged],
          transport: { update: async () => { throw new Error("aucune écriture attendue"); }, reply: async (r) => replies.push(r) },
        },
      };
      assert.equal(await selectTicket(context), null, key + " refuse " + JSON.stringify(forged));
      assert.equal(config[key], undefined, key + " : rien d'écrit pour " + JSON.stringify(forged));
      assert.equal(replies[0].view.content, "tickets.TICKET_INVALID_DISCORD_ID");
    }
  }
});

test("4G security: a panelId from another guild opens nothing", async () => {
  const repo = new InMemoryTicketPanelRepository();
  const panelA = await repo.create({ guildId: "GUILDE-A", channelId: "c", messageId: "m", categoryId: CAT, supportRoleId: ROLE, buttons: [{ label: "S" }] });

  const { service, calls, writes } = makeFixture({ ticket: null });
  const forged = await service.createTicket({
    guildId: "GUILDE-B", member: { id: "attacker" }, panelId: panelA.id, buttonIndex: 0, panelRepository: repo,
  });
  assert.equal(forged.code, "TICKET_PANEL_UNAVAILABLE");
  assert.equal(writes.length, 0);

  // Contraste : dans sa propre guilde, le même panel fonctionne.
  const own = makeFixture({ ticket: null });
  const ok = await own.service.createTicket({
    guildId: "GUILDE-A", member: { id: "member" }, panelId: panelA.id, buttonIndex: 0, panelRepository: repo,
  });
  assert.equal(ok.code, "TICKET_CREATED");
  assert.ok(own.calls.length > 0, "le transport est bien sollicité dans la bonne guilde");
  void calls;
});

// ─────────────────────────────────────────────────────────────────────────
// 5 · Permissions fail-closed.
// ─────────────────────────────────────────────────────────────────────────

test("4G security: permission evaluation is fail-closed", async () => {
  const permissions = new PermissionService();
  const requirement = { allOf: [PermissionName.MANAGE_GUILD] };

  // Membre absent => refus, pas d'exception.
  const noMember = await permissions.evaluate({ guildId: "g", userId: "u", member: null }, requirement);
  assert.equal(noMember.granted, false, "member null => refus");

  // Membre sans la capacité => refus.
  const denied = await permissions.evaluate({ guildId: "g", userId: "u", member: { has: () => false } }, requirement);
  assert.equal(denied.granted, false, "capacité absente => refus");

  // Membre avec un has() qui renvoie undefined => refus (Boolean(undefined)).
  const undefinedHas = await permissions.evaluate({ guildId: "g", userId: "u", member: { has: () => undefined } }, requirement);
  assert.equal(undefinedHas.granted, false, "has() indéfini => refus");

  // require() lève une AuthorizationError.
  await assert.rejects(() => permissions.require({ guildId: "g", userId: "u", member: null }, requirement));

  // Et accorde quand la capacité est présente.
  const granted = await permissions.evaluate({ guildId: "g", userId: "u", member: { has: () => true } }, requirement);
  assert.equal(granted.granted, true, "capacité présente => accord");
});

test("4G security: the Discord member capability reads real permissions and never throws", async () => {
  const withoutPermissions = createDiscordMemberCapability({ id: "u" }, "owner");
  assert.equal(withoutPermissions.has(PermissionName.MANAGE_GUILD), false, "member sans .permissions => false");

  // Les flags discord.js sont des bigint, pas des chaînes : on compare à la
  // valeur réelle du map, pas à un littéral inventé.
  const manageGuildFlag = DiscordPermission[PermissionName.MANAGE_GUILD];
  assert.equal(typeof manageGuildFlag, "bigint", "le flag est bien un bigint discord.js");

  const withPermissions = createDiscordMemberCapability(
    { id: "u", permissions: { has: (flag) => flag === manageGuildFlag }, roles: { cache: { has: () => true } } },
    "owner",
  );
  assert.equal(withPermissions.has(PermissionName.MANAGE_GUILD), true);
  assert.equal(withPermissions.hasRole("222222222222222222"), true);
  assert.equal(withPermissions.hasRole(null), false, "un roleId absent ne donne jamais accès");
  assert.equal(withPermissions.isGuildOwner, false, "u n'est pas le propriétaire");
  assert.equal(createDiscordMemberCapability({ id: "owner" }, "owner").isGuildOwner, true);

  // Un flag inconnu dans le map ne doit jamais accorder accès.
  const unknown = createDiscordMemberCapability({ id: "u", permissions: { has: () => false } }, "owner");
  assert.equal(unknown.has(PermissionName.MANAGE_GUILD), false);
});

// ─────────────────────────────────────────────────────────────────────────
// 6 · Contrat d'utilisation du client privilégié (4G C1).
//
// Ces tests verrouillent le fait documenté par le commentaire corrigé :
// dès que la clé de service est présente, `supabase` EST le client privilégié.
// Toute évolution de config/database qui casserait cette équivalence ferait
// échouer ces tests — et avec elle l'hypothèse de sécurité de TICKETS-RLS-A.
// ─────────────────────────────────────────────────────────────────────────

test("4G security: with a service role key, supabase IS the privileged client", () => {
  const fakeClient = (url, key) => ({ _url: url, _key: key, from: () => ({}) });
  const runtime = createDatabaseRuntime({
    url: "https://example.supabase.co", serviceRoleKey: "SERVICE_KEY", anonKey: "ANON_KEY", createClientImpl: fakeClient,
  });

  assert.equal(runtime.state.mode, "service_role");
  assert.equal(runtime.state.privileged, true);
  assert.equal(runtime.supabase, runtime.supabaseAdmin, "mêmes objet : `supabase` n'est PAS un client anon");
  assert.equal(runtime.supabase._key, "SERVICE_KEY", "la clé de service est bien celle utilisée");
});

test("4G security: without a service role key, there is no privileged client at all", () => {
  const fakeClient = (url, key) => ({ _url: url, _key: key, from: () => ({}) });
  const runtime = createDatabaseRuntime({ url: "https://example.supabase.co", anonKey: "ANON_KEY", createClientImpl: fakeClient });

  assert.equal(runtime.state.mode, "anon");
  assert.equal(runtime.state.privileged, false);
  assert.equal(runtime.supabaseAdmin, null, "aucun client privilégié : les panels basculent sur InMemory");
  assert.equal(runtime.supabase._key, "ANON_KEY");
});

test("4G security: an unconfigured database exposes no client", () => {
  const runtime = createDatabaseRuntime({ url: null, createClientImpl: () => ({}) });
  assert.equal(runtime.state.status, "NOT_CONFIGURED");
  assert.equal(runtime.supabase, null);
  assert.equal(runtime.supabaseAdmin, null);
});

// ───────────────────────────────────────────────────────────────
// 7 · 4G C2 — l'ÉCRITURE est scopée comme la lecture.
//
// findByChannel ne suffisait pas : updateByChannel filtrait encore sur le
// seul channel_id, alors que la requête UPDATE traverse les guildes. Les
// quatre appelants (close, reopen, delete, claim) vérifiaient bien
// `ticket.guild_id !== guildId` après lecture — ces gardes applicatives sont
// CONSERVÉES — mais elles étaient le seul rempart.
//
// Ces tests portent sur le dépôt RÉEL (SupabaseTicketRepository), pas sur un
// mock : c'est la requête émise qui fait foi. AUCUNE base réelle n'est
// contactée ; le faux client enregistre et applique les filtres en mémoire.
// ───────────────────────────────────────────────────────────────

/**
 * Faux client qui ENREGISTRE les filtres de l'UPDATE puis les applique à un
 * jeu de lignes en mémoire.
 *
 * `single()` sur zéro ligne renvoie une erreur (PGRST116) : c'est le
 * comportement documenté de PostgREST. Cette émulation est déclarée comme
 * telle — rien ici ne prouve le comportement d'une vraie base, seulement les
 * requêtes que le code émet.
 */
function makeUpdatingClient(rows) {
  const seen = [];
  const client = {
    from: () => ({
      update: (updates) => {
        const filters = [];
        const chain = {
          eq: (field, value) => { filters.push([field, value]); return chain; },
          select: () => ({
            single: async () => {
              seen.push({ filters, updates });
              const matched = rows.filter((row) => filters.every(([field, value]) => String(row[field]) === String(value)));
              if (matched.length !== 1) return { data: null, error: { code: "PGRST116", message: "no row matched" } };
              Object.assign(matched[0], updates);
              return { data: { ...matched[0] }, error: null };
            },
          }),
        };
        return chain;
      },
    }),
  };
  return { client, seen };
}

test("4G security: updateByChannel puts guild_id in the WHERE clause", async () => {
  const { client, seen } = makeUpdatingClient([
    { guild_id: "GUILDE-A", channel_id: "chan-1", status: "open", closed: false },
  ]);
  const repository = new SupabaseTicketRepository({ supabase: client });

  await repository.updateByChannel("GUILDE-A", "chan-1", { status: "closed", closed: true });

  assert.equal(seen.length, 1, "une seule requête UPDATE");
  assert.deepEqual(seen[0].filters, [["guild_id", "GUILDE-A"], ["channel_id", "chan-1"]],
    "guild_id ET channel_id filtrent la requête, dans cet ordre");
});

test("4G security: an UPDATE scoped to another guild modifies nothing", async () => {
  const rows = [{ guild_id: "GUILDE-B", user_id: "creator", channel_id: "chan-1", status: "open", closed: false }];
  const { client, seen } = makeUpdatingClient(rows);
  const repository = new SupabaseTicketRepository({ supabase: client });

  await assert.rejects(
    () => repository.updateByChannel("GUILDE-A", "chan-1", { status: "closed", closed: true }),
    (error) => {
      assert.equal(error.code, "PGRST116", "le dépôt remonte l'erreur, il ne l'avale pas");
      return true;
    },
  );

  assert.deepEqual(rows, [{ guild_id: "GUILDE-B", user_id: "creator", channel_id: "chan-1", status: "open", closed: false }],
    "la ligne de la guilde B est intacte");
  assert.equal(seen.length, 1, "la requête a été émise — c'est son filtre guild_id qui l'a neutralisée");
});

test("4G security: updateByChannel in the right guild behaves exactly as before", async () => {
  const rows = [{ guild_id: "GUILDE-A", user_id: "creator", channel_id: "chan-1", status: "open", closed: false }];
  const { client } = makeUpdatingClient(rows);
  const repository = new SupabaseTicketRepository({ supabase: client });

  const updated = await repository.updateByChannel("GUILDE-A", "chan-1", { status: "claimed" });

  assert.equal(updated.status, "claimed", "le retour porte la mise à jour");
  assert.equal(rows[0].status, "claimed", "la ligne est bien modifiée");
  // La projection C5 est inchangée : le retour reste exactement les cinq colonnes.
  assert.deepEqual(updated, { guild_id: "GUILDE-A", user_id: "creator", channel_id: "chan-1", status: "claimed", closed: false });
});

test("4G security: updateByChannel refuses to query without guildId and channelId", async () => {
  let queried = 0;
  const repository = new SupabaseTicketRepository({ supabase: { from: () => { queried += 1; throw new Error("should not be reached"); } } });

  await assert.rejects(() => repository.updateByChannel(null, "chan-1", { closed: true }), TypeError);
  await assert.rejects(() => repository.updateByChannel("GUILDE-A", null, { closed: true }), TypeError);
  await assert.rejects(() => repository.updateByChannel(undefined, undefined, { closed: true }), TypeError);

  assert.equal(queried, 0, "aucune requête émise : fail-closed");
});

test("4G security: TicketService forwards guildId on every write path", async () => {
  const input = { guildId: "GUILDE-A", channelId: "chan-1", member: { id: "staff" } };
  const cases = [
    ["closeTicket", { status: "open", closed: false }, "TICKET_CLOSED", (s) => s.closeTicket(input)],
    ["claimTicket", { status: "open", closed: false }, "TICKET_CLAIMED", (s) => s.claimTicket(input)],
    ["deleteTicket", { status: "open", closed: false }, "TICKET_DELETED", (s) => s.deleteTicket(input)],
    ["reopenTicket", { status: "closed", closed: true }, "TICKET_REOPENED", (s) => s.reopenTicket(input)],
  ];

  for (const [method, state, code, invoke] of cases) {
    const ticket = { guild_id: "GUILDE-A", user_id: "creator", channel_id: "chan-1", ...state };
    const { service, writes } = makeFixture({ ticket });
    const result = await invoke(service);

    assert.equal(result.code, code, method + " : le chemin aboutit");
    const updates = writes.filter((w) => w[0] === "update");
    assert.equal(updates.length, 1, method + " : exactement une écriture");
    assert.equal(updates[0][1], "GUILDE-A", method + " : guildId transmis au dépôt");
    assert.equal(updates[0][2], "chan-1", method + " : channelId transmis au dépôt");
  }
});
