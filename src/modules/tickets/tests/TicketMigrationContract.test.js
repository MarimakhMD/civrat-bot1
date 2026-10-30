"use strict";
// Contrôles textuels seulement : ni parseur SQL ni PostgreSQL/RLS.
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const root = path.resolve(__dirname, "../../../../");
const load = (f) => fs.readFileSync(path.join(root, "docs/migrations", f), "utf8");
const migrations = ["tickets-free-01-additive.sql", "tickets-free-02-historical-attestation-draft.sql", "tickets-free-03-operation-journal-draft.sql", "tickets-free-04-limits-reservations-draft.sql", "tickets-free-05-index-transition-proposal.sql"].map(load);
test("contrats SQL proposés : noms des RPC et paramètres appelés par les dépôts", () => {
  const contracts = {
    civrat_ticket_free_save_category: ["p_guild_id","p_id","p_name","p_enabled","p_destination_id","p_support_role_ids","p_welcome_message","p_open_limit","p_archive"],
    civrat_ticket_free_create_snapshot: ["p_guild_id","p_user_id","p_channel_id","p_panel_id","p_category_id","p_name","p_destination_id","p_role_ids","p_welcome_message","p_open_limit"],
    civrat_ticket_historical_attest: ["p_guild_id","p_channel_id","p_actor_id","p_request_id","p_role_ids","p_evidence","p_expected_user_id","p_expected_status","p_expected_closed","p_expected_panel_id","p_expected_created_at"],
    civrat_ticket_historical_refusal: ["p_guild_id","p_channel_id","p_actor_id","p_reason"],
    civrat_ticket_operation_begin: ["p_operation_id","p_guild_id","p_scope","p_actor_id","p_target_id","p_action"],
    civrat_ticket_operation_transition: ["p_guild_id","p_operation_id","p_expected_revision","p_state","p_observation","p_actor_id"],
    civrat_ticket_participant_confirm: ["p_guild_id","p_operation_id","p_expected_revision","p_actor_id"],
    civrat_ticket_creation_confirm: ["p_guild_id","p_operation_id","p_expected_revision","p_actor_id","p_channel_id"],
    civrat_ticket_operations_list_unresolved: ["p_guild_id","p_limit","p_after_created_at","p_after_operation_id"],
    civrat_ticket_reserve_open: ["p_guild_id","p_user_id","p_category_id","p_request_id","p_actor_id"],
    civrat_ticket_finalize_open: ["p_request_id","p_channel_id"],
    civrat_ticket_cancel_reservation: ["p_request_id","p_actor_id"],
    civrat_ticket_reserve_reopen: ["p_guild_id","p_user_id","p_channel_id","p_request_id","p_actor_id"],
  };
  const allForRpc = migrations.slice(0, 4).join("\n"); // 05 is proposal, no RPC
  const repositoryFiles = ["SupabaseTicketFreeCategoryRepository.js", "SupabaseTicketRepository.js", "SupabaseTicketHistoricalAttestationRepository.js", "SupabaseTicketOperationRepository.js", "SupabaseTicketFreeSettingsRepository.js", "SupabaseTicketReservationRepository.js"];
  const sources = repositoryFiles.map((name) => fs.readFileSync(path.join(root, "src/modules/tickets/persistence", name), "utf8")).join("\n");
  for (const [name, params] of Object.entries(contracts)) {
    const match = new RegExp(`CREATE FUNCTION public\\.${name}\\s*\\(([^)]*)\\)`, "i").exec(allForRpc);
    assert.ok(match, name);
    assert.deepEqual([...match[1].matchAll(/\b(p_[a-z_]+)\s+(?:text|uuid|boolean|bigint|smallint|timestamptz|int)/g)].map((m) => m[1]), params, name);
    const call = new RegExp(`\\.rpc\\("${name}",\\s*\\{([\\s\\S]*?)\\}\\)`).exec(sources);
    assert.ok(call, `appel ${name}`);
    assert.deepEqual([...call[1].matchAll(/\b(p_[a-z_]+)\s*:/g)].map((m) => m[1]), params, `appel ${name}`);
  }
});
test("contrats proposés : aucune suppression de l'index historique ou des données", () => {
  // 05 est une proposition avec DROP commenté pour procédure, on ne le compte pas
  for (const sql of migrations.slice(0, 4)) {
    assert.doesNotMatch(sql, /\bDROP\s+(INDEX|TABLE)\b/i);
    assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
    assert.match(sql, /BEGIN;/); assert.match(sql, /COMMIT;/);
  }
  assert.match(migrations[1], /RECONSTRUCTION/);
  assert.match(migrations[2], /unresolved_scope_idx/);
});
