"use strict";

// M8 — Persistance des panels de tickets sur public.ticket_panels.
//
// Le faux client ci-dessous n'est PAS une maquette permissive : il conserve de
// vraies lignes, applique les `.eq()` et le `count=exact`, et ne concède aucun
// DELETE — comme la vraie RLS (service_role = SELECT + INSERT + UPDATE).
//
// Aucun de ces tests ne parle à une vraie base : il n'y a aucune variable
// d'environnement Supabase dans cet environnement. Ce qui est prouvé ici, ce
// sont les requêtes émises et la sémantique du contrat, pas ce que Postgres en
// ferait.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  InMemoryTicketPanelRepository,
  normalizeButtons,
  resolveButtonTarget,
} = require("../persistence/TicketPanelRepository");
const {
  SupabaseTicketPanelRepository,
  TicketPanelsUnavailableError,
  TICKET_PANELS_TABLE,
} = require("../persistence/SupabaseTicketPanelRepository");
const { TicketPanelService } = require("../services/TicketPanelService");
const { TicketService } = require("../services/TicketService");
const { MAX_PANELS_PER_GUILD, MAX_BUTTONS_PER_PANEL } = require("../configuration/ticketConstants");
const { rows } = require("../../../adapters/discord/DiscordResponseTransport");

const CAT = "111111111111111111";
const ROLE = "222222222222222222";
const BTN = (label, extra = {}) => ({ label, emoji: null, style: "primary", category_id: null, support_role_id: null, ...extra });

/** Faux client PostgREST simulant public.ticket_panels. */
function createFakeSupabase({ errors = {} } = {}) {
  const rowsStore = new Map(); // "guild:id" -> ligne snake_case
  const calls = [];
  let nextId = 0;
  let injected = { ...errors };

  const takeError = (kind) => {
    const error = injected[kind];
    if (!error) return null;
    if (error === "once") delete injected[kind];
    return error;
  };

  const matches = (row, filters) => filters.every((f) => row[f.column] === f.value);

  function execute(state) {
    calls.push({
      mode: state.mode || "select",
      payload: state.payload ? { ...state.payload } : null,
      filters: state.filters.map((f) => `${f.type}:${f.column}`),
      head: state.head,
      count: state.count,
      selected: state.selected,
      order: state.order ? { ...state.order } : null,
    });
    const kind = state.mode || "select";
    const forced = takeError(kind);
    if (forced) return Promise.resolve({ data: null, error: forced, count: null });

    if (state.mode === "insert") {
      // id bigint generated always as identity : attribué par la base.
      const id = String(++nextId);
      const row = {
        id,
        guild_id: state.payload.guild_id,
        channel_id: state.payload.channel_id,
        message_id: state.payload.message_id,
        category_id: state.payload.category_id,
        support_role_id: state.payload.support_role_id,
        buttons: state.payload.buttons,
        is_active: true,
        created_at: "T0-created",
        updated_at: "T0-created",
      };
      rowsStore.set(`${row.guild_id}:${id}`, row);
      return Promise.resolve({ data: { ...row }, error: null, count: null });
    }

    if (state.mode === "update") {
      const updated = [];
      for (const [key, row] of rowsStore.entries()) {
        if (matches(row, state.filters)) {
          const next = { ...row, ...state.payload, updated_at: "T1-updated" };
          rowsStore.set(key, next);
          updated.push({ ...next });
        }
      }
      return Promise.resolve({ data: updated, error: null, count: null });
    }

    const result = [...rowsStore.values()].filter((row) => matches(row, state.filters));
    if (state.head) return Promise.resolve({ data: null, error: null, count: result.length });
    return Promise.resolve({ data: result.map((row) => ({ ...row })), error: null, count: null });
  }

  function from(table) {
    assert.equal(table, TICKET_PANELS_TABLE, "le dépôt doit viser public.ticket_panels");
    const state = { filters: [], mode: null, payload: null, head: false, count: null, selected: null, order: null };
    const api = {
      select(columns, options) {
        state.selected = columns;
        state.head = Boolean(options?.head);
        state.count = options?.count || null;
        return api;
      },
      eq(column, value) { state.filters.push({ type: "eq", column, value }); return api; },
      insert(payload) { state.mode = "insert"; state.payload = payload; return api; },
      update(payload) { state.mode = "update"; state.payload = payload; return api; },
      order(column, options) { state.order = { column, ascending: options?.ascending !== false }; return api; },
      // La vraie RLS ne concède aucun DELETE à service_role.
      delete() { throw new Error("public.ticket_panels est sans DELETE : la désactivation passe par is_active"); },
      async single() {
        const { data, error } = await execute(state);
        if (error) return { data: null, error };
        return { data: Array.isArray(data) ? data[0] ?? null : data, error: null };
      },
      async maybeSingle() { return api.single(); },
      then(res, rej) { return execute(state).then(res, rej); },
    };
    return api;
  }

  return { from, calls, rowsStore };
}

