"use strict";

/**
 * PHASE 0 — non-régression du harnais de test lui-même.
 *
 * Ce fichier est le garde-fou de la Phase 0 : il vérifie que `npm test` exécute
 * réellement TOUS les fichiers `*.test.js` du dépôt, et qu'aucun script npm ne
 * pointe vers un ensemble vide ou hors du dépôt.
 *
 * Avant la Phase 0, 179 fichiers de test sur 265 n'étaient atteignables par
 * aucun script npm. Ce test rend cette régression impossible : la découverte du
 * lanceur est comparée à un parcours indépendant du disque.
 *
 * Aucun comportement du bot n'est vérifié ici — uniquement l'outillage.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const runner = require("../../scripts/run-tests");

const ROOT = path.resolve(__dirname, "..", "..");

/** Nombre de fichiers `*.test.js` AVANT la Phase 0. Plancher anti-suppression. */
const PRE_PHASE0_TEST_FILE_COUNT = 265;

/**
 * Parcours indépendant du disque — volontairement écrit SANS réutiliser
 * `discoverTestFiles`, sinon le test validerait le lanceur contre lui-même.
 */
function walkFromDisk(directory = ROOT) {
  const found = [];
  const skip = new Set([".git", "node_modules", "coverage", "build", "dist", "out", ".cache"]);
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) walk(full);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".test.js")) found.push(full);
    }
  };
  walk(directory);
  return found.map((file) => path.relative(ROOT, file).split(path.sep).join("/")).sort();
}

const fromRunner = runner.discoverTestFiles().map(runner.toRelativePosix);
const fromDisk = walkFromDisk();

test("PHASE0 — la découverte du lanceur couvre exactement le contenu du disque", () => {
  assert.deepEqual(
    fromRunner,
    fromDisk,
    "scripts/run-tests.js doit découvrir exactement les *.test.js présents sur le disque"
  );
});

test("PHASE0 — le plancher pré-Phase 0 est respecté (aucune suppression silencieuse)", () => {
  assert.ok(
    fromRunner.length >= PRE_PHASE0_TEST_FILE_COUNT,
    `attendu >= ${PRE_PHASE0_TEST_FILE_COUNT} fichiers de test, obtenu ${fromRunner.length}`
  );
});

test("PHASE0 — la découverte est déterministe (ordre stable entre deux appels)", () => {
  const again = runner.discoverTestFiles().map(runner.toRelativePosix);
  assert.deepEqual(again, fromRunner, "deux appels doivent produire le même ordre");
});

test("PHASE0 — aucun fichier de test ne vit hors de src/ ou test/", () => {
  const outside = fromRunner.filter((file) => !file.startsWith("src/") && !file.startsWith("test/"));
  assert.deepEqual(outside, [], `fichiers hors périmètre: ${outside.join(", ")}`);
});

test("PHASE0 — chaque répertoire contenant des tests contribue au moins un fichier découvert", () => {
  const directories = new Set(fromDisk.map((file) => path.posix.dirname(file)));
  const discoveredDirectories = new Set(fromRunner.map((file) => path.posix.dirname(file)));
  const missing = [...directories].filter((directory) => !discoveredDirectories.has(directory));
  assert.deepEqual(missing, [], `répertoires de tests non découverts: ${missing.join(", ")}`);
});

