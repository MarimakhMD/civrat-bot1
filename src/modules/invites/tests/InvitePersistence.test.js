"use strict";

// B2 — Persistance des invitations sur public.invite_links.
//
// Le faux client ci-dessous n'est PAS une maquette permissive : il conserve de
// vraies lignes, FAIT RESPECTER la PK (guild_id, invited_id), applique les
// `.eq()` / `.is()` et le `count=exact`, et exécute réellement le GROUP BY que
// la RPC invite_leaderboard ferait en base. Il ne concède aucun DELETE, comme
// la vraie RLS.
//
// Aucun de ces tests ne parle à une vraie base : il n'y a aucune variable
// d'environnement Supabase dans cet environnement. Ce qui est prouvé ici, ce
// sont les requêtes émises et la sémantique du contrat, pas ce que Postgres en
// ferait.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  InMemoryInviteStatsRepository,
  MongoInviteStatsRepository,
} = require("../persistence/InviteStatsRepository");
const {
  SupabaseInviteStatsRepository,
  InviteLinksUnavailableError,
  INVITE_LINKS_TABLE,
  LEADERBOARD_MAX_LIMIT,
} = require("../persistence/SupabaseInviteStatsRepository");
const { InviteService } = require("../services/InviteService");

/** Faux client PostgREST simulant public.invite_links + la RPC. */
function createFakeSupabase({ errors = {} } = {}) {
  const rows = new Map(); // "guild:invited" → ligne snake_case
  const calls = [];
  let nextId = 1;
  let injected = { ...errors };

  const keyOf = (guildId, invitedId) => `${guildId}:${invitedId}`;
  const takeError = (kind) => {
    const error = injected[kind];
    if (!error) return null;
    if (error === "once") delete injected[kind];
    return error;
  };

  function matches(row, filters) {
    return filters.every((filter) => {
      if (filter.type === "eq") return row[filter.column] === filter.value;
      if (filter.type === "is") return row[filter.column] === filter.value;
      throw new Error(`filtre non pris en charge : ${filter.type}`);
    });
  }

  function execute(state) {
    calls.push({ ...state, filters: state.filters.map((f) => ({ ...f })) });
    const kind = state.mode || "select";
    const forced = takeError(kind);
    if (forced) return Promise.resolve({ data: null, error: forced, count: null });

    if (state.mode === "upsert") {
      const key = keyOf(state.payload.guild_id, state.payload.invited_id);
      const existing = rows.get(key);
      // INSERT ... ON CONFLICT (guild_id, invited_id) DO UPDATE : seules les
      // colonnes transmises sont réécrites.
      const row = existing
        ? { ...existing, ...state.payload }
        : {
            guild_id: state.payload.guild_id,
            invited_id: state.payload.invited_id,
            inviter_id: state.payload.inviter_id,
            invite_code: state.payload.invite_code ?? null,
            created_at: new Date().toISOString(),
            revoked_at: state.payload.revoked_at ?? null,
          };
      rows.set(key, row);
      return Promise.resolve({ data: { ...row }, error: null, count: null });
    }

    if (state.mode === "update") {
      const updated = [];
      for (const [key, row] of rows.entries()) {
        if (matches(row, state.filters)) {
          const next = { ...row, ...state.payload };
          rows.set(key, next);
          updated.push({ ...next });
        }
      }
      return Promise.resolve({ data: updated, error: null, count: null });
    }

    const result = [...rows.values()].filter((row) => matches(row, state.filters));
    if (state.head) {
      return Promise.resolve({ data: null, error: null, count: result.length });
    }
    return Promise.resolve({ data: result.map((row) => ({ ...row })), error: null, count: null });
  }

  function from(table) {
    assert.equal(table, INVITE_LINKS_TABLE, "le dépôt doit viser public.invite_links");
    const state = {
      table, filters: [], mode: null, payload: null, selected: null, head: false, count: null, onConflict: null,
    };
    const api = {
      select(columns, options) {
        state.selected = columns;
        state.head = Boolean(options?.head);
        state.count = options?.count || null;
        return api;
      },
      eq(column, value) { state.filters.push({ type: "eq", column, value }); return api; },
      is(column, value) { state.filters.push({ type: "is", column, value }); return api; },
      upsert(payload, options) { state.mode = "upsert"; state.payload = payload; state.onConflict = options?.onConflict || null; return api; },
      update(payload) { state.mode = "update"; state.payload = payload; return api; },
      // La vraie RLS ne concède aucun DELETE à service_role.
      delete() { throw new Error("public.invite_links est sans DELETE : la révocation passe par revoked_at"); },
      insert() { throw new Error("le dépôt doit utiliser upsert (idempotent), pas insert"); },
      async single() {
        const { data, error } = await execute(state);
        if (error) return { data: null, error };
        return { data: Array.isArray(data) ? data[0] ?? null : data, error: null };
      },
      async maybeSingle() {
        const { data, error } = await execute(state);
        if (error) return { data: null, error };
        if (!Array.isArray(data) || data.length === 0) return { data: null, error: null };
        return { data: data[0], error: null };
      },
      then(resolve, reject) { return execute(state).then(resolve, reject); },
    };
    return api;
  }

  /** Reproduit la RPC invite_leaderboard, plafond SQL inclus. */
  function rpc(name, args) {
    calls.push({ rpc: name, args: { ...args } });
    assert.equal(name, "invite_leaderboard", "seule la RPC invite_leaderboard est concédée");
    const forced = takeError("rpc");
    if (forced) return Promise.resolve({ data: null, error: forced });
    const limit = Math.min(Math.max(args.p_limit ?? 10, 1), 100); // LEAST(GREATEST(p_limit,1),100)
    const totals = new Map();
    for (const row of rows.values()) {
      if (row.guild_id !== args.p_guild_id || row.revoked_at !== null) continue;
      totals.set(row.inviter_id, (totals.get(row.inviter_id) || 0) + 1);
    }
    const data = [...totals.entries()]
      .map(([user_id, invites]) => ({ user_id, invites }))
      .sort((a, b) => (b.invites - a.invites) || a.user_id.localeCompare(b.user_id))
      .slice(0, limit);
    return Promise.resolve({ data, error: null });
  }

  return {
    client: { from, rpc },
    rows,
    calls,
    operations: () => calls.map((c) => (c.rpc ? `rpc:${c.rpc}` : c.mode || "select")),
    inject(mode, error) { injected[mode] = error; },
    activeLinks: (guildId) => [...rows.values()].filter((r) => r.guild_id === guildId && r.revoked_at === null),
  };
}