// ═════════════════════════════════════════════════════════════════════════
// Dépôt Supabase : requêtes émises et sémantique.
// ═════════════════════════════════════════════════════════════════════════

test("M8 Supabase: create writes ONE row with the 10 real columns", async () => {
  const fake = createFakeSupabase();
  const repo = new SupabaseTicketPanelRepository({ supabase: fake });
  const panel = await repo.create({ guildId: "g1", channelId: "chan", messageId: "msg-1", categoryId: CAT, supportRoleId: ROLE, buttons: [BTN("Support")] });

  assert.equal(fake.rowsStore.size, 1);
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].mode, "insert");
  assert.deepEqual(Object.keys(fake.calls[0].payload).sort(),
    ["buttons", "category_id", "channel_id", "guild_id", "message_id", "support_role_id"]);
  // created_at / updated_at ne sont JAMAIS fournis : DEFAULT now() fait foi.
  assert.ok(!("created_at" in fake.calls[0].payload), "created_at must come from the DB default");
  assert.ok(!("updated_at" in fake.calls[0].payload), "updated_at must come from the trigger");
  assert.equal(typeof panel.id, "string", "bigint comes back as a string");
});

test("M8 Supabase: findActive filters by guild, id AND is_active", async () => {
  const fake = createFakeSupabase();
  const repo = new SupabaseTicketPanelRepository({ supabase: fake });
  await repo.create({ guildId: "g1", channelId: "c", messageId: "m", categoryId: CAT, supportRoleId: ROLE, buttons: [BTN("a")] });

  await repo.findActive("g1", "1");
  const last = fake.calls[fake.calls.length - 1];
  assert.deepEqual(last.filters.sort(), ["eq:guild_id", "eq:id", "eq:is_active"]);
  assert.ok(last.filters.some((f) => f === "eq:is_active"), "un panel désactivé ne doit jamais être résolu");
});

test("M8 Supabase: listActive orders by id in the database (bigint, not lexicographic)", async () => {
  const fake = createFakeSupabase();
  const repo = new SupabaseTicketPanelRepository({ supabase: fake });
  await repo.listActive("g1");
  const last = fake.calls[fake.calls.length - 1];
  assert.deepEqual(last.order, { column: "id", ascending: true });
});

test("M8 Supabase: countActive uses HEAD + count=exact, transferring no row", async () => {
  const fake = createFakeSupabase();
  const repo = new SupabaseTicketPanelRepository({ supabase: fake });
  const count = await repo.countActive("g1");
  assert.equal(count, 0);
  const last = fake.calls[fake.calls.length - 1];
  assert.equal(last.head, true);
  assert.equal(last.count, "exact");
});

test("M8 Supabase: deactivate sets is_active=false and is idempotent", async () => {
  const fake = createFakeSupabase();
  const repo = new SupabaseTicketPanelRepository({ supabase: fake });
  const panel = await repo.create({ guildId: "g1", channelId: "c", messageId: "m", categoryId: CAT, supportRoleId: ROLE, buttons: [BTN("a")] });

  const first = await repo.deactivate("g1", panel.id);
  assert.equal(first.deactivated, true);
  assert.equal(fake.rowsStore.size, 1, "la ligne subsiste : aucune suppression");
  assert.equal(fake.rowsStore.get(`g1:${panel.id}`).is_active, false);

  const updates = fake.calls.filter((c) => c.mode === "update");
  assert.equal(updates.length, 1);
  assert.deepEqual(Object.keys(updates[0].payload), ["is_active"]);
  assert.ok(updates[0].filters.includes("eq:is_active"), "garde d'idempotence");

  const second = await repo.deactivate("g1", panel.id);
  assert.equal(second.deactivated, false, "second appel sans effet");
});