test("PHASE0 — les modules métier historiquement non couverts sont désormais découverts", () => {
  // Les 15 modules dont AUCUN test n'était atteignable par un script npm avant
  // la Phase 0. Leur présence dans la découverte est l'objectif même de la phase.
  const previouslyUncovered = [
    "src/modules/logs/tests",
    "src/modules/moderation/tests",
    "src/modules/tickets/tests",
    "src/modules/autorole/tests",
    "src/modules/security/tests",
    "src/modules/captcha/tests",
    "src/modules/xp/tests",
    "src/modules/analytics/tests",
    "src/modules/admin-panel/tests",
    "src/modules/owner-panel/tests",
    "src/modules/recovery/tests",
    "src/modules/tempvoice/tests",
    "src/modules/invites/tests",
    "src/modules/giveaways/tests",
    "src/modules/suggestions/tests",
    "src/modules/sticker/tests",
    "src/config/tests",
    "src/services/tests",
    "src/utils/tests",
    "test/events",
    "test/adapters/supabase",
  ];
  for (const directory of previouslyUncovered) {
    const count = fromRunner.filter((file) => file.startsWith(`${directory}/`)).length;
    assert.ok(count > 0, `aucun test découvert sous ${directory}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Scripts npm : aucun ne doit pointer vers un ensemble vide ou hors dépôt
// ─────────────────────────────────────────────────────────────────────────────

function npmScripts() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts;
}

/** Extrait les filtres passés à scripts/run-tests.js dans une commande npm. */
function runnerFiltersOf(command) {
  const match = /node\s+scripts\/run-tests\.js\s*([^&]*)$/.exec(command.trim());
  if (!match) return null;
  return match[1].split(/\s+/).filter(Boolean).filter((token) => !token.startsWith("--"));
}

test("PHASE0 — `npm test` existe, lance le lanceur et sans filtre (suite complète)", () => {
  const scripts = npmScripts();
  assert.ok(scripts.test, "le script `test` est absent de package.json");
  assert.match(scripts.test, /node\s+scripts\/run-tests\.js\s*$/, "`npm test` doit lancer toute la suite, sans filtre");
});

test("PHASE0 — chaque script npm scopé résout au moins un fichier de test", () => {
  const scripts = npmScripts();
  const scoped = Object.entries(scripts).filter(
    ([name, command]) => name.startsWith("test:") && command.includes("scripts/run-tests.js") && !command.includes("--list")
  );
  assert.ok(scoped.length > 0, "aucun script npm scopé trouvé");

  for (const [name, command] of scoped) {
    const filters = runnerFiltersOf(command);
    assert.ok(filters, `${name}: filtres introuvables dans « ${command} »`);
    const { selected, unmatched } = runner.applyFilters(runner.discoverTestFiles(), filters);
    assert.deepEqual(unmatched, [], `${name}: filtre(s) sans correspondance — ${unmatched.join(", ")}`);
    assert.ok(selected.length > 0, `${name}: ne sélectionne aucun fichier de test`);
  }
});

test("PHASE0 — l'union des scripts scopés reste un sous-ensemble de la suite complète", () => {
  const scripts = npmScripts();
  const all = new Set(fromRunner);
  for (const [name, command] of Object.entries(scripts)) {
    if (!name.startsWith("test:") || !command.includes("scripts/run-tests.js") || command.includes("--list")) continue;
    const filters = runnerFiltersOf(command);
    if (!filters) continue;
    for (const file of runner.applyFilters(runner.discoverTestFiles(), filters).selected) {
      const relative = runner.toRelativePosix(file);
      assert.ok(all.has(relative), `${name} sélectionne ${relative}, absent de la découverte complète`);
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Contrat du lanceur : un filtre mort doit échouer, pas passer au vert
// ─────────────────────────────────────────────────────────────────────────────

test("PHASE0 — un filtre sans correspondance est signalé comme non apparié", () => {
  const { selected, unmatched } = runner.applyFilters(runner.discoverTestFiles(), ["src/modules/poker"]);
  assert.equal(selected.length, 0);
  assert.deepEqual(unmatched, ["src/modules/poker"]);
});

/** Neutralise stdout/stderr le temps d'un appel : la sortie du lanceur n'est pas l'objet du test. */
function captureConsole(fn) {
  const originalLog = console.log;
  const originalError = console.error;
  const lines = [];
  console.log = (...args) => lines.push(args.join(" "));
  console.error = (...args) => lines.push(args.join(" "));
  try {
    return { result: fn(), lines };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

test("PHASE0 — main() renvoie un code d'échec non nul sur filtre mort", () => {
  const { result, lines } = captureConsole(() => runner.main(["--list", "src/modules/poker"]));
  assert.equal(result, 1, "un filtre qui ne matche rien doit faire échouer la commande");
  assert.ok(
    lines.some((line) => line.includes("matched no file")),
    "le motif d'échec doit être explicitement nommé, pas silencieux"
  );
});

test("PHASE0 — main() renvoie 0 en mode --list sur un filtre valide", () => {
  const { result, lines } = captureConsole(() => runner.main(["--list", "test/phase0"]));
  assert.equal(result, 0);
  assert.ok(
    lines.some((line) => line.includes("test/phase0/test-suite-coverage.test.js")),
    "le mode --list doit lister les fichiers réellement sélectionnés"
  );
});

test("PHASE0 — parseArgs sépare drapeaux, filtres et arguments passés à node --test", () => {
  const parsed = runner.parseArgs(["--list", "--json", "src/modules/logs", "--", "--test-concurrency=1"]);
  assert.equal(parsed.flags.list, true);
  assert.equal(parsed.flags.json, true);
  assert.deepEqual(parsed.filters, ["src/modules/logs"]);
  assert.deepEqual(parsed.nodeArgs, ["--test-concurrency=1"]);
});

test("PHASE0 — les répertoires générés sont exclus de la découverte", () => {
  for (const directory of ["node_modules", ".git", "coverage", "dist", "build"]) {
    assert.ok(runner.IGNORED_DIRECTORIES.has(directory), `${directory} doit être exclu`);
  }
  assert.ok(
    fromRunner.every((file) => !file.includes("node_modules/")),
    "aucun test de node_modules ne doit être découvert"
  );
});
