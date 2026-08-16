"use strict";

// CIVRAT — single launcher for Bot-Hosting / Pterodactyl "Start bash file".
//
// The hosting template exposes no free-form environment variables, so the
// deployment is triggered from the start command itself (never on every
// restart, never automatically):
//
//   node start.js                 -> normal start (delegates to index.js), no deploy
//   node start.js deploy          -> one-shot GLOBAL deploy + read-back, then start the bot
//   node start.js deploy <guildId> -> one-shot GUILD-SCOPED deploy (instant propagation), then start the bot
//
// The bot ALWAYS ends up online: a deploy failure is reported (safe logs, no
// secret) but never prevents startup. All deploy logging is owned by deploy.js.

const { deployCommands } = require("./deploy");
const { main } = require("./index");

const args = process.argv.slice(2);
const doDeploy = args[0] === "deploy";
let guildId = doDeploy ? args[1] : null;

// Light guard: only pass a guild id that looks like a Discord snowflake.
// Anything else is ignored (falls back to a global deploy) so a typo in the
// start command cannot silently break the deploy.
if (guildId && !/^\d{15,21}$/.test(guildId)) {
  console.log("[CIVRAT] Ignoring invalid guild id argument (not a snowflake) — deploying globally.");
  guildId = null;
}

(async () => {
  if (doDeploy) {
    console.log(
      guildId
        ? "[CIVRAT] Deploy requested (guild-scoped) — one-shot deployment."
        : "[CIVRAT] Deploy requested (global) — one-shot deployment."
    );
    const result = await deployCommands({ guildId });
    if (result.ok) {
      console.log(`[CIVRAT] Deploy OK — ${result.registered ?? "?"} command(s) read back. Starting the bot…`);
    } else {
      console.log("[CIVRAT] Deploy reported a failure — starting the bot anyway.");
    }
  }
  await main();
})().catch((error) => {
  console.error("[CIVRAT] Fatal startup failure:", error?.message || String(error));
  process.exit(1);
});
