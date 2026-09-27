"use strict";

/**
 * P8 — détection liens / invitations / normalisation de détection.
 *
 * Couverture GO §9 :
 *  • liens : http, https, www, hxxp, hxxps, casse, ports, chemin, query,
 *    fragment, points obfusqués ([.] ． 。 ｡), ZWSP/Cf, frontière `www` ;
 *  • invitations : discord.gg, discord(dapp).com/invite(S), protocoles, www,
 *    casse, points obfusqués, espaces obfusqués, ZWSP/Cf ;
 *  • non-régression : domaine nu, FTP/mailto, percent-encoding, homoglyphes,
 *    priorité LINK > INVITE ;
 *  • messageCreate/messageUpdate : parité des codes sur formes obfusquées,
 *    guards P1 inchangées ;
 *  • faux positifs : nowww / ftp / mailto / prose `www` sans vraie URL.
 *
 * Hors ligne : aucun Discord, aucun Supabase, aucun Pterodactyl.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AutoModDetectionService,
  normalizeForDetection,
} = require("../services/AutoModDetectionService");
const { createAutoModRuntime } = require("../runtime/createAutoModRuntime");
const { AutoModEnforcementService } = require("../services/AutoModEnforcementService");

const GUILD = "800000000000000001";
const AUTHOR = "800000000000000002";

const LINKS_ONLY = { automod_enabled: true, automod_anti_links: true, automod_anti_invites: false };
const INVITES_ONLY = { automod_enabled: true, automod_anti_links: false, automod_anti_invites: true };
const BOTH = { automod_enabled: true, automod_anti_links: true, automod_anti_invites: true };

function detect(config, content) {
  const svc = new AutoModDetectionService({ store: new Map() });
  return svc.detect({ guildId: GUILD, authorId: AUTHOR, content, mentionCount: 0, config });
}

function code(config, content) {
  return detect(config, content).code;
}

// ════════════════════════════════════════════════════════════════════════════
// NORMALISATION DÉTECTION-ONLY
// ════════════════════════════════════════════════════════════════════════════

test("normalizeForDetection : NFKD + casse + strip \\p{Cf} + points obfusqués + espace avant point", () => {
  // Casse + fullwidth (NFKD) + crochets.
  assert.equal(normalizeForDetection("WWW[.]EXAMPLE[.]COM"), "www.example.com");
  assert.equal(normalizeForDetection("www．example.com"), "www.example.com"); // U+FF0E plié par NFKD
  assert.equal(normalizeForDetection("www。example.com"), "www.example.com"); // U+3002 replié
  assert.equal(normalizeForDetection("www｡example.com"), "www.example.com"); // U+FF61 → U+3002 → replié
  // Caractères de format.
  assert.equal(normalizeForDetection("www​.example.com"), "www.example.com"); // ZWSP
  assert.equal(normalizeForDetection("www­.example.com"), "www.example.com"); // soft hyphen
  assert.equal(normalizeForDetection("﻿www.example.com"), "www.example.com"); // BOM
  // Espace obfusqué immédiatement avant un point (forme exigée `discord .gg`).
  assert.equal(normalizeForDetection("discord .gg/abc"), "discord.gg/abc");
  // Phrase ordinaire : l'espace avant www n'est PAS supprimé (pas de joignage).
  assert.equal(normalizeForDetection("see www.example.com"), "see www.example.com");
});

test("normalizeForDetection : interdits P8 — homoglyphes, %XX non décodés", () => {
  // Aucun mapping d'homoglyphe : le cyrillique reste cyrillique.
  const homoglyph = normalizeForDetection("і"); // і cyrillique (U+0456)
  assert.equal(homoglyph, "і");
  assert.notEqual(normalizeForDetection("dіscord.gg"), "discord.gg");
  // Pas de décodage percent : `%3A` ne devient pas `:`.
  const encoded = normalizeForDetection("https%3A%2F%2Fexample.com");
  assert.equal(encoded, "https%3a%2f%2fexample.com");
  assert.ok(!encoded.includes("https:"), "aucun décodage %XX");
  // Pas de new URL(), pas de table de confusables : test comportemental ci-dessus.
});

// ════════════════════════════════════════════════════════════════════════════
// LIENS
// ════════════════════════════════════════════════════════════════════════════

test("liens : formes standard http/https/www + casse + ports/chemin/query/fragment", () => {
  assert.equal(code(LINKS_ONLY, "https://example.com"), "AUTOMOD_LINK");
  assert.equal(code(LINKS_ONLY, "http://example.com"), "AUTOMOD_LINK");
  assert.equal(code(LINKS_ONLY, "www.example.com"), "AUTOMOD_LINK");
  assert.equal(code(LINKS_ONLY, "HTTPS://EXAMPLE.COM"), "AUTOMOD_LINK");
  assert.equal(code(LINKS_ONLY, "see WWW.Example.COM now"), "AUTOMOD_LINK");
  assert.equal(code(LINKS_ONLY, "https://example.com:8443/a/b?x=1&y=2#frag"), "AUTOMOD_LINK");
  assert.equal(code(LINKS_ONLY, "sub.example.tld path https://deep.sub.host/p"), "AUTOMOD_LINK");
  assert.equal(code(LINKS_ONLY, "visite (https://example.com) svp"), "AUTOMOD_LINK");
});

test("liens : hxxp / hxxps détectés (obfuscation de protocole), casse comprise", () => {
  assert.equal(code(LINKS_ONLY, "hxxp://example.com"), "AUTOMOD_LINK");
  assert.equal(code(LINKS_ONLY, "hxxps://example.com"), "AUTOMOD_LINK");
  assert.equal(code(LINKS_ONLY, "HXXP://EXAMPLE.COM/path"), "AUTOMOD_LINK");
  assert.equal(code(LINKS_ONLY, "hXxPs://example.com?q=1"), "AUTOMOD_LINK");
});

test("liens : points obfusqués [.] ． 。 ｡", () => {
  assert.equal(code(LINKS_ONLY, "www[.]example[.]com"), "AUTOMOD_LINK");
  assert.equal(code(LINKS_ONLY, "www．example.com"), "AUTOMOD_LINK"); // fullwidth
  assert.equal(code(LINKS_ONLY, "www。example.com"), "AUTOMOD_LINK"); // idéographique
  assert.equal(code(LINKS_ONLY, "www｡example.com"), "AUTOMOD_LINK"); // halfwidth idéographique
  assert.equal(code(LINKS_ONLY, "hxxp://evil[.]example[.]com"), "AUTOMOD_LINK");
});

test("liens : ZWSP et caractères de format \\p{Cf} dans la séquence", () => {
  assert.equal(code(LINKS_ONLY, "www​.example.com"), "AUTOMOD_LINK"); // ZWSP avant le point
  assert.equal(code(LINKS_ONLY, "www.​example.com"), "AUTOMOD_LINK"); // ZWSP après le point
  assert.equal(code(LINKS_ONLY, "ww​w.example.com"), "AUTOMOD_LINK"); // ZWSP au milieu de www
  assert.equal(code(LINKS_ONLY, "www­.example.com"), "AUTOMOD_LINK"); // soft hyphen
  assert.equal(code(LINKS_ONLY, "https://exa​mple.com"), "AUTOMOD_LINK"); // ZWSP dans l'hôte
});

test("liens : frontière devant www. — nowww / mywww non détectés, formes légitimes détectées", () => {
  assert.equal(code(LINKS_ONLY, "nowww.example.com"), "AUTOMOD_NO_MATCH");
  assert.equal(code(LINKS_ONLY, "mywww.example"), "AUTOMOD_NO_MATCH");
  assert.equal(code(LINKS_ONLY, "3www.example.com"), "AUTOMOD_NO_MATCH");
  assert.equal(code(LINKS_ONLY, "see www.example.com"), "AUTOMOD_LINK");
  assert.equal(code(LINKS_ONLY, "www.example.com"), "AUTOMOD_LINK", "début de message");
  assert.equal(code(LINKS_ONLY, "[www.example.com]"), "AUTOMOD_LINK");
});

// ════════════════════════════════════════════════════════════════════════════
// INVITATIONS
// ════════════════════════════════════════════════════════════════════════════

test("invites : les 5 hôtes requis sont détectés", () => {
  assert.equal(code(INVITES_ONLY, "discord.gg/abc"), "AUTOMOD_INVITE");
  assert.equal(code(INVITES_ONLY, "discord.com/invite/abc"), "AUTOMOD_INVITE");
  assert.equal(code(INVITES_ONLY, "discordapp.com/invite/abc"), "AUTOMOD_INVITE");
  assert.equal(code(INVITES_ONLY, "discord.com/invites/abc"), "AUTOMOD_INVITE");
  assert.equal(code(INVITES_ONLY, "discordapp.com/invites/abc"), "AUTOMOD_INVITE");
});

test("invites : protocoles, www et casse", () => {
  assert.ok(detect(BOTH, "https://discord.gg/abc").rules.includes("AUTOMOD_INVITE"), "invite détectée même derrière https");
  assert.equal(code(INVITES_ONLY, "https://discord.com/invites/abc"), "AUTOMOD_INVITE");
  assert.equal(code(INVITES_ONLY, "http://discord.gg/abc"), "AUTOMOD_INVITE");
  assert.equal(code(INVITES_ONLY, "www.discord.gg/abc"), "AUTOMOD_INVITE");
  assert.equal(code(INVITES_ONLY, "DISCORD.GG/ABC"), "AUTOMOD_INVITE");
  assert.equal(code(INVITES_ONLY, "Discord.Com/Invites/AbC"), "AUTOMOD_INVITE");
});

test("invites : points obfusqués couverts par la normalisation", () => {
  assert.equal(code(INVITES_ONLY, "discord[.]gg/abc"), "AUTOMOD_INVITE");
  assert.equal(code(INVITES_ONLY, "discord．gg/abc"), "AUTOMOD_INVITE");
  assert.equal(code(INVITES_ONLY, "discord。gg/abc"), "AUTOMOD_INVITE");
  assert.equal(code(INVITES_ONLY, "discord｡gg/abc"), "AUTOMOD_INVITE");
  assert.equal(code(INVITES_ONLY, "discord[.]com/invites/abc"), "AUTOMOD_INVITE");
});

test("invites : espace obfusqué `discord .gg/abc`", () => {
  assert.equal(code(INVITES_ONLY, "discord .gg/abc"), "AUTOMOD_INVITE");
  assert.equal(code(BOTH, "discord .gg/abc"), "AUTOMOD_INVITE", "ni le lien ni un autre règle ne doit primer ici");
});

test("invites : ZWSP / caractères de format dans la chaîne", () => {
  assert.equal(code(INVITES_ONLY, "discord​.gg/abc"), "AUTOMOD_INVITE"); // ZWSP avant le point
  assert.equal(code(INVITES_ONLY, "disc​ord.gg/abc"), "AUTOMOD_INVITE"); // ZWSP dans l'hôte
  assert.equal(code(INVITES_ONLY, "discord.gg/​abc"), "AUTOMOD_INVITE"); // ZWSP après le slash
  assert.equal(code(INVITES_ONLY, "discord.gg/ab­c"), "AUTOMOD_INVITE"); // soft hyphen dans le code
});

test("invites : jeu de code [\u005cw-] et ponctuation conservés", () => {
  assert.equal(code(INVITES_ONLY, "discord.gg/abc-def_123"), "AUTOMOD_INVITE");
  assert.equal(code(INVITES_ONLY, "join discord.gg/abc, vite !"), "AUTOMOD_INVITE");
  assert.equal(code(INVITES_ONLY, "discord.gg/abc?event=1"), "AUTOMOD_INVITE");
});

// ════════════════════════════════════════════════════════════════════════════
// NON-RÉGRESSION (contrats P8 §5)
// ════════════════════════════════════════════════════════════════════════════

test("non-régression : domaine nu, sous-domaine, IP seuls restent NON détectés", () => {
  assert.equal(code(BOTH, "example.com"), "AUTOMOD_NO_MATCH");
  assert.equal(code(BOTH, "sub.example.com"), "AUTOMOD_NO_MATCH");
  assert.equal(code(BOTH, "rejoignez t.co/abc123"), "AUTOMOD_NO_MATCH");
  assert.equal(code(BOTH, "192.168.1.1:8080"), "AUTOMOD_NO_MATCH");
});

test("non-régression : FTP, mailto, proto-relatif restent NON détectés", () => {
  assert.equal(code(BOTH, "ftp://example.com"), "AUTOMOD_NO_MATCH");
  assert.equal(code(BOTH, "mailto:example@example.com"), "AUTOMOD_NO_MATCH");
  assert.equal(code(BOTH, "//example.com/path"), "AUTOMOD_NO_MATCH");
});

test("non-régression : URL percent-encodée NON détectée (aucun décodage)", () => {
  assert.equal(code(BOTH, "https%3A%2F%2Fexample.com"), "AUTOMOD_NO_MATCH");
  assert.equal(code(BOTH, "discord.gg%2Fabc"), "AUTOMOD_NO_MATCH");
  assert.equal(code(BOTH, "https%3A%2F%2Fdiscord.gg%2Fabc"), "AUTOMOD_NO_MATCH");
});

test("non-régression : homoglyphes non mappés restent NON détectés", () => {
  assert.equal(code(BOTH, "dіscord.gg/abc"), "AUTOMOD_NO_MATCH"); // і cyrillique
  assert.equal(code(BOTH, "еxample.com"), "AUTOMOD_NO_MATCH"); // е cyrillique
  assert.equal(code(BOTH, "аdmin www.exаmple.com"), "AUTOMOD_LINK", "www. littéral reste détecté, l'homoglyphe n'est pas requis");
});

test("non-régression : priorité LINK > INVITE intacte sur https://discord.gg/abc", () => {
  const r = detect(BOTH, "https://discord.gg/abc");
  assert.equal(r.code, "AUTOMOD_LINK");
  assert.deepEqual(r.rules, ["AUTOMOD_LINK", "AUTOMOD_INVITE"]);
  // Ordre complet inchangé (contrat P2/P8 : SPAM > LINK > INVITE > …).
  const svc = new AutoModDetectionService({ store: new Map() });
  const priority = svc.detect({
    guildId: GUILD,
    authorId: AUTHOR,
    content: "https://discord.gg/abc hi",
    mentionCount: 10,
    config: { ...BOTH, automod_anti_mention_spam: true, automod_mention_threshold: 2 },
  });
  assert.deepEqual(priority.rules, ["AUTOMOD_LINK", "AUTOMOD_INVITE", "AUTOMOD_MENTION_SPAM"]);
  assert.equal(priority.code, "AUTOMOD_LINK");
});

test("non-régression : flags OFF — aucune détection obfusquée ou non", () => {
  const off = { automod_enabled: true, automod_anti_links: false, automod_anti_invites: false };
  assert.equal(code(off, "https://example.com"), "AUTOMOD_NO_MATCH");
  assert.equal(code(off, "hxxp://example.com"), "AUTOMOD_NO_MATCH");
  assert.equal(code(off, "discord[.]gg/abc"), "AUTOMOD_NO_MATCH");
  assert.equal(code({ automod_enabled: true }, "discord.gg/abc"), "AUTOMOD_NO_MATCH", "defaults = règles inactives");
});

// ════════════════════════════════════════════════════════════════════════════
// FAUX POSITIFS (§7)
// ════════════════════════════════════════════════════════════════════════════

test("FP : nowww / ftp / mailto / prose www sans vraie URL → NON détectés", () => {
  assert.equal(code(BOTH, "nowww.example.com"), "AUTOMOD_NO_MATCH");
  assert.equal(code(BOTH, "mywww.example"), "AUTOMOD_NO_MATCH");
  assert.equal(code(BOTH, "ftp://example.com/file"), "AUTOMOD_NO_MATCH");
  assert.equal(code(BOTH, "mailto:contact@example.com"), "AUTOMOD_NO_MATCH");
  assert.equal(code(BOTH, "le www est un raccourci courant"), "AUTOMOD_NO_MATCH", "www sans point");
  assert.equal(code(BOTH, "www. et rien d'autre"), "AUTOMOD_NO_MATCH", "www. suivi d'une espace");
  assert.equal(code(BOTH, "comme wwwman et 3www sans suite"), "AUTOMOD_NO_MATCH");
});

// ════════════════════════════════════════════════════════════════════════════
// MESSAGECREATE / MESSAGEUPDATE (§6) — choke point process() inchangé
// ════════════════════════════════════════════════════════════════════════════

function makeHarness(config) {
  const enforcerCalls = { deleted: [] };
  const moderationLogs = [];
  const runtime = createAutoModRuntime({
    configService: { read: async () => ({ automod_enabled: true, ...config }) },
    detection: new AutoModDetectionService({ store: new Map() }),
    enforcementService: new AutoModEnforcementService({ logger: { warn: () => {} } }),
    enforcerFactory: () => ({
      deleteMessage: async (message) => { enforcerCalls.deleted.push(message.id); },
      timeoutUser: async () => ({ ok: true }),
      warnUser: async () => ({ ok: true }),
    }),
    logsRuntimeFactory: () => ({ disabled: false, handleModerationEvent: async (e) => moderationLogs.push(e) }),
  });
  return { runtime, enforcerCalls, moderationLogs };
}

function makeMessage({ id = "m1", content = "" } = {}) {
  const roleSet = new Set();
  return {
    id,
    guild: { id: GUILD },
    author: { id: AUTHOR, bot: false },
    channelId: "800000000000000900",
    member: {
      permissions: { has: () => false },
      roles: { cache: { has: (roleId) => roleSet.has(roleId) } },
    },
    content,
    mentions: { users: { size: 0 } },
    partial: false,
  };
}

test("messageCreate : lien obfusqué sanctionné, invite obfusquée sanctionnée", async () => {
  const h1 = makeHarness({ automod_anti_links: true, automod_delete_message: true });
  const link = await h1.runtime.handleMessage(makeMessage({ id: "c1", content: "pile là www[.]example[.]com !" }));
  assert.equal(link.matched, true);
  assert.equal(link.code, "AUTOMOD_LINK");
  assert.deepEqual(h1.enforcerCalls.deleted, ["c1"]);
  assert.equal(h1.moderationLogs.length, 1);
  assert.equal(h1.moderationLogs[0].rule, "AUTOMOD_LINK");

  const h2 = makeHarness({ automod_anti_invites: true, automod_delete_message: true });
  const invite = await h2.runtime.handleMessage(makeMessage({ id: "c2", content: "viens discord .gg/abc" }));
  assert.equal(invite.matched, true);
  assert.equal(invite.code, "AUTOMOD_INVITE");
  assert.deepEqual(h2.enforcerCalls.deleted, ["c2"]);
  assert.equal(h2.moderationLogs[0].rule, "AUTOMOD_INVITE");
});

test("messageUpdate : parité des codes avec messageCreate sur formes obfusquées", async () => {
  const obfuscated = [
    ["www[.]example[.]com", { automod_anti_links: true }, "AUTOMOD_LINK"],
    ["hxxp://example.com", { automod_anti_links: true }, "AUTOMOD_LINK"],
    ["discord[.]gg/abc", { automod_anti_invites: true }, "AUTOMOD_INVITE"],
    ["discord​.gg/abc", { automod_anti_invites: true }, "AUTOMOD_INVITE"],
  ];
  let i = 0;
  for (const [content, config, expected] of obfuscated) {
    i += 1;
    // create
    const h = makeHarness({ ...config, automod_delete_message: false });
    const created = await h.runtime.handleMessage(makeMessage({ id: `p${i}`, content }));
    assert.equal(created.code, expected, `create: ${JSON.stringify(content)}`);
    // update (contenu propre → contenu obfusqué)
    const edited = await h.runtime.handleMessageEdited(
      makeMessage({ id: `e${i}`, content: "bonjour" }),
      makeMessage({ id: `e${i}`, content }),
    );
    assert.equal(edited.code, expected, `update: ${JSON.stringify(content)}`);
    assert.equal(edited.code, created.code, `parité create/update pour ${JSON.stringify(content)}`);
  }
});

test("messageUpdate : garde P1 inchangée sur forme obfusquée (identique/partiel → IGNORED)", async () => {
  const h = makeHarness({ automod_anti_links: true, automod_delete_message: true });
  const obfuscated = makeMessage({ id: "g1", content: "www[.]example[.]com" });
  // Contenu identique → aucune exécution (comparaison brute P1).
  const unchanged = await h.runtime.handleMessageEdited(obfuscated, obfuscated);
  assert.equal(unchanged.matched, false);
  assert.equal(unchanged.code, "AUTOMOD_IGNORED");
  // Partiel → abstention P1.
  const partial = await h.runtime.handleMessageEdited({ ...obfuscated, partial: true }, obfuscated);
  assert.equal(partial.code, "AUTOMOD_IGNORED");
  // old absent → abstention P1.
  const noOld = await h.runtime.handleMessageEdited(null, obfuscated);
  assert.equal(noOld.code, "AUTOMOD_IGNORED");
  assert.equal(h.enforcerCalls.deleted.length, 0, "aucune sanction sans exécution réelle");
  assert.equal(h.moderationLogs.length, 0);
});
