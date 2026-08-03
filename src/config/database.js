// ═══════════════════════════════════════════════════
// DATABASE CONNECTIONS - MongoDB + Supabase
// ═══════════════════════════════════════════════════

const mongoose = require("mongoose");
const { createClient } = require("@supabase/supabase-js");
const { config } = require("./index");
const logger = require("../utils/logger");

// ═══════════════════════════════════════════════════
// MONGODB - For analytics, XP, runtime state only
// ═══════════════════════════════════════════════════

async function connectMongo() {
  if (!config.mongoUri) {
    logger.warn("MongoDB URI not configured - analytics features disabled");
    return null;
  }

  try {
    await mongoose.connect(config.mongoUri, {
      dbName: config.mongoDbName,
    });
    logger.success("MongoDB connecté (analytics/XP/runtime)");
    return mongoose;
  } catch (err) {
    logger.error("MongoDB connection failed:", err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════
// SUPABASE - Single source of truth for guild config
// ═══════════════════════════════════════════════════

function createSupabaseClient() {
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    logger.error("Supabase server credentials missing - bot cannot start safely");
    return null;
  }

  // Service role stays on Bot-Hosting only and bypasses strict table RLS.
  const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  logger.success("Supabase service-role client created (guild config source)");
  return supabase;
}

const supabase = createSupabaseClient();

module.exports = { connectMongo, supabase, mongoose };
