"use strict";

// ───────────────────────────────────────────────────────────────
// 4D — bornes de lecture : pagination, plafonds de limit/offset/range.
//
// PostgREST applique `db-max-rows` (1000 par défaut sur Supabase) et TRONQUE
// SILENCIEUSEMENT avec HTTP 200 : un `select()` sans `.range()` qui devrait
// renvoyer « toutes les lignes » s'arrête à 1000 sans aucune erreur, et un
// `.limit(10000)` côté client est ramené à 1000 par le serveur. Sans `.order()`,
// le tri retombe sur `ctid` et change après un VACUUM, ce qui ferait sauter ou
// dupliquer des lignes d'une page à l'autre.
//
// Ces tests portent sur le code RÉEL. Le faux client journalise les requêtes
// émises et rejoue des pages fournies. AUCUNE base réelle n'est contactée : ce
// qui est prouvé, ce sont les requêtes et leurs bornes, jamais la réaction
// d'une vraie base.
// ───────────────────────────────────────────────────────────────

const test = require("node:test");
const assert = require("node:assert/strict");

const { SupabaseEntitlementRepository } = require("../../src/adapters/supabase/SupabaseEntitlementRepository");
const { EntitlementService, EntitlementFeatureList, EntitlementFeature } = require("../../src/core/entitlements");
const { AdminPanelService } = require("../../src/modules/admin-panel/services/AdminPanelService");
const { SupabaseAdminAuditRepository } = require("../../src/modules/admin-panel/persistence/SupabaseAdminAuditRepository");
const { SupabasePremiumHistoryRepository } = require("../../src/modules/admin-panel/persistence/SupabasePremiumHistoryRepository");
const { SupabaseXPRepository } = require("../../src/modules/xp/persistence/SupabaseXPRepository");
const { SupabaseAnalyticsRepository } = require("../../src/modules/analytics/persistence/SupabaseAnalyticsRepository");
const { SupabaseCivratIdentityRepository } = require("../../src/modules/owner-panel/persistence/SupabaseCivratIdentityRepository");
const { SupabaseTicketPanelRepository } = require("../../src/modules/tickets/persistence/SupabaseTicketPanelRepository");
const { MAX_PANELS_PER_GUILD } = require("../../src/modules/tickets/configuration/ticketConstants");
const guildConfig = require("../../src/services/guildConfig");

/** Faux client PostgREST qui journalise la chaîne et rejoue `pages`. */
function makeFake({ pages = [], count = 0 } = {}) {
  const calls = [];
  let pageIndex = 0;
  const client = {
    from(table) {
      const state = {
        table, columns: null, head: false, count: null, op: "select", payload: null,
        filters: [], orders: [], limit: null, range: null, terminal: null,
      };
      const api = {
        select(columns, options) {
          state.columns = columns ?? "*";
          state.head = Boolean(options?.head);
          state.count = options?.count ?? null;
          return api;
        },
        insert(payload) { state.op = "insert"; state.payload = payload; return api; },
        update(payload) { state.op = "update"; state.payload = payload; return api; },
        delete() { state.op = "delete"; return api; },
        eq(column, value) { state.filters.push([column, value]); return api; },
        order(column, options) { state.orders.push({ column, ascending: options?.ascending !== false }); return api; },
        limit(value) { state.limit = value; return api; },
        range(from, to) { state.range = { from, to }; return api; },
        or() { return api; },
        in() { return api; },
        upsert() { state.op = "upsert"; return api; },
        single() { state.terminal = "single"; return api; },
        maybeSingle() { state.terminal = "maybeSingle"; return api; },
        then(resolve) {
          calls.push({
            table: state.table, columns: state.columns, head: state.head, count: state.count,
            op: state.op, filters: state.filters.map((f) => [...f]),
            orders: state.orders.map((o) => ({ ...o })), limit: state.limit,
            range: state.range ? { ...state.range } : null, terminal: state.terminal,
          });
          if (state.head) return Promise.resolve({ data: null, error: null, count }).then(resolve);
          const page = pages[pageIndex] || [];
          pageIndex += 1;
          return Promise.resolve({ data: page.map((r) => ({ ...r })), error: null }).then(resolve);
        },
      };
      return api;
    },
  };
  return { client, calls };
}

const fullPage = (tag) => Array.from({ length: 1000 }, (_, i) => ({ guild_id: `${tag}${i}`, feature_key: EntitlementFeature.TICKET_PREMIUM }));

