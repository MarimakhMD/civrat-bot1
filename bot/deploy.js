// ═══════════════════════════════════════════════════
// DEPLOY COMMANDS - Registers slash commands with Discord
// ═══════════════════════════════════════════════════
// Run: node deploy.js
// FIX: Now reads from the same command files as the bot

require("dotenv").config();
const { REST, Routes } = require("discord.js");
const { loadCommands } = require("./src/handlers/commandHandler");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
// Optional one-time cleanup target for legacy guild-scoped commands.
// Global commands are already authoritatively replaced by the PUT below.
const LEGACY_GUILD_ID = process.env.LEGACY_GUILD_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error("❌ DISCORD_TOKEN or CLIENT_ID missing in .env");
  process.exit(1);
}

(async () => {
  try {
    const commands = loadCommands();
    const commandData = Array.from(commands.values()).map((c) => c.data.toJSON());

    console.log(`📦 Installing ${commandData.length} commands...`);

    const rest = new REST({ version: "10" }).setToken(TOKEN);

    if (LEGACY_GUILD_ID) {
      // Removes only historical guild commands for this application. This is
      // what prevents global + guild command duplicates in the test server.
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, LEGACY_GUILD_ID), { body: [] });
      console.log(`🧹 Legacy guild commands cleared for ${LEGACY_GUILD_ID}`);
    }

    // Discord PUT replaces the complete global collection: removed command
    // files are removed from Discord and no second global list is retained.
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commandData });

    console.log(`✅ ${commandData.length} commands installed globally!`);
    console.log("⏰ Note: Global commands may take up to 1 hour to appear.");
  } catch (error) {
    console.error("❌ Installation failed:", error);
    process.exitCode = 1;
  }
})();
