#!/usr/bin/env node
"use strict";

/**
 * PHASE 0 — lanceur de suite de tests déterministe.
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * Avant la Phase 0, la suite était découpée en scripts npm par « phase »
 * (`test:core`, `test:adapters`, `test:guild-settings`, `test:welcome-goodbye`)
 * dont les globs étaient maintenus à la main. Résultat mesuré : 86 fichiers
 * `*.test.js` sur 265 étaient atteignables, et il n'existait AUCUN `npm test`.
 * 179 fichiers — dont toute la suite Logs, Modération, Tickets, AutoRole,
 * Security, XP, Captcha, Admin Panel — ne tournaient que si on les invoquait
 * un par un à la main.
 *
 * Ce lanceur supprime la dérive des globs : il DÉCOUVRE les fichiers de test
 * sur le disque au lieu de les énumérer. Ajouter un `*.test.js` n'importe où
 * dans le dépôt l'intègre automatiquement à `npm test`, sans éditer package.json.
 *
 * GARANTIES
 * ---------
 *  • Exhaustivité : tout `*.test.js` hors répertoires ignorés est découvert.
 *  • Déterminisme : tri octet par octet sur le chemin POSIX relatif ; aucune
 *    dépendance à l'ordre du système de fichiers ni à la locale.
 *  • Échec bruyant : un filtre qui ne correspond à AUCUN fichier fait échouer
 *    la commande (exit 1). Un script npm qui ne lance rien ne doit jamais
 *    ressembler à un succès.
 *  • cwd : la racine du dépôt. Plusieurs tests existants lisent des chemins
 *    relatifs (`fs.readFileSync("src/events/…")`) : le cwd est donc un contrat,
 *    pas un détail.
 *
 * USAGE
 * -----
 *   node scripts/run-tests.js                     # toute la suite
 *   node scripts/run-tests.js src/modules/logs    # filtre(s) par sous-chaîne
 *   node scripts/run-tests.js --list              # liste les fichiers, n'exécute rien
 *   node scripts/run-tests.js --list --json       # sortie machine
 *   node scripts/run-tests.js -- --test-concurrency=1   # arguments passés à node --test
 *
 * Ce module n'a AUCUN effet de bord à l'import : il est requis par
 * test/phase0/test-suite-coverage.test.js pour comparer la découverte au
 * contenu réel du disque.
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

/** Répertoires jamais parcourus (mêmes exclusions que scripts/verify-static.js). */
const IGNORED_DIRECTORIES = Object.freeze(new Set([
  ".git",
  "node_modules",
  "coverage",
  "build",
  "dist",
  "out",
  ".cache",
  ".next",
  ".nyc_output",
]));

const TEST_FILE_SUFFIX = ".test.js";

/** Chemin POSIX relatif à la racine du dépôt : stable quel que soit l'OS. */
function toRelativePosix(absolutePath) {
  return path.relative(ROOT, absolutePath).split(path.sep).join("/");
}

/**
 * Découvre tous les fichiers `*.test.js` du dépôt, triés de façon déterministe.
 *
 * @param {string} [directory] point de départ (défaut : racine du dépôt)
 * @returns {string[]} chemins absolus, triés par chemin relatif
 */
function discoverTestFiles(directory = ROOT) {
  const found = [];

  const walk = (current) => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        walk(full);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(TEST_FILE_SUFFIX)) found.push(full);
    }
  };

  walk(directory);

  // Tri octet par octet sur le chemin relatif : indépendant de la locale et de
  // l'ordre dans lequel le système de fichiers rend les entrées.
  found.sort((a, b) => {
    const left = toRelativePosix(a);
    const right = toRelativePosix(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });

  return found;
}

/**
 * Applique des filtres par sous-chaîne sur le chemin relatif POSIX.
 * Aucun filtre → tout est retenu.
 *
 * @param {string[]} files chemins absolus
 * @param {string[]} filters sous-chaînes
 * @returns {{selected: string[], unmatched: string[]}}
 */
function applyFilters(files, filters) {
  if (!Array.isArray(filters) || filters.length === 0) {
    return { selected: files, unmatched: [] };
  }
  const normalized = filters.map((filter) => filter.split(path.sep).join("/"));
  const selected = files.filter((file) => {
    const relative = toRelativePosix(file);
    return normalized.some((filter) => relative.includes(filter));
  });
  const unmatched = normalized.filter((filter) => !files.some((file) => toRelativePosix(file).includes(filter)));
  return { selected, unmatched };
}

/** Sépare drapeaux du lanceur, filtres, et arguments destinés à `node --test`. */
function parseArgs(argv) {
  const flags = { list: false, json: false };
  const filters = [];
  const nodeArgs = [];
  let passthrough = false;

  for (const argument of argv) {
    if (passthrough) {
      nodeArgs.push(argument);
      continue;
    }
    if (argument === "--") {
      passthrough = true;
      continue;
    }
    if (argument === "--list") {
      flags.list = true;
      continue;
    }
    if (argument === "--json") {
      flags.json = true;
      continue;
    }
    if (argument.startsWith("--")) {
      nodeArgs.push(argument);
      continue;
    }
    filters.push(argument);
  }

  return { flags, filters, nodeArgs };
}

function main(argv) {
  const { flags, filters, nodeArgs } = parseArgs(argv);
  const discovered = discoverTestFiles();
  const { selected, unmatched } = applyFilters(discovered, filters);

  if (unmatched.length > 0) {
    // Échec bruyant : un script npm dont le filtre ne correspond à rien ne doit
    // pas pouvoir passer pour un succès vert.
    console.error(`Test filter(s) matched no file: ${unmatched.join(", ")}`);
    console.error(`Discovered ${discovered.length} test file(s) under ${toRelativePosix(ROOT) || "."}`);
    return 1;
  }

  if (selected.length === 0) {
    console.error("No test file discovered — refusing to report a green run.");
    return 1;
  }

  if (flags.list) {
    if (flags.json) {
      console.log(JSON.stringify({
        root: toRelativePosix(ROOT) || ".",
        discovered: discovered.length,
        selected: selected.length,
        filters,
        files: selected.map(toRelativePosix),
      }, null, 2));
    } else {
      for (const file of selected) console.log(toRelativePosix(file));
      console.error(`Discovered ${discovered.length} test file(s); selected ${selected.length}.`);
    }
    return 0;
  }

  const relativeFilters = filters.length > 0 ? ` (filters: ${filters.join(", ")})` : "";
  console.log(`[run-tests] executing ${selected.length} of ${discovered.length} test file(s)${relativeFilters}`);

  const result = spawnSync(
    process.execPath,
    ["--test", ...nodeArgs, ...selected],
    { cwd: ROOT, stdio: "inherit" }
  );

  if (result.error) {
    console.error(`[run-tests] failed to start node --test: ${result.error.message}`);
    return 1;
  }
  if (result.signal) {
    console.error(`[run-tests] node --test terminated by signal ${result.signal}`);
    return 1;
  }
  return typeof result.status === "number" ? result.status : 1;
}

module.exports = {
  ROOT,
  IGNORED_DIRECTORIES,
  TEST_FILE_SUFFIX,
  discoverTestFiles,
  applyFilters,
  parseArgs,
  toRelativePosix,
  main,
};

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