test("M8 Supabase: no DELETE is ever emitted", async () => {
  const fake = createFakeSupabase();
  const repo = new SupabaseTicketPanelRepository({ supabase: fake });
  const panel = await repo.create({ guildId: "g1", channelId: "c", messageId: "m", categoryId: CAT, supportRoleId: ROLE, buttons: [BTN("a")] });
  await repo.deactivate("g1", panel.id);
  await repo.updatePanel("g1", panel.id, { categoryId: CAT });
  assert.ok(fake.calls.every((c) => c.mode !== "delete"), "0 DELETE émis");
});

test("M8 Supabase: updatePanel cannot resurrect a deactivated panel", async () => {
  const fake = createFakeSupabase();
  const repo = new SupabaseTicketPanelRepository({ supabase: fake });
  const panel = await repo.create({ guildId: "g1", channelId: "c", messageId: "m", categoryId: CAT, supportRoleId: ROLE, buttons: [BTN("a")] });
  await repo.deactivate("g1", panel.id);

  const updated = await repo.updatePanel("g1", panel.id, { channelId: "other" });
  assert.equal(updated, null, "la garde .eq(is_active, true) ne matche plus");
  assert.equal(fake.rowsStore.get(`g1:${panel.id}`).channel_id, "c", "rien n'a été écrit");
});

test("M8 Supabase: 42P01 becomes TicketPanelsUnavailableError, cause preserved", async () => {
  const cause = { code: "42P01", message: 'relation "public.ticket_panels" does not exist' };
  const repo = new SupabaseTicketPanelRepository({ supabase: createFakeSupabase({ errors: { insert: cause } }) });
  await assert.rejects(
    () => repo.create({ guildId: "g", channelId: "c", messageId: "m", categoryId: CAT, supportRoleId: ROLE, buttons: [BTN("a")] }),
    (error) => {
      assert.ok(error instanceof TicketPanelsUnavailableError);
      assert.equal(error.code, "TICKET_PANELS_UNAVAILABLE");
      assert.equal(error.cause, cause, "la cause PostgREST est conservée");
      return true;
    },
  );
});

test("M8 Supabase: an error other than 42P01 is rethrown untouched", async () => {
  const forbidden = { code: "42501", message: "permission denied for table ticket_panels" };
  const repo = new SupabaseTicketPanelRepository({ supabase: createFakeSupabase({ errors: { insert: forbidden } }) });
  await assert.rejects(
    () => repo.create({ guildId: "g", channelId: "c", messageId: "m", categoryId: CAT, supportRoleId: ROLE, buttons: [BTN("a")] }),
    (error) => {
      assert.equal(error, forbidden, "un refus de permission ne doit PAS passer pour une table absente");
      return true;
    },
  );
});

test("M8 Supabase: panel id stays a string end to end (bigint trap)", async () => {
  const fake = createFakeSupabase();
  const repo = new SupabaseTicketPanelRepository({ supabase: fake });
  const created = [];
  for (let i = 0; i < 12; i += 1) {
    created.push(await repo.create({ guildId: "g1", channelId: "c", messageId: `m${i}`, categoryId: CAT, supportRoleId: ROLE, buttons: [BTN("a")] }));
  }
  assert.equal(created[9].id, "10");
  assert.equal(typeof created[9].id, "string");
  // Le tri lexicographique placerait "10" avant "9" ; le tri est demandé à la
  // base, qui trie numériquement.
  await repo.listActive("g1");
  assert.deepEqual(fake.calls.filter((c) => c.order).map((c) => c.order), [{ column: "id", ascending: true }]);
});

// ═════════════════════════════════════════════════════════════════════════
// Boutons : parsing défensif, plafond, refus du style link.
// ═════════════════════════════════════════════════════════════════════════

test("M8 buttons: a link button is refused because it carries no custom id", async () => {
  const cleaned = normalizeButtons([{ label: "Site", style: "link", url: "https://x" }, BTN("Support")]);
  assert.equal(cleaned.length, 1);
  assert.equal(cleaned[0].label, "Support", "le bouton link est écarté, le bouton valide conservé");

  const service = new TicketPanelService({ configService: { read: async () => ({}) } });
  const validated = service.validateButtons([{ label: "Site", style: "link" }]);
  assert.equal(validated.valid, false);
  assert.equal(validated.code, "TICKET_PANEL_BUTTON_LINK_REFUSED");
});