function invite(code, uses, inviterId = null) {
  return { code, uses, inviter: inviterId ? { id: inviterId } : null };
}

function makeMember({ guildId = "g1", memberId = "newbie", bot = false, invites = new Map() } = {}) {
  return {
    id: memberId,
    user: { id: memberId, bot, tag: `${memberId}#0001` },
    guild: { id: guildId, invites: { fetch: async () => invites } },
  };
}

// ─────────────────────────────────────────────── persistance Supabase (7)

test("Supabase : une attribution écrit UNE ligne sur invite_links", async () => {
  const fake = createFakeSupabase();
  const repository = new SupabaseInviteStatsRepository({ supabase: fake.client });

  const link = await repository.attributeInvite({ guildId: "g1", invitedId: "u9", inviterId: "alice", inviteCode: "ABC" });

  assert.equal(fake.rows.size, 1);
  const stored = fake.rows.get("g1:u9");
  assert.deepEqual(
    { guild_id: stored.guild_id, invited_id: stored.invited_id, inviter_id: stored.inviter_id, invite_code: stored.invite_code, revoked_at: stored.revoked_at },
    { guild_id: "g1", invited_id: "u9", inviter_id: "alice", invite_code: "ABC", revoked_at: null },
  );
  assert.equal(link.inviterId, "alice");
  // created_at n'est JAMAIS fourni : DEFAULT now() fait foi.
  assert.equal("created_at" in fake.calls[0].payload, false);
  assert.equal(fake.calls[0].onConflict, "guild_id,invited_id");
});

test("Supabase : les données survivent à une nouvelle instance du dépôt", async () => {
  const fake = createFakeSupabase();
  const first = new SupabaseInviteStatsRepository({ supabase: fake.client });
  await first.attributeInvite({ guildId: "g1", invitedId: "u1", inviterId: "alice" });
  await first.attributeInvite({ guildId: "g1", invitedId: "u2", inviterId: "alice" });

  // Simule un redémarrage : nouveau dépôt, même base.
  const second = new SupabaseInviteStatsRepository({ supabase: fake.client });
  assert.equal((await second.getInviteStats("alice", "g1")).current, 2);
  assert.deepEqual(await second.getLeaderboard("g1", 10), [{ userId: "alice", current: 2 }]);
});