// ═══════════════════════════════════════════════════════════════
// R1 — entitlements listAll : la seule lecture réellement non bornée
// ═══════════════════════════════════════════════════════════════

test("4D/R1: listAll pagine par .range() dans l'ordre de la clé primaire", async () => {
  const { client, calls } = makeFake({ pages: [fullPage("g"), [{ guild_id: "gX", feature_key: EntitlementFeature.WELCOME_IMAGE }]], count: 1001 });
  const repo = new SupabaseEntitlementRepository({ supabase: client });

  const result = await repo.listAll();

  assert.equal(result.rows.length, 1001, "les deux pages sont agrégées");
  assert.equal(result.totalRows, 1001, "le total exact vient du count");
  assert.equal(result.truncated, false);

  assert.equal(calls[0].head, true, "la première requête est un count en HEAD");
  assert.equal(calls[0].count, "exact", "count=exact, pas une estimation");
  assert.equal(calls[0].range, null, "le count ne transfère aucune ligne");

  assert.deepEqual(calls[1].range, { from: 0, to: 999 }, "page 1 bornée à 1000");
  assert.deepEqual(calls[2].range, { from: 1000, to: 1999 }, "page 2 bornée à 1000");
  assert.deepEqual(calls[1].orders, [
    { column: "guild_id", ascending: true },
    { column: "feature_key", ascending: true },
  ], "ordre déterministe = clé primaire, sinon la pagination est instable");
  assert.equal(calls.length, 3, "pas de page supplémentaire inutile");
});

test("4D/R1: listAll s'arrête au plafond de scan et le signale", async () => {
  const pages = Array.from({ length: 12 }, () => fullPage("g"));
  const { client, calls } = makeFake({ pages, count: 50000 });
  const repo = new SupabaseEntitlementRepository({ supabase: client });

  const result = await repo.listAll();

  assert.equal(result.rows.length, 10000, "le plafond borne la mémoire");
  assert.equal(result.truncated, true, "un dépassement est dit, pas masqué");
  assert.equal(result.totalRows, 50000, "le total exact reste disponible");
  assert.equal(calls.length, 11, "1 count + 10 pages, pas une de plus");
});

test("4D/R1: une table exactement au plafond n'est pas marquée tronquée à tort", async () => {
  const pages = Array.from({ length: 10 }, () => fullPage("g"));
  const { client } = makeFake({ pages, count: 10000 });
  const repo = new SupabaseEntitlementRepository({ supabase: client });

  const result = await repo.listAll();

  assert.equal(result.rows.length, 10000);
  assert.equal(result.truncated, false, "rows.length === totalRows ⇒ complet");
});

test("4D/R1: rows.length < totalRows suffit à signaler la troncature", async () => {
  // Le serveur tronque silencieusement : une seule page courte revient alors que
  // le count en annonce davantage. C'est exactement le piège db-max-rows.
  const { client } = makeFake({ pages: [fullPage("g")], count: 5000 });
  const repo = new SupabaseEntitlementRepository({ supabase: client });

  const result = await repo.listAll();

  assert.equal(result.rows.length, 1000);
  assert.equal(result.totalRows, 5000);
  assert.equal(result.truncated, true, "la troncature silencieuse du serveur est détectée");
});

test("4D/R1: listPremiumServers renvoie { servers, totalRows, truncated }", async () => {
  const rows = [
    { guild_id: "g1", feature_key: EntitlementFeature.TICKET_PREMIUM, status: "active", ends_at: null },
  ];
  const repository = {
    findFeature: async () => null,
    listFeatures: async () => [],
    listAll: async () => ({ rows, totalRows: 900, truncated: true }),
    activate: async () => {},
    setStatus: async () => {},
  };
  const service = new EntitlementService({ repository });

  const result = await service.listPremiumServers();

  assert.ok(Array.isArray(result.servers), "les serveurs restent une liste");
  assert.equal(result.totalRows, 900);
  assert.equal(result.truncated, true, "la troncature remonte au service");
  assert.ok(result.servers.length >= 1);
});

test("4D/R1: la troncature remonte jusqu'au dashboard Admin", async () => {
  const entitlementService = {
    listPremiumServers: async () => ({
      servers: [{ guildId: "g1", active: true, expired: false, status: "active", feature: "TICKET_PREMIUM" }],
      totalRows: 900,
      truncated: true,
    }),
  };
  const service = new AdminPanelService({ entitlementService });

  const stats = await service.getDashboardStats({});

  assert.equal(stats.premiumAvailable, true);
  assert.equal(stats.premiumTotal, 1);
  assert.equal(stats.premiumTruncated, true, "le dashboard sait que ses compteurs sont des planchers");
});