test("M8 buttons: more than 5 are truncated by the renderer but refused by validation", async () => {
  const many = Array.from({ length: 8 }, (_, i) => BTN(`b${i}`));
  assert.equal(normalizeButtons(many).length, MAX_BUTTONS_PER_PANEL, "le rendu borne silencieusement");

  const service = new TicketPanelService({ configService: { read: async () => ({}) } });
  const validated = service.validateButtons(many);
  assert.equal(validated.valid, false, "la saisie humaine, elle, est refusée");
  assert.equal(validated.code, "TICKET_PANEL_TOO_MANY_BUTTONS");
});

test("M8 buttons: defensive parsing never throws on garbage", async () => {
  assert.deepEqual(normalizeButtons(null), []);
  assert.deepEqual(normalizeButtons("not an array"), []);
  assert.deepEqual(normalizeButtons([null, 42, "x", {}]), [], "entrées invalides ignorées");
  assert.deepEqual(normalizeButtons([{ label: "   " }]), [], "libellé vide ignoré");
  const ok = normalizeButtons([{ label: "Support", style: "nonsense" }]);
  assert.equal(ok[0].style, "primary", "style inconnu => primary");
});

test("M8 buttons: per-button category and role override the panel values", async () => {
  const panel = {
    id: "1", guildId: "g", channelId: "c", messageId: "m",
    categoryId: CAT, supportRoleId: ROLE,
    buttons: Object.freeze([
      Object.freeze({ label: "Défaut", emoji: null, style: "primary", category_id: null, support_role_id: null }),
      Object.freeze({ label: "Spécial", emoji: null, style: "danger", category_id: "333333333333333333", support_role_id: "444444444444444444" }),
    ]),
    isActive: true,
  };
  const fallback = resolveButtonTarget(panel, 0);
  assert.equal(fallback.categoryId, CAT, "bouton sans catégorie => celle du panel");
  assert.equal(fallback.supportRoleId, ROLE);

  const override = resolveButtonTarget(panel, 1);
  assert.equal(override.categoryId, "333333333333333333", "la valeur du bouton prime");
  assert.equal(override.supportRoleId, "444444444444444444");

  assert.equal(resolveButtonTarget(panel, 2), null, "index hors bornes");
  assert.equal(resolveButtonTarget(panel, -1), null);
  assert.equal(resolveButtonTarget(panel, "abc"), null);
  assert.equal(resolveButtonTarget(null, 0), null);
});

test("M8 buttons: a 5-button panel stays within the Discord action row limit", async () => {
  const service = new TicketPanelService({ configService: { read: async () => ({ tickets_enabled: true }) } });
  const panel = {
    id: "99", categoryId: CAT, supportRoleId: ROLE,
    buttons: Array.from({ length: MAX_BUTTONS_PER_PANEL }, (_, i) => BTN(`b${i}`, { emoji: "🎫" })),
  };
  const built = await service.build({ guildId: "g", panel, t: (k) => k });
  assert.equal(built.ready, true);
  assert.equal(built.view.components.length, MAX_BUTTONS_PER_PANEL);
  // rows() LÈVE au-delà de 5 lignes : ce test échouerait bruyamment si un
  // panel pouvait dépasser le budget Discord.
  const built_rows = rows(built.view.components);
  assert.equal(built_rows.length, 1, "5 boutons tiennent sur une seule ligne");
  assert.equal(built.view.components[0].emoji, "🎫", "l'emoji est honoré");
});

// ═════════════════════════════════════════════════════════════════════════
// customId : format et extraction.
// ═════════════════════════════════════════════════════════════════════════

test("M8 customId: stays far below the Discord limit even with a 19-digit panel id", async () => {
  const service = new TicketPanelService({ configService: { read: async () => ({ tickets_enabled: true }) } });
  const panel = { id: "9223372036854775807", categoryId: CAT, supportRoleId: ROLE, buttons: [BTN("a")] };
  const built = await service.build({ guildId: "g", panel, t: (k) => k });
  const customId = built.view.components[0].customId;
  assert.equal(customId, "civrat:v1:tickets:create:9223372036854775807:0");
  // préfixe 25 + id 19 + ":" + index = 46. Marge de 54 caractères sur la
  // limite Discord de 100.
  assert.equal(customId.length, 46);
  assert.ok(customId.length <= 100, `${customId.length}/100`);
});