test("Supabase : le départ pose revoked_at sans supprimer la ligne", async () => {
  const fake = createFakeSupabase();
  const repository = new SupabaseInviteStatsRepository({ supabase: fake.client });
  await repository.attributeInvite({ guildId: "g1", invitedId: "u9", inviterId: "alice" });

  const result = await repository.revokeInvite("g1", "u9");

  assert.equal(result.revoked, true);
  assert.equal(fake.rows.size, 1, "la ligne ne doit JAMAIS être supprimée");
  assert.notEqual(fake.rows.get("g1:u9").revoked_at, null);
  assert.equal((await repository.getInviteStats("alice", "g1")).current, 0);
});

test("Supabase : le départ est idempotent", async () => {
  const fake = createFakeSupabase();
  const repository = new SupabaseInviteStatsRepository({ supabase: fake.client });
  await repository.attributeInvite({ guildId: "g1", invitedId: "u9", inviterId: "alice" });

  assert.equal((await repository.revokeInvite("g1", "u9")).revoked, true);
  const second = await repository.revokeInvite("g1", "u9");
  assert.equal(second.revoked, false, "un second départ ne doit rien matcher");
  const writes = fake.operations().filter((op) => op === "update");
  assert.equal(writes.length, 2);
  // Le filtre .is("revoked_at", null) est ce qui rend l'opération idempotente.
  const lastUpdate = [...fake.calls].reverse().find((c) => c.mode === "update");
  assert.deepEqual(lastUpdate.filters.find((f) => f.type === "is"), { type: "is", column: "revoked_at", value: null });
});

test("Supabase : le retour d'un membre réactive le même lien", async () => {
  const fake = createFakeSupabase();
  const repository = new SupabaseInviteStatsRepository({ supabase: fake.client });
  await repository.attributeInvite({ guildId: "g1", invitedId: "u9", inviterId: "alice", inviteCode: "ABC" });
  await repository.revokeInvite("g1", "u9");
  assert.equal((await repository.getInviteStats("alice", "g1")).current, 0);

  await repository.attributeInvite({ guildId: "g1", invitedId: "u9", inviterId: "bob", inviteCode: "XYZ" });

  assert.equal(fake.rows.size, 1, "un seul lien actif par (guild_id, invited_id)");
  assert.equal(fake.rows.get("g1:u9").revoked_at, null, "revoked_at doit être remis à null par l'upsert");
  assert.equal((await repository.getInviteStats("bob", "g1")).current, 1);
  assert.equal((await repository.getInviteStats("alice", "g1")).current, 0, "l'ancien inviteur n'est plus crédité");
});

test("Supabase : le même membre attribué deux fois ne produit qu'une ligne", async () => {
  const fake = createFakeSupabase();
  const repository = new SupabaseInviteStatsRepository({ supabase: fake.client });

  await Promise.all([
    repository.attributeInvite({ guildId: "g1", invitedId: "u9", inviterId: "alice" }),
    repository.attributeInvite({ guildId: "g1", invitedId: "u9", inviterId: "alice" }),
  ]);

  assert.equal(fake.rows.size, 1, "la PK interdit deux lignes pour le même membre");
  assert.equal((await repository.getInviteStats("alice", "g1")).current, 1);
});

test("Supabase : append-only — aucun DELETE, et le classement passe par la RPC bornée", async () => {
  const fake = createFakeSupabase();
  const repository = new SupabaseInviteStatsRepository({ supabase: fake.client });
  await repository.attributeInvite({ guildId: "g1", invitedId: "u1", inviterId: "alice" });
  await repository.revokeInvite("g1", "u1");
  await repository.getInviteStats("alice", "g1");
  await repository.getLeaderboard("g1", 9999);

  const operations = fake.operations();
  assert.equal(operations.includes("delete"), false, "aucun DELETE ne doit être émis");
  assert.equal(operations.includes("insert"), false, "upsert uniquement");
  assert.ok(operations.includes("rpc:invite_leaderboard"));
  const rpcCall = fake.calls.find((c) => c.rpc);
  assert.equal(rpcCall.args.p_limit, LEADERBOARD_MAX_LIMIT, "la limite doit être bornée à 100");
  assert.equal(typeof repository.deleteInvite, "undefined");
  assert.throws(() => new SupabaseInviteStatsRepository({}), TypeError);
});

