"use strict";

try {
  require("dotenv").config();
} catch {}

let createClient = null;
try {
  ({ createClient } = require("@supabase/supabase-js"));
} catch {}

const url = process.env.SUPABASE_URL || null;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || null;
const anonKey = process.env.SUPABASE_ANON_KEY || null;

let supabase = null;
let supabaseAdmin = null;

if (url && createClient) {
  const key = serviceRoleKey || anonKey;
  if (key) {
    supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    supabaseAdmin = serviceRoleKey ? supabase : null;
  }
}

module.exports = { supabase, supabaseAdmin };
