"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createGuildSettingsRuntime } = require("../../src/runtime/createGuildSettingsRuntime");
const { EntitlementFeature, EntitlementService } = require("../../src/core/entitlements");
const { SupabaseEntitlementRepository } = require("../../src/adapters/supabase");
const { TicketPremiumConfigResolver } = require("../../src/modules/tickets/services/TicketPremiumConfigResolver");
const { TicketComponentId } = require("../../src/modules/tickets/configuration/ticketConstants");
const { InteractionRegistry } = require("../../src/core/interactions");
const { registerTickets } = require("../../src/modules/tickets/register");

const legacyConfigService = {
  getGuildConfig: async () => ({ language: "fr" }),
  updateGuildConfig: async (_id, update) => update,
  invalidateCache: async () => {},
};

function buildRuntime() {
  return createGuildSettingsRuntime({ legacyConfigService });
}

test("TICKET_PREMIUM entitlement feature is declared", () => {
  assert.equal(EntitlementFeature.TICKET_PREMIUM, "TICKET_PREMIUM");
  assert.equal(Object.isFrozen(EntitlementFeature), true);
});

test("runtime composition wires a Ticket Premium resolver backed by the Supabase entitlement repository", () => {
  const runtime = buildRuntime();
  assert.ok(runtime.ticketPremiumResolver instanceof TicketPremiumConfigResolver);
  assert.ok(runtime.ticketPremiumResolver.entitlementService instanceof EntitlementService);
  assert.ok(runtime.ticketPremiumResolver.entitlementService.repository instanceof SupabaseEntitlementRepository);
});

test("composing the runtime keeps the Free ticket surface unchanged", () => {
  const runtime = buildRuntime();
  assert.equal(typeof runtime.tryHandle, "function");
  assert.ok(runtime.registry.find({ kind: "button", customId: TicketComponentId.PANEL }));
  assert.ok(runtime.registry.find({ kind: "button", customId: TicketComponentId.CREATE }));
  assert.equal(runtime.getDiscordCommands()[0].data.name, "settings");
});

test("registerTickets exposes the injected premium resolver without altering routes", () => {
  const resolver = new TicketPremiumConfigResolver({});
  const registry = new InteractionRegistry();
  const registration = registerTickets({ registry, service: { read: async () => ({}) }, settingsHome: async () => {}, premiumConfigResolver: resolver });
  assert.equal(registration.premiumConfigResolver, resolver);
  assert.ok(registry.find({ kind: "button", customId: TicketComponentId.PANEL }));
});

test("registerTickets defaults to no premium resolver (Free-only composition)", () => {
  const registry = new InteractionRegistry();
  const registration = registerTickets({ registry, service: { read: async () => ({}) }, settingsHome: async () => {} });
  assert.equal(registration.premiumConfigResolver, null);
});