// ───────────────────────────────────────── erreurs Supabase (2)

test("Supabase : 42P01 devient InviteLinksUnavailableError, cause conservée", async () => {
  const cause = { code: "42P01", message: 'relation "public.invite_links" does not exist' };
  const repository = new SupabaseInviteStatsRepository({ supabase: createFakeSupabase({ errors: { upsert: cause } }).client });

  let thrown;
  await repository.attributeInvite({ guildId: "g1", invitedId: "u9", inviterId: "alice" }).catch((e) => { thrown = e; });

  assert.ok(thrown instanceof InviteLinksUnavailableError);
  assert.equal(thrown.code, "INVITE_LINKS_UNAVAILABLE");
  assert.equal(thrown.cause, cause);
});

test("Supabase : une erreur autre que 42P01 est relancée telle quelle", async () => {
  const denied = { code: "42501", message: "permission denied for table invite_links" };
  for (const [mode, call] of [
    ["upsert", (r) => r.attributeInvite({ guildId: "g1", invitedId: "u9", inviterId: "alice" })],
    ["update", (r) => r.revokeInvite("g1", "u9")],
    ["rpc", (r) => r.getLeaderboard("g1", 10)],
  ]) {
    const repository = new SupabaseInviteStatsRepository({ supabase: createFakeSupabase({ errors: { [mode]: denied } }).client });
    let thrown;
    await call(repository).catch((e) => { thrown = e; });
    assert.equal(thrown, denied, `${mode} : une erreur de permission n'est pas une table absente`);
  }
});

// ─────────────────────────────────────────────── attribution (6)

test("Attribution : delta maximal choisi, pas la première invite au-dessus du cache", () => {
  const svc = new InviteService();
  svc.cacheGuildInvites("g1", new Map([["AAA", invite("AAA", 5, "alice")], ["BBB", invite("BBB", 5, "bob")]]));

  // AAA a pris +1, BBB a pris +3 : c'est BBB qui a été consommée.
  const found = svc.findUsedInvite("g1", new Map([["AAA", invite("AAA", 6, "alice")], ["BBB", invite("BBB", 8, "bob")]]));
  assert.equal(found.code, "BBB");
  assert.equal(found.inviter, "bob");
  assert.equal(found.uses, 8);
});

test("Attribution : égalité stricte entre deux invites => aucune attribution", () => {
  const svc = new InviteService();
  svc.cacheGuildInvites("g1", new Map([["AAA", invite("AAA", 5, "alice")], ["BBB", invite("BBB", 5, "bob")]]));

  const found = svc.findUsedInvite("g1", new Map([["AAA", invite("AAA", 6, "alice")], ["BBB", invite("BBB", 6, "bob")]]));
  assert.equal(found, null, "on ne devine pas : aucune attribution vaut mieux qu'une attribution inventée");
});

test("Attribution : le cache est rafraîchi après chaque décision, y compris sans attribution", () => {
  const svc = new InviteService();
  svc.cacheGuildInvites("g1", new Map([["AAA", invite("AAA", 5, "alice")]]));

  svc.findUsedInvite("g1", new Map([["AAA", invite("AAA", 6, "alice")]]));
  assert.equal(svc.cache.get("g1").get("AAA"), 6, "recache après attribution");

  svc.findUsedInvite("g1", new Map([["AAA", invite("AAA", 6, "alice")]]));
  assert.equal(svc.cache.get("g1").get("AAA"), 6);

  // vanity URL : rien ne bouge, le cache doit tout de même suivre l'instantané.
  svc.findUsedInvite("g1", new Map([["AAA", invite("AAA", 6, "alice")], ["VAN", invite("VAN", 3, null)]]));
  assert.equal(svc.cache.get("g1").has("VAN"), true, "recache même sans attribution");
});

