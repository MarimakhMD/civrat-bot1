// ═══════════════════════════════════════════════════
// CONFIGURATION - Centralized environment variables
// ═══════════════════════════════════════════════════

require("dotenv").config();

const config = {
  // Discord
  token: process.env.DISCORD_TOKEN || "",
  clientId: process.env.CLIENT_ID || "",
  clientSecret: process.env.DISCORD_CLIENT_SECRET || "",
  redirectUri: process.env.DISCORD_REDIRECT_URI || "",

  // MongoDB (analytics, XP, runtime state only)
  mongoUri: process.env.MONGO_URI || "",
  mongoDbName: process.env.MONGO_DB_NAME || "civrat_bot",

  // Supabase (single source of truth for guild config)
  supabaseUrl: process.env.SUPABASE_URL || "",
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",

  // API
  apiPort: parseInt(process.env.API_PORT, 10) || 20488,
  apiSecret: process.env.API_SECRET || "default_secret_change_me",
  dashboardUrl: process.env.DASHBOARD_URL || "http://localhost:3000",
};

function validateConfig() {
  const errors = [];
  if (!config.token) errors.push("DISCORD_TOKEN is missing");
  if (!config.clientId) errors.push("CLIENT_ID is missing");
  if (!config.supabaseUrl) errors.push("SUPABASE_URL is missing");
  if (!config.supabaseServiceRoleKey) errors.push("SUPABASE_SERVICE_ROLE_KEY is missing");

  if (errors.length > 0) {
    console.error("❌ Configuration errors:");
    errors.forEach((e) => console.error(`   - ${e}`));
    process.exit(1);
  }

  if (config.apiSecret === "default_secret_change_me") {
    console.warn("⚠️  API_SECRET is using default value - change it in production!");
  }
}

module.exports = { config, validateConfig };