// ═══════════════════════════════════════════════════════════════
// R2 — getAllGuildConfigs : conservée, mais bornée
// ═══════════════════════════════════════════════════════════════

test("4D/R2: getAllGuildConfigs pagine avec un ordre déterministe", async () => {
  const { client, calls } = makeFake({ pages: [[{ guild_id: "a" }, { guild_id: "b" }]] });
  guildConfig._setDatabaseProvider(() => ({ supabaseAdmin: client }));
  try {
    const configs = await guildConfig.getAllGuildConfigs();

    assert.deepEqual(configs.map((c) => c.guild_id), ["a", "b"], "la fonction et son contrat sont conservés");
    assert.equal(calls.length, 1, "une page courte suffit");
    assert.deepEqual(calls[0].orders, [{ column: "guild_id", ascending: true }], "ordre sur la clé primaire");
    assert.deepEqual(calls[0].range, { from: 0, to: 999 }, "lecture bornée, plus de select() nu");
  } finally {
    guildConfig._setDatabaseProvider(null);
  }
});

test("4D/R2: getAllGuildConfigs continue tant que les pages sont pleines", async () => {
  const { client, calls } = makeFake({
    pages: [Array.from({ length: 1000 }, (_, i) => ({ guild_id: `a${i}` })), [{ guild_id: "z" }]],
  });
  guildConfig._setDatabaseProvider(() => ({ supabaseAdmin: client }));
  try {
    const configs = await guildConfig.getAllGuildConfigs();

    assert.equal(configs.length, 1001, "les deux pages sont agrégées");
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].range, { from: 1000, to: 1999 });
  } finally {
    guildConfig._setDatabaseProvider(null);
  }
});

// ═══════════════════════════════════════════════════════════════
// R3 / R4 / R5 — .limit() défensifs
// ═══════════════════════════════════════════════════════════════

test("4D/R3: readAdminIds borne sa lecture", async () => {
  const { client, calls } = makeFake({ pages: [[{ user_id: "u1" }]] });
  const repo = new SupabaseCivratIdentityRepository({ supabase: client });

  const ids = await repo.readAdminIds();

  assert.deepEqual(ids, ["u1"]);
  assert.equal(calls[0].limit, 100, "sous db-max-rows : la liste reste toujours complète");
  assert.deepEqual(calls[0].orders, [{ column: "user_id", ascending: true }], "ordre déterministe");
});

test("4D/R4: listActive borne la lecture à MAX_PANELS_PER_GUILD", async () => {
  const { client, calls } = makeFake({ pages: [[]] });
  const repo = new SupabaseTicketPanelRepository({ supabase: client });

  await repo.listActive("g1");

  assert.equal(calls[0].limit, MAX_PANELS_PER_GUILD, "la borne métier est reprise dans la requête");
});

test("4D/R5: listFeatures borne la lecture au nombre de features connues", async () => {
  const { client, calls } = makeFake({ pages: [[]] });
  const repo = new SupabaseEntitlementRepository({ supabase: client });

  await repo.listFeatures("g1");

  assert.equal(calls[0].limit, EntitlementFeatureList.length);
  assert.deepEqual(calls[0].filters, [["guild_id", "g1"]]);
});

// ═══════════════════════════════════════════════════════════════
// R6 / R7 — plafonds sur .limit() contrôlable
// ═══════════════════════════════════════════════════════════════

test("4D/R6: getLeaderboard XP plafonne le limit demandé", async () => {
  const { client, calls } = makeFake({ pages: [[]] });
  const repo = new SupabaseXPRepository({ supabase: client });

  await repo.getLeaderboard("g1", 100000);
  assert.equal(calls[0].limit, 100, "plafond aligné sur le dépôt invitations (B2)");

  await repo.getLeaderboard("g1", 5);
  assert.equal(calls[1].limit, 5, "une valeur raisonnable passe telle quelle");

  await repo.getLeaderboard("g1");
  assert.equal(calls[2].limit, 10, "défaut conservé");

  await repo.getLeaderboard("g1", 0);
  assert.equal(calls[3].limit, 10, "une valeur invalide retombe sur le défaut");
});

