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
//   node start.js clear <guildId> -> clear GUILD-SCOPED commands only on one guild, then start the bot
//   node start.js list [guildId]  -> list registered commands (global or guild), then start the bot
//
// The bot ALWAYS ends up online: a deploy/clear failure is reported (safe
// logs, no secret) but never prevents startup. All deploy logging is owned by
// deploy.js.

const { deployCommands, clearGuildCommands, listCommands, isSnowflake } = require("./deploy");
const { main } = require("./index");

const args = process.argv.slice(2);
const mode = args[0] || "start";
const rawGuildId = args[1] || null;
const guildId = isSnowflake(rawGuildId || "") ? rawGuildId : null;

if (rawGuildId && !guildId) {
  console.log("[CIVRAT] Ignoring invalid guild id argument (not a snowflake).");
}

(async () => {
  if (mode === "deploy") {
    console.log(
      guildId
        ? "[CIVRAT] Deploy requested (guild-scoped) — one-shot deployment."
        : "[CIVRAT] Deploy requested (global) — one-shot deployment."
    );
    const result = await deployCommands({ guildId });
    console.log(
      result.ok
        ? `[CIVRAT] Deploy OK — ${result.registered ?? "?"} command(s) read back. Starting the bot…`
        : "[CIVRAT] Deploy reported a failure — starting the bot anyway."
    );
  } else if (mode === "clear") {
    if (!guildId) {
      console.log("[CIVRAT] 'clear' requires a guild id (node start.js clear <guildId>). Nothing cleared — starting the bot.");
    } else {
      console.log("[CIVRAT] Clear requested (guild-scoped commands only; global commands untouched).");
      const result = await clearGuildCommands({ guildId });
      console.log(
        result.ok
          ? `[CIVRAT] Clear OK — ${result.cleared ?? 0} guild-scoped command(s) removed. Starting the bot…`
          : "[CIVRAT] Clear failed — starting the bot anyway."
      );
    }
  } else if (mode === "list") {
    console.log(guildId ? "[CIVRAT] List requested (guild-scoped)." : "[CIVRAT] List requested (global).");
    const result = await listCommands({ guildId });
    console.log(`[CIVRAT] List done — ${result.ok ? (result.commands.length + " command(s)") : "failed"}. Starting the bot…`);
  } else if (mode !== "start") {
    console.log(`[CIVRAT] Unknown mode "${mode}" — starting normally (no deploy).`);
  }

  await main();
})().catch((error) => {
  console.error("[CIVRAT] Fatal startup failure:", error?.message || String(error));
  process.exit(1);
});