test("Bug AAA/BBB : reproduit avec l'ancienne règle, corrigé avec la nouvelle", async () => {
  // Ancienne règle : « première invite au-dessus du cache », cache jamais recaché.
  const oldCache = new Map([["AAA", 5], ["BBB", 5]]);
  const oldRule = (snapshot) => {
    for (const inv of snapshot.values()) {
      if (inv.uses > (oldCache.get(inv.code) || 0)) return inv.inviter.id;
    }
    return null;
  };
  const snapshot = new Map([["AAA", invite("AAA", 6, "alice")], ["BBB", invite("BBB", 6, "bob")]]);
  assert.equal(oldRule(snapshot), "alice", "l'ancienne règle attribue à tort la 2e arrivée à alice");
  assert.equal(oldRule(snapshot), "alice", "…et recommence, indéfiniment");

  // Nouvelle règle, sur le chemin réel.
  const repository = new InMemoryInviteStatsRepository();
  const svc = new InviteService({ statsRepository: repository });
  const guildMemberAdd = require("../../../events/guildMemberAdd");
  svc.cacheGuildInvites("g1", new Map([["AAA", invite("AAA", 5, "alice")], ["BBB", invite("BBB", 5, "bob")]]));
  const legacy = require("../../../services/inviteService");
  const savedRepo = legacy.statsRepository;
  legacy.statsRepository = repository;
  const savedCache = new Map(legacy.cache);
  legacy.cacheGuildInvites("g1", new Map([["AAA", invite("AAA", 5, "alice")], ["BBB", invite("BBB", 5, "bob")]]));
  try {
    const r1 = await guildMemberAdd.handleInviteTracking(makeMember({ memberId: "m1", invites: snapshot }), {});
    assert.equal(r1, null, "égalité stricte : la 1re arrivée n'est pas attribuée à tort");
    // Après recache, une arrivée via AAA seule est correctement attribuée.
    const r2 = await guildMemberAdd.handleInviteTracking(
      makeMember({ memberId: "m2", invites: new Map([["AAA", invite("AAA", 7, "alice")], ["BBB", invite("BBB", 6, "bob")]]) }), {},
    );
    assert.equal(r2.inviter, "alice");
    assert.equal((await repository.getInviteStats("alice", "g1")).current, 1);
    assert.equal((await repository.getInviteStats("bob", "g1")).current, 0, "bob ne doit rien recevoir à tort");
  } finally {
    legacy.statsRepository = savedRepo;
    legacy.cache.clear();
    for (const [k, v] of savedCache) legacy.cache.set(k, v);
  }
});

test("Attribution : vanity URL et invite sans inviteur ne produisent aucune ligne", async () => {
  const repository = new InMemoryInviteStatsRepository();
  const svc = new InviteService({ statsRepository: repository });
  svc.cacheGuildInvites("g1", new Map([["AAA", invite("AAA", 5, "alice")]]));

  // vanity : aucun compteur ne bouge.
  assert.equal(svc.findUsedInvite("g1", new Map([["AAA", invite("AAA", 5, "alice")]])), null);
  // invite sans inviteur connu : détectée mais non attribuable.
  const noInviter = svc.findUsedInvite("g1", new Map([["AAA", invite("AAA", 6, null)]]));
  assert.equal(noInviter.inviter, null);

  assert.equal(repository.links.size, 0, "aucune ligne ne doit être inventée");
});

test("Attribution : le self-invite est refusé, sans écriture", async () => {
  const repository = new InMemoryInviteStatsRepository();
  const legacy = require("../../../services/inviteService");
  const guildMemberAdd = require("../../../events/guildMemberAdd");
  const savedRepo = legacy.statsRepository;
  const savedCache = new Map(legacy.cache);
  legacy.statsRepository = repository;
  try {
    legacy.cacheGuildInvites("g1", new Map([["AAA", invite("AAA", 1, "selfish")]]));
    const result = await guildMemberAdd.handleInviteTracking(
      makeMember({ memberId: "selfish", invites: new Map([["AAA", invite("AAA", 2, "selfish")]]) }), {},
    );
    assert.equal(result, null, "aucune attribution ne doit être remontée");
    assert.equal(repository.links.size, 0, "rien ne doit être persisté");
  } finally {
    legacy.statsRepository = savedRepo;
    legacy.cache.clear();
    for (const [k, v] of savedCache) legacy.cache.set(k, v);
  }
});

