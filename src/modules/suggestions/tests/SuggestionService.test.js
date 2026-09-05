"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { SuggestionService } = require("../services/SuggestionService");

function mockRepo(overrides = {}) {
  const suggestions = new Map();
  const votes = new Map();
  return {
    // C2 : signature et colonnes alignées sur le dépôt Supabase réel.
    create: async ({ guildId, userId, content }) => {
      const id = String(suggestions.size + 1);
      const rec = { id, guild_id: guildId, user_id: userId, content, status: "pending", upvotes: 0, downvotes: 0 };
      suggestions.set(id, rec);
      return rec;
    },
    findById: async (id) => suggestions.get(String(id)) || null,
    vote: async (id, userId, value) => {
      const key = `${id}:${userId}`;
      if (votes.has(key)) {
        const existing = votes.get(key);
        if (existing.value === value) return { alreadyVoted: true, vote: existing };
        existing.value = value;
        return { alreadyVoted: false, vote: existing };
      }
      const vote = { suggestion_id: id, user_id: userId, value };
      votes.set(key, vote);
      return { alreadyVoted: false, vote };
    },
    updateStatus: async (id, status) => {
      const s = suggestions.get(String(id));
      if (s) s.status = status;
      return s;
    },
    delete: async (id) => {
      suggestions.delete(String(id));
      return { deleted: true };
    },
    ...overrides,
  };
}

test("create respects disabled and invalid content", async () => {
  const svc = new SuggestionService({ configService: { read: async () => ({ suggestions_enabled: false }) }, repository: mockRepo() });
  assert.equal((await svc.create({ guildId: "g1", authorId: "u1", content: "hi" })).code, "SUGGESTION_DISABLED");
  const svc2 = new SuggestionService({ configService: { read: async () => ({ suggestions_enabled: true, suggestions_channel_id: "c1" }) }, repository: mockRepo() });
  assert.equal((await svc2.create({ guildId: "g1", authorId: "u1", content: "" })).code, "SUGGESTION_INVALID_CONTENT");
  assert.equal((await svc2.create({ guildId: "g1", authorId: "u1", content: "a" })).code, "SUGGESTION_INVALID_CONTENT");
});

test("create succeeds with channel fallback", async () => {
  const svc = new SuggestionService({ configService: { read: async () => ({ suggestions_enabled: true, suggestions_channel_id: "c1" }) }, repository: mockRepo() });
  const res = await svc.create({ guildId: "g1", authorId: "u1", content: "hello" });
  assert.equal(res.ok, true);
  assert.equal(res.code, "SUGGESTION_CREATED");
});

test("vote handles not found and already voted", async () => {
  const repo = mockRepo();
  const svc = new SuggestionService({ configService: { read: async () => ({ suggestions_enabled: true, suggestions_channel_id: "c1" }) }, repository: repo });
  const created = await svc.create({ guildId: "g1", authorId: "u1", content: "hello" });
  const id = created.suggestion.id;
  const v1 = await svc.vote({ guildId: "g1", suggestionId: id, userId: "u2", value: 1 });
  assert.equal(v1.ok, true);
  const v2 = await svc.vote({ guildId: "g1", suggestionId: id, userId: "u2", value: 1 });
  assert.equal(v2.code, "SUGGESTION_ALREADY_VOTED");
  const v3 = await svc.vote({ guildId: "g1", suggestionId: id, userId: "u2", value: -1 });
  assert.equal(v3.ok, true);
});

test("staff approve/reject/delete", async () => {
  const repo = mockRepo();
  const svc = new SuggestionService({ configService: { read: async () => ({ suggestions_enabled: true, suggestions_channel_id: "c1" }) }, repository: repo });
  const created = await svc.create({ guildId: "g1", authorId: "u1", content: "hello" });
  const id = created.suggestion.id;
  const appr = await svc.staffAction({ guildId: "g1", suggestionId: id, action: "approve", actorId: "mod1" });
  assert.equal(appr.ok, true);
  assert.equal(appr.code, "SUGGESTION_APPROVED");
  const rej = await svc.staffAction({ guildId: "g1", suggestionId: id, action: "reject", actorId: "mod1" });
  assert.equal(rej.ok, true);
  const del = await svc.staffAction({ guildId: "g1", suggestionId: id, action: "delete", actorId: "mod1" });
  assert.equal(del.ok, true);
  assert.equal((await svc.vote({ guildId: "g1", suggestionId: id, userId: "u2", value: 1 })).code, "SUGGESTION_NOT_FOUND");
});

test("staff invalid action", async () => {
  const svc = new SuggestionService({ configService: { read: async () => ({ suggestions_enabled: true, suggestions_channel_id: "c1" }) }, repository: mockRepo() });
  const created = await svc.create({ guildId: "g1", authorId: "u1", content: "hello" });
  assert.equal((await svc.staffAction({ guildId: "g1", suggestionId: created.suggestion.id, action: "invalid", actorId: "mod1" })).code, "SUGGESTION_INVALID_ACTION");
});
