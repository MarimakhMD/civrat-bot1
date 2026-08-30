"use strict";

// Environment loading belongs to the central bootstrap/config module. Keeping
// this adapter side-effect free also makes offline tests independent of .env.
let createClient = null;
try {
  ({ createClient } = require("@supabase/supabase-js"));
} catch {
  // Offline/test installations may intentionally omit optional dependencies.
}

const DatabaseClientStatus = Object.freeze({
  READY: "READY",
  NOT_CONFIGURED: "NOT_CONFIGURED",
  CLIENT_LIBRARY_UNAVAILABLE: "CLIENT_LIBRARY_UNAVAILABLE",
  INITIALIZATION_FAILED: "INITIALIZATION_FAILED",
});

function createDatabaseRuntime({
  url = null,
  serviceRoleKey = null,
  anonKey = null,
  createClientImpl = createClient,
} = {}) {
  const privileged = Boolean(serviceRoleKey);
  const credential = serviceRoleKey || anonKey || null;
  const mode = privileged ? "service_role" : credential ? "anon" : "offline";

  if (!url || !credential) {
    return Object.freeze({
      supabase: null,
      supabaseAdmin: null,
      state: Object.freeze({
        status: DatabaseClientStatus.NOT_CONFIGURED,
        configured: false,
        clientAvailable: false,
        privileged: false,
        mode: "offline",
      }),
    });
  }

  if (typeof createClientImpl !== "function") {
    return Object.freeze({
      supabase: null,
      supabaseAdmin: null,
      state: Object.freeze({
        status: DatabaseClientStatus.CLIENT_LIBRARY_UNAVAILABLE,
        configured: true,
        clientAvailable: false,
        privileged,
        mode,
      }),
    });
  }

  try {
    const client = createClientImpl(url, credential, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    return Object.freeze({
      supabase: client,
      supabaseAdmin: privileged ? client : null,
      state: Object.freeze({
        status: DatabaseClientStatus.READY,
        configured: true,
        clientAvailable: true,
        privileged,
        mode,
      }),
    });
  } catch {
    return Object.freeze({
      supabase: null,
      supabaseAdmin: null,
      state: Object.freeze({
        status: DatabaseClientStatus.INITIALIZATION_FAILED,
        configured: true,
        clientAvailable: false,
        privileged,
        mode,
      }),
    });
  }
}

const runtime = createDatabaseRuntime({
  url: process.env.SUPABASE_URL || null,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || null,
  anonKey: process.env.SUPABASE_ANON_KEY || null,
});

module.exports = {
  supabase: runtime.supabase,
  supabaseAdmin: runtime.supabaseAdmin,
  databaseState: runtime.state,
  DatabaseClientStatus,
  createDatabaseRuntime,
};