// ─────────────────────────────────────────── classement / isolation (3)

test("Classement : ordre décroissant, égalité déterministe, limite bornée", async () => {
  const fake = createFakeSupabase();
  const repository = new SupabaseInviteStatsRepository({ supabase: fake.client });
  await repository.attributeInvite({ guildId: "g1", invitedId: "a", inviterId: "alice" });
  await repository.attributeInvite({ guildId: "g1", invitedId: "b", inviterId: "alice" });
  await repository.attributeInvite({ guildId: "g1", invitedId: "c", inviterId: "zoe" });
  await repository.attributeInvite({ guildId: "g1", invitedId: "d", inviterId: "bob" });
  await repository.attributeInvite({ guildId: "g1", invitedId: "e", inviterId: "bob" });

  assert.deepEqual(await repository.getLeaderboard("g1", 10), [
    { userId: "alice", current: 2 },
    { userId: "bob", current: 2 },
    { userId: "zoe", current: 1 },
  ]);
  assert.equal((await repository.getLeaderboard("g1", 2)).length, 2);
  // La forme attendue par inviteView (entry.userId / entry.current).
  const [top] = await repository.getLeaderboard("g1", 1);
  assert.deepEqual(Object.keys(top).sort(), ["current", "userId"]);
});

test("Classement : isolation stricte par guilde", async () => {
  const fake = createFakeSupabase();
  const repository = new SupabaseInviteStatsRepository({ supabase: fake.client });
  await repository.attributeInvite({ guildId: "g1", invitedId: "a", inviterId: "alice" });
  await repository.attributeInvite({ guildId: "g2", invitedId: "b", inviterId: "alice" });
  await repository.attributeInvite({ guildId: "g2", invitedId: "c", inviterId: "alice" });

  assert.deepEqual(await repository.getLeaderboard("g1", 10), [{ userId: "alice", current: 1 }]);
  assert.deepEqual(await repository.getLeaderboard("g2", 10), [{ userId: "alice", current: 2 }]);
  assert.equal((await repository.getInviteStats("alice", "g1")).current, 1);
  assert.equal((await repository.getInviteStats("alice", "g2")).current, 2);
  assert.deepEqual(await repository.getLeaderboard("g3", 10), []);
});

test("InMemory : même contrat que Supabase (classement, isolation, bornes)", async () => {
  const repository = new InMemoryInviteStatsRepository();
  await repository.attributeInvite({ guildId: "g1", invitedId: "a", inviterId: "alice" });
  await repository.attributeInvite({ guildId: "g1", invitedId: "b", inviterId: "alice" });
  await repository.attributeInvite({ guildId: "g2", invitedId: "c", inviterId: "alice" });

  assert.deepEqual(await repository.getLeaderboard("g1", 10), [{ userId: "alice", current: 2 }]);
  assert.deepEqual(await repository.getLeaderboard("g2", 10), [{ userId: "alice", current: 1 }]);
  assert.equal((await repository.getLeaderboard("g1", 0)).length, 1);
  await repository.attributeInvite({ guildId: "g1", invitedId: "a", inviterId: "alice" });
  assert.equal((await repository.getInviteStats("alice", "g1")).current, 2, "même membre = une seule ligne");
});

// ─────────────────────────────────────────────── résolution (3)

test("Résolution : Supabase prioritaire, InMemory en repli, mémoïsé", async () => {
  const runtime = require("../runtime/getInviteRepository");
  const databasePath = require.resolve("../../../config/database");
  const original = require.cache[databasePath];
  try {
    const fake = createFakeSupabase();
    require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: { supabaseAdmin: fake.client } };
    runtime._resetForTests();
    const durable = runtime.getInviteRepository();
    assert.ok(durable instanceof SupabaseInviteStatsRepository);
    assert.equal(runtime.getInviteRepository(), durable, "le dépôt doit être mémoïsé");

    require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: { supabaseAdmin: null } };
    runtime._resetForTests();
    const fallback = runtime.getInviteRepository();
    assert.ok(fallback instanceof InMemoryInviteStatsRepository);
    assert.equal(fallback instanceof SupabaseInviteStatsRepository, false);
  } finally {
    if (original) require.cache[databasePath] = original;
    else delete require.cache[databasePath];
    runtime._resetForTests();
  }
});