test("4D/R7: getEvents Analytics plafonne le limit demandé", async () => {
  const { client, calls } = makeFake({ pages: [[]] });
  const repo = new SupabaseAnalyticsRepository({ supabase: client });

  await repo.getEvents("g1", null, 100000);
  assert.equal(calls[0].limit, 500, "sous db-max-rows (1000) : aucune troncature silencieuse");

  await repo.getEvents("g1", null, 3);
  assert.equal(calls[1].limit, 3, "P10/T11 : une valeur raisonnable est inchangée");

  await repo.getEvents("g1");
  assert.equal(calls[2].limit, 100, "défaut conservé");
});

// ═══════════════════════════════════════════════════════════════
// R8 / R9 — plafonds sur limit ET offset des dépôts Admin
// ═══════════════════════════════════════════════════════════════

test("4D/R8: l'audit Admin plafonne limit et offset", async () => {
  const { client, calls } = makeFake({ pages: [[]] });
  const repo = new SupabaseAdminAuditRepository({ supabase: client });

  await repo.list({ limit: 100000, offset: 999999999 });
  assert.deepEqual(calls[0].range, { from: 100000, to: 100199 }, "limit ≤ 200 et offset ≤ 100000");

  await repo.list({ limit: 5, offset: 10 });
  assert.deepEqual(calls[1].range, { from: 10, to: 14 }, "valeurs raisonnables inchangées");

  await repo.list({ limit: -3, offset: -7 });
  assert.deepEqual(calls[2].range, { from: 0, to: 19 }, "valeurs invalides → défauts");
});

test("4D/R9: l'historique Premium plafonne limit et offset", async () => {
  const { client, calls } = makeFake({ pages: [[]] });
  const repo = new SupabasePremiumHistoryRepository({ supabase: client });

  await repo.listByGuild("g1", { limit: 100000, offset: 999999999 });
  assert.deepEqual(calls[0].range, { from: 100000, to: 100199 });

  await repo.listRecent({ limit: 100000 });
  assert.equal(calls[1].limit, 200, "listRecent clampé lui aussi");

  await repo.listRecent({ limit: 10 });
  assert.equal(calls[2].limit, 10);
});

test("4D/R8: le service Admin clampe avant d'atteindre le dépôt", async () => {
  const seen = [];
  const auditRepository = {
    list: async (options) => { seen.push(["list", options.limit, options.offset]); return []; },
    count: async () => 0,
  };
  const service = new AdminPanelService({
    entitlementService: { listPremiumServers: async () => ({ servers: [], totalRows: 0, truncated: false }) },
    auditRepository,
  });

  await service.listAudit({ page: 999999999, pageSize: 100000 });
  assert.equal(seen[0][1], 100, "pageSize plafonné côté service");
  assert.equal(seen[0][2], 100 * 100000, "offset dérivé d'une page elle-même plafonnée");

  await service.listAudit({ page: -5, pageSize: 0 });
  assert.equal(seen[1][1], 5, "pageSize invalide → PAGE_SIZE du panneau");
  assert.equal(seen[1][2], 0, "page négative → 0");
});

// ═══════════════════════════════════════════════════════════════
// Non-régression : ce qui était déjà sécurisé le reste
// ═══════════════════════════════════════════════════════════════

test("4D: les bornes déjà posées par P10/M5/M8/B1/B2 sont intactes", async () => {
  const fs = require("node:fs");
  const read = (p) => fs.readFileSync(p, "utf8");

  const analytics = read(require.resolve("../../src/modules/analytics/persistence/SupabaseAnalyticsRepository"));
  assert.ok(analytics.includes('count: "exact", head: true'), "P10 — count en HEAD conservé");
  assert.ok(analytics.includes("ANALYTICS_DISTINCT_SCAN_CAP"), "P10 — plafond de scan conservé");

  const giveaways = read(require.resolve("../../src/modules/giveaways/persistence/SupabaseGiveawayRepository"));
  assert.ok(giveaways.includes("ENTRIES_SCAN_CAP"), "M5 — plafond des participations conservé");

  const warnings = read(require.resolve("../../src/modules/moderation/persistence/WarningRepository"));
  assert.ok(warnings.includes("MAX_LIST_LIMIT"), "B1 — plafond de listWarnings conservé");

  const invites = read(require.resolve("../../src/modules/invites/persistence/SupabaseInviteStatsRepository"));
  assert.ok(invites.includes("LEADERBOARD_MAX_LIMIT"), "B2 — plafond du classement conservé");
});