// ═════════════════════════════════════════════════════════════════════════
// Chaîne de résolution : Supabase > InMemory, aucun repli Mongo.
// ═════════════════════════════════════════════════════════════════════════

test("M8 resolution: offline falls back to InMemory and is memoized", async () => {
  const { getTicketPanelRepository, _resetForTests } = require("../runtime/getTicketPanelRepository");
  _resetForTests();
  const first = getTicketPanelRepository();
  const second = getTicketPanelRepository();
  assert.equal(first, second, "singleton mémoïsé");
  // Hors ligne (supabaseAdmin = null ici), le repli est InMemory.
  assert.ok(first instanceof InMemoryTicketPanelRepository);
  _resetForTests();
});

test("M8 resolution: Mongo is never activated", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const files = [
    "runtime/getTicketPanelRepository.js",
    "persistence/TicketPanelRepository.js",
    "persistence/SupabaseTicketPanelRepository.js",
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    // Les commentaires sont retirés avant le scan : un scan qui parcourt un
    // commentaire se signale lui-même.
    const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
    assert.ok(!/require\(\s*["']mongoose["']\s*\)/.test(stripped), `${file} ne doit pas requérir mongoose`);
    assert.ok(!/Mongo\w*PanelRepository/.test(stripped), `${file} ne doit pas référencer de dépôt Mongo`);
  }
});

// ═════════════════════════════════════════════════════════════════════════
// Ouverture de ticket : panel_id, refus, et anti double-ouverture.
// ═════════════════════════════════════════════════════════════════════════

// La catégorie de guild_configs DOIT différer de celle du panel : sinon un test
// qui vérifie « le repli utilise le panel, pas guild_configs » passe dans les
// deux cas et ne prouve rien (mutation N2 non détectée avant ce correctif).
const GUILD_CAT = "999999999999999999";
const GUILD_ROLE = "888888888888888888";

function makeTicketFixture({ createError = null, panelRepository } = {}) {
  const state = { channelCreates: 0, deleted: [], record: null, requestedCategory: null };
  const repository = {
    findOpen: async () => null,
    create: async (record) => {
      if (createError) throw createError;
      state.record = record;
      return record;
    },
    findByChannel: async () => null,
    updateByChannel: async () => ({}),
  };
  const transport = {
    getCategory: async (id) => { state.requestedCategory = id; return { id, type: 4 }; },
    getSupportRole: async (id) => ({ id }),
    getMember: async (id) => ({ id, roles: { cache: { has: () => false } } }),
    getBotMember: async () => ({ id: "bot", roles: { highest: { position: 99 } } }),
    createTicketChannel: async ({ name }) => { state.channelCreates += 1; return { id: "channel-1", name }; },
    applyTicketOverwrites: async () => ({ applied: true }),
    sendTicketWelcome: async () => ({}),
    deleteTicketChannel: async (id) => { state.deleted.push(id); },
  };
  const service = new TicketService({
    repository,
    transport,
    configService: { read: async () => ({ tickets_enabled: true, ticket_category_id: GUILD_CAT, ticket_support_role_id: GUILD_ROLE }) },
    counterRepository: { next: async () => 1 },
    channelNamingService: { build: () => "ticket-001" },
    panelRepository,
  });
  return { service, state };
}

test("M8 ticket: panel_id is written and the button target drives the category", async () => {
  const panelRepository = new InMemoryTicketPanelRepository();
  const panel = await panelRepository.create({
    guildId: "g", channelId: "c", messageId: "m", categoryId: CAT, supportRoleId: ROLE,
    buttons: [BTN("Défaut"), BTN("Spécial", { category_id: "333333333333333333" })],
  });

  const { service, state } = makeTicketFixture({ panelRepository });
  const result = await service.createTicket({ guildId: "g", member: { id: "u1" }, panelId: panel.id, buttonIndex: 1 });
  assert.equal(result.code, "TICKET_CREATED");
  assert.equal(state.record.panel_id, panel.id);
  assert.equal(state.record.category, "support", "category reste \"support\" : décision M8 validée");

  const { service: s2, state: st2 } = makeTicketFixture({ panelRepository });
  await s2.createTicket({ guildId: "g", member: { id: "u2" }, panelId: panel.id, buttonIndex: 0 });
  assert.equal(st2.record.panel_id, panel.id);
});

test("M8 ticket: a missing panel is refused BEFORE any Discord channel is created", async () => {
  const panelRepository = new InMemoryTicketPanelRepository();
  const { service, state } = makeTicketFixture({ panelRepository });
  const result = await service.createTicket({ guildId: "g", member: { id: "u1" }, panelId: "404", buttonIndex: 0 });
  assert.equal(result.code, "TICKET_PANEL_UNAVAILABLE");
  assert.equal(state.channelCreates, 0, "aucun salon orphelin");
});

test("M8 ticket: a deactivated panel is refused, with no fallback to guild config", async () => {
  const panelRepository = new InMemoryTicketPanelRepository();
  const panel = await panelRepository.create({ guildId: "g", channelId: "c", messageId: "m", categoryId: CAT, supportRoleId: ROLE, buttons: [BTN("a")] });
  await panelRepository.deactivate("g", panel.id);

  const { service, state } = makeTicketFixture({ panelRepository });
  const result = await service.createTicket({ guildId: "g", member: { id: "u1" }, panelId: panel.id, buttonIndex: 0 });
  assert.equal(result.code, "TICKET_PANEL_UNAVAILABLE");
  assert.equal(state.channelCreates, 0, "jamais de repli silencieux sur guild_configs");
});

// ─────────────────────────────────────────────────────────────────────────
// Résolution du buttonIndex — les 4 cas exigés.
//
// Règle : un indice doit avoir correspondu à un bouton réellement publié pour
// pouvoir ouvrir un ticket. Un indice arbitraire est toujours refusé.
// ─────────────────────────────────────────────────────────────────────────

test("M8 index: a valid index creates the ticket normally", async () => {
  const panelRepository = new InMemoryTicketPanelRepository();
  const panel = await panelRepository.create({
    guildId: "g", channelId: "c", messageId: "m", categoryId: CAT, supportRoleId: ROLE,
    buttons: [BTN("Défaut"), BTN("Spécial", { category_id: "333333333333333333" })],
  });

  const a = makeTicketFixture({ panelRepository });
  const r0 = await a.service.createTicket({ guildId: "g", member: { id: "u0" }, panelId: panel.id, buttonIndex: 0 });
  assert.equal(r0.code, "TICKET_CREATED");
  assert.equal(a.state.record.panel_id, panel.id);
  assert.equal(a.state.requestedCategory, CAT, "bouton sans surcharge => catégorie du panel");

  const b = makeTicketFixture({ panelRepository });
  const r1 = await b.service.createTicket({ guildId: "g", member: { id: "u1" }, panelId: panel.id, buttonIndex: 1 });
  assert.equal(r1.code, "TICKET_CREATED");
  assert.equal(b.state.requestedCategory, "333333333333333333", "la surcharge du bouton prime");
});

test("M8 index: an out-of-range index is refused", async () => {
  const panelRepository = new InMemoryTicketPanelRepository();
  const panel = await panelRepository.create({
    guildId: "g", channelId: "c", messageId: "m", categoryId: CAT, supportRoleId: ROLE,
    buttons: [BTN("a"), BTN("b")],
  });

  for (const index of [2, 3, 7]) {
    const fx = makeTicketFixture({ panelRepository });
    const result = await fx.service.createTicket({ guildId: "g", member: { id: "u" + index }, panelId: panel.id, buttonIndex: index });
    assert.equal(result.code, "TICKET_PANEL_UNAVAILABLE", "l'indice " + index + " dépasse les 2 boutons publiés");
    assert.equal(fx.state.channelCreates, 0, "aucun salon créé");
    assert.equal(fx.state.record, null, "aucun ticket écrit");
  }
});

test("M8 index: an arbitrary index (99999) can never open a ticket", async () => {
  const panelRepository = new InMemoryTicketPanelRepository();
  const panel = await panelRepository.create({
    guildId: "g", channelId: "c", messageId: "m", categoryId: CAT, supportRoleId: ROLE,
    buttons: [BTN("a")],
  });

  const fx = makeTicketFixture({ panelRepository });
  const result = await fx.service.createTicket({ guildId: "g", member: { id: "u1" }, panelId: panel.id, buttonIndex: 99999 });
  assert.equal(result.code, "TICKET_PANEL_UNAVAILABLE", "un customId forgé ne doit rien pouvoir créer");
  assert.equal(fx.state.channelCreates, 0);
  assert.equal(fx.state.record, null);
});

test("M8 transition: a genuinely published button stays resolvable while the panel shrinks", async () => {
  // Séquence réelle de la réédition (Discord d'abord, base ensuite) :
  //   1. le message Discord passe de 5 boutons à 2 ;
  //   2. la base est réduite à son tour.
  // Pendant l'étape 1 la base contient encore les 5 boutons : un membre dont le
  // client affiche encore l'ancien message clique sur un bouton RÉELLEMENT
  // publié, qui doit rester résolvable.
  const panelRepository = new InMemoryTicketPanelRepository();
  const panel = await panelRepository.create({
    guildId: "g", channelId: "c", messageId: "m", categoryId: CAT, supportRoleId: ROLE,
    buttons: [0, 1, 2, 3, 4].map((i) => BTN("b" + i)),
  });

  // Fenêtre : Discord déjà réduit, base pas encore.
  for (const index of [0, 1, 2, 3, 4]) {
    const fx = makeTicketFixture({ panelRepository });
    const result = await fx.service.createTicket({ guildId: "g", member: { id: "u" + index }, panelId: panel.id, buttonIndex: index });
    assert.equal(result.code, "TICKET_CREATED", "le bouton publié #" + index + " reste résolvable pendant la transition");
    assert.equal(fx.state.record.panel_id, panel.id);
  }

  // Une fois la base réduite, ces mêmes indices ne correspondent plus à rien.
  await panelRepository.updatePanel("g", panel.id, { buttons: [BTN("b0"), BTN("b1")] });
  for (const index of [2, 3, 4]) {
    const fx = makeTicketFixture({ panelRepository });
    const result = await fx.service.createTicket({ guildId: "g", member: { id: "v" + index }, panelId: panel.id, buttonIndex: index });
    assert.equal(result.code, "TICKET_PANEL_UNAVAILABLE", "après réduction, l'indice " + index + " est refusé");
    assert.equal(fx.state.channelCreates, 0);
  }

  // Les boutons toujours publiés continuent de fonctionner.
  const fx = makeTicketFixture({ panelRepository });
  assert.equal((await fx.service.createTicket({ guildId: "g", member: { id: "w" }, panelId: panel.id, buttonIndex: 1 })).code, "TICKET_CREATED");
  assert.equal(fx.state.channelCreates, 1);
});

test("M8 ticket: a missing or deactivated panel is still refused", async () => {
  const panelRepository = new InMemoryTicketPanelRepository();
  const { service, state } = makeTicketFixture({ panelRepository });
  assert.equal((await service.createTicket({ guildId: "g", member: { id: "u1" }, panelId: "404", buttonIndex: 0 })).code, "TICKET_PANEL_UNAVAILABLE");
  assert.equal(state.channelCreates, 0, "aucun salon créé pour un panel inexistant");
});

test("M8 ticket: 23505 on INSERT becomes OPEN_TICKET_EXISTS and rolls back the channel", async () => {
  const uniqueViolation = Object.assign(new Error('duplicate key value violates unique constraint "idx_tickets_open_unique"'), { code: "23505" });
  const { service, state } = makeTicketFixture({ createError: uniqueViolation });
  const result = await service.createTicket({ guildId: "g", member: { id: "u1" } });

  assert.equal(result.code, "OPEN_TICKET_EXISTS", "le double-clic reçoit le bon message");
  assert.equal(state.channelCreates, 1, "le salon avait été créé avant l'insert");
  assert.deepEqual(state.deleted, ["channel-1"], "le salon est nettoyé");
});

test("M8 ticket: a non-23505 insert error still reports PERSISTENCE_ERROR", async () => {
  const outage = Object.assign(new Error("connection reset"), { code: "08006" });
  const { service, state } = makeTicketFixture({ createError: outage });
  const result = await service.createTicket({ guildId: "g", member: { id: "u1" } });
  assert.equal(result.code, "PERSISTENCE_ERROR", "une panne ne doit pas être maquillée en ticket existant");
  assert.deepEqual(state.deleted, ["channel-1"]);
});

test("M8 concurrency: two simultaneous clicks yield exactly one ticket", async () => {
  // Le SELECT puis l'INSERT sont deux allers-retours : sans contrainte en base,
  // les deux passent le SELECT. On simule ici la contrainte idx_tickets_open_unique
  // en faisant échouer le second INSERT en 23505, comme le ferait Postgres.
  let inserted = 0;
  const state = { channelCreates: 0, deleted: [] };
  const repository = {
    findOpen: async () => { await new Promise((r) => setTimeout(r, 20)); return null; },
    create: async (record) => {
      await new Promise((r) => setTimeout(r, 20));
      inserted += 1;
      if (inserted > 1) throw Object.assign(new Error("duplicate key"), { code: "23505" });
      return record;
    },
    findByChannel: async () => null,
    updateByChannel: async () => ({}),
  };
  const transport = {
    getCategory: async (id) => ({ id }),
    getSupportRole: async (id) => ({ id }),
    getMember: async (id) => ({ id, roles: { cache: { has: () => false } } }),
    getBotMember: async () => ({ id: "bot", roles: { highest: { position: 99 } } }),
    createTicketChannel: async () => { state.channelCreates += 1; return { id: `ch-${state.channelCreates}` }; },
    applyTicketOverwrites: async () => ({ applied: true }),
    sendTicketWelcome: async () => ({}),
    deleteTicketChannel: async (id) => { state.deleted.push(id); },
  };
  const service = new TicketService({
    repository, transport,
    configService: { read: async () => ({ tickets_enabled: true, ticket_category_id: GUILD_CAT, ticket_support_role_id: GUILD_ROLE }) },
    counterRepository: { next: async () => 1 },
    channelNamingService: { build: () => "ticket-001" },
  });

  const [a, b] = await Promise.all([
    service.createTicket({ guildId: "g", member: { id: "u1" } }),
    service.createTicket({ guildId: "g", member: { id: "u1" } }),
  ]);
  const codes = [a.code, b.code].sort();
  assert.deepEqual(codes, ["OPEN_TICKET_EXISTS", "TICKET_CREATED"]);
  assert.equal(state.channelCreates, 2, "les deux salons ont été créés avant l'insert");
  assert.deepEqual(state.deleted.length, 1, "le salon du perdant est nettoyé");
});

// ═════════════════════════════════════════════════════════════════════════
// InMemory : même contrat que Supabase.
// ═════════════════════════════════════════════════════════════════════════

test("M8 InMemory: same contract as Supabase (ordering, isolation, deactivation)", async () => {
  const repo = new InMemoryTicketPanelRepository();
  const a = await repo.create({ guildId: "g1", channelId: "c", messageId: "m1", categoryId: CAT, supportRoleId: ROLE, buttons: [BTN("a")] });
  await repo.create({ guildId: "g2", channelId: "c", messageId: "m2", categoryId: CAT, supportRoleId: ROLE, buttons: [BTN("b")] });

  const g1 = await repo.listActive("g1");
  assert.equal(g1.length, 1, "isolation stricte par guilde");
  assert.equal(g1[0].id, a.id);

  assert.equal(await repo.countActive("g1"), 1);
  assert.equal((await repo.deactivate("g1", a.id)).deactivated, true);
  assert.equal(await repo.countActive("g1"), 0);
  assert.equal(await repo.findActive("g1", a.id), null);
  assert.equal(repo.rows.size, 2, "aucune ligne supprimée");
  assert.equal((await repo.deactivate("g1", a.id)).deactivated, false, "idempotent");
});

test("M8 InMemory: listActive sorts numerically, not lexicographically", async () => {
  const repo = new InMemoryTicketPanelRepository();
  for (let i = 0; i < 11; i += 1) {
    await repo.create({ guildId: "g", channelId: "c", messageId: `m${i}`, categoryId: CAT, supportRoleId: ROLE, buttons: [BTN("a")] });
  }
  const ids = (await repo.listActive("g")).map((p) => p.id);
  assert.deepEqual(ids, ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"]);
  assert.ok(ids.indexOf("10") > ids.indexOf("9"), "un tri lexicographique placerait 10 avant 9");
});

test("M8 InMemory: the 10-panel ceiling is enforced", async () => {
  const repo = new InMemoryTicketPanelRepository();
  for (let i = 0; i < MAX_PANELS_PER_GUILD; i += 1) {
    assert.equal(await repo.canCreate("g"), true, `panel ${i + 1}`);
    await repo.create({ guildId: "g", channelId: "c", messageId: `m${i}`, categoryId: CAT, supportRoleId: ROLE, buttons: [BTN("a")] });
  }
  assert.equal(await repo.canCreate("g"), false, "11e panel refusé");
  // Désactiver libère une place.
  await repo.deactivate("g", "1");
  assert.equal(await repo.canCreate("g"), true);
});