test("Résolution : Mongo n'est jamais activé", () => {
  const { readFileSync } = require("node:fs");
  const { join } = require("node:path");
  const runtime = require("../runtime/getInviteRepository");
  const databasePath = require.resolve("../../../config/database");
  const original = require.cache[databasePath];
  try {
    require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: { supabaseAdmin: null } };
    runtime._resetForTests();
    assert.equal(runtime.getInviteRepository() instanceof MongoInviteStatsRepository, false);
  } finally {
    if (original) require.cache[databasePath] = original;
    else delete require.cache[databasePath];
    runtime._resetForTests();
  }
  // La classe reste présente (B2 ne la supprime pas) mais n'est référencée par
  // aucun require du chemin de production.
  const requiresOf = (source) => [...source.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
  for (const file of ["runtime/getInviteRepository.js", "../../services/inviteService.js"]) {
    const dependencies = requiresOf(readFileSync(join(__dirname, "..", file), "utf8"));
    assert.deepEqual(dependencies.filter((dep) => /mongoose|models\//i.test(dep)), [], `${file} ne doit charger aucun modèle Mongo`);
  }
});

test("Contrat : attributeInvite exige les trois identifiants", async () => {
  const fake = createFakeSupabase();
  const supabase = new SupabaseInviteStatsRepository({ supabase: fake.client });
  const memory = new InMemoryInviteStatsRepository();
  for (const repository of [supabase, memory]) {
    await assert.rejects(() => repository.attributeInvite({ guildId: "g1", invitedId: "u9" }), TypeError);
    await assert.rejects(() => repository.attributeInvite({ guildId: "g1", inviterId: "alice" }), TypeError);
    await assert.rejects(() => repository.revokeInvite("g1"), TypeError);
  }
  assert.equal(fake.rows.size, 0);
  assert.equal(memory.links.size, 0);
});

// ─────────────────────────────────────────── chemin réel complet (2)

test("Chemin réel : join puis départ, via guildMemberAdd / guildMemberRemove", async () => {
  const repository = new InMemoryInviteStatsRepository();
  const legacy = require("../../../services/inviteService");
  const guildMemberAdd = require("../../../events/guildMemberAdd");
  const savedRepo = legacy.statsRepository;
  const savedCache = new Map(legacy.cache);
  legacy.statsRepository = repository;
  try {
    legacy.cacheGuildInvites("g1", new Map([["ABC", invite("ABC", 1, "alice")]]));
    const result = await guildMemberAdd.handleInviteTracking(
      makeMember({ memberId: "u9", invites: new Map([["ABC", invite("ABC", 2, "alice")]]) }), {},
    );
    assert.deepEqual(result, { code: "ABC", inviter: "alice", uses: 2 });
    assert.equal(repository.links.get("g1:u9").inviteCode, "ABC", "le code connu doit être conservé");
    assert.equal((await legacy.getInviteStats("alice", "g1")).current, 1);

    const revoked = await legacy.revokeInvite("g1", "u9");
    assert.equal(revoked.revoked, true);
    assert.equal((await legacy.getInviteStats("alice", "g1")).current, 0);
    assert.equal(repository.links.size, 1, "la ligne reste, marquée révoquée");
  } finally {
    legacy.statsRepository = savedRepo;
    legacy.cache.clear();
    for (const [k, v] of savedCache) legacy.cache.set(k, v);
  }
});

test("Concurrence : deux joins simultanés de membres différents sont tous deux comptés", async () => {
  const fake = createFakeSupabase();
  const repository = new SupabaseInviteStatsRepository({ supabase: fake.client });

  await Promise.all([
    repository.attributeInvite({ guildId: "g1", invitedId: "u1", inviterId: "alice", inviteCode: "AAA" }),
    repository.attributeInvite({ guildId: "g1", invitedId: "u2", inviterId: "bob", inviteCode: "BBB" }),
  ]);

  assert.equal(fake.rows.size, 2, "deux membres = deux lignes");
  assert.deepEqual(await repository.getLeaderboard("g1", 10), [
    { userId: "alice", current: 1 },
    { userId: "bob", current: 1 },
  ]);
});
