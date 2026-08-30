"use strict";

const TECHNICAL_PREMIUM_GUILD_ID = "1320817768962064384";
const DEFAULT_PERMIT_TTL_MS = 5_000;

const PremiumMutationAuthority = Object.freeze({
  ADMIN: "CIVRAT_ADMIN",
  OWNER: "CIVRAT_OWNER",
});

const PremiumMutationOperation = Object.freeze({
  ACTIVATE: "activate",
  SET_STATUS: "setStatus",
});

const PremiumMutationDecision = Object.freeze({
  ALLOWED: "PREMIUM_MUTATION_ALLOWED",
  ADMIN_READ_ONLY: "TECHNICAL_PREMIUM_ADMIN_READ_ONLY",
  OWNER_AUTHORIZATION_UNAVAILABLE: "TECHNICAL_PREMIUM_OWNER_AUTHORIZATION_UNAVAILABLE",
  OWNER_SESSION_REQUIRED: "TECHNICAL_PREMIUM_OWNER_SESSION_REQUIRED",
  INVALID_PERMIT: "TECHNICAL_PREMIUM_INVALID_PERMIT",
});

class PremiumMutationDeniedError extends Error {
  constructor(code, details = {}) {
    super("Premium mutation refused");
    this.name = "PremiumMutationDeniedError";
    this.code = code;
    this.details = Object.freeze({
      guildId: typeof details.guildId === "string" ? details.guildId : null,
      feature: typeof details.feature === "string" ? details.feature : null,
      operation: typeof details.operation === "string" ? details.operation : null,
      authority: typeof details.authority === "string" ? details.authority : null,
    });
    Error.captureStackTrace?.(this, PremiumMutationDeniedError);
  }
}

class PremiumMutationPolicy {
  #technicalGuildId;
  #ownerAuthorization;
  #now;
  #permitTtlMs;
  #permits;

  constructor({
    technicalGuildId = TECHNICAL_PREMIUM_GUILD_ID,
    ownerAuthorization = null,
    now = () => Date.now(),
    permitTtlMs = DEFAULT_PERMIT_TTL_MS,
  } = {}) {
    this.#technicalGuildId = technicalGuildId;
    this.#ownerAuthorization = typeof ownerAuthorization === "function" ? ownerAuthorization : null;
    this.#now = now;
    this.#permitTtlMs = permitTtlMs;
    this.#permits = new WeakMap();
  }

  get technicalGuildId() {
    return this.#technicalGuildId;
  }

  configureOwnerAuthorization(ownerAuthorization) {
    if (typeof ownerAuthorization !== "function") {
      throw new TypeError("PremiumMutationPolicy requires an Owner authorization function");
    }
    if (this.#ownerAuthorization && this.#ownerAuthorization !== ownerAuthorization) {
      throw new Error("Premium Owner authorization is already configured");
    }
    this.#ownerAuthorization = ownerAuthorization;
    return this;
  }

  isTechnicalGuild(guildId) {
    return guildId === this.#technicalGuildId;
  }

  isPermanentPremiumGuild(guildId) {
    return this.isTechnicalGuild(guildId);
  }

  describeProtection(guildId) {
    const protectedGuild = this.isTechnicalGuild(guildId);
    return Object.freeze({
      protected: protectedGuild,
      permanent: protectedGuild,
      adminReadOnly: protectedGuild,
      guildId: protectedGuild ? this.#technicalGuildId : guildId || null,
    });
  }

  permanentRecord(feature) {
    return Object.freeze({
      guild_id: this.#technicalGuildId,
      feature_key: feature,
      status: "active",
      starts_at: null,
      ends_at: null,
      plan: feature,
      permanent: true,
      protected: true,
      source: "technical-premium-policy",
    });
  }

  async evaluateMutation({
    guildId,
    feature,
    operation,
    actorId = null,
    authority = PremiumMutationAuthority.ADMIN,
  }) {
    if (!this.isTechnicalGuild(guildId)) {
      return Object.freeze({
        allowed: true,
        code: PremiumMutationDecision.ALLOWED,
        protected: false,
        permanent: false,
      });
    }

    if (authority !== PremiumMutationAuthority.OWNER) {
      return this.denied(PremiumMutationDecision.ADMIN_READ_ONLY);
    }
    if (!this.#ownerAuthorization) {
      return this.denied(PremiumMutationDecision.OWNER_AUTHORIZATION_UNAVAILABLE);
    }

    let authorized = false;
    try {
      authorized = await this.#ownerAuthorization({ actorId, guildId, feature, operation });
    } catch {
      authorized = false;
    }
    if (authorized !== true) {
      return this.denied(PremiumMutationDecision.OWNER_SESSION_REQUIRED);
    }

    return Object.freeze({
      allowed: true,
      code: PremiumMutationDecision.ALLOWED,
      protected: true,
      permanent: true,
    });
  }

  async authorizeMutation(input) {
    const decision = await this.evaluateMutation(input);
    if (!decision.allowed) {
      throw new PremiumMutationDeniedError(decision.code, input);
    }

    const permit = Object.freeze({ type: "premium-mutation-permit" });
    this.#permits.set(permit, Object.freeze({
      guildId: input.guildId,
      feature: input.feature,
      operation: input.operation,
      expiresAt: this.#now() + this.#permitTtlMs,
    }));
    return permit;
  }

  assertRepositoryMutation({ guildId, feature, operation, permit }) {
    if (!this.isTechnicalGuild(guildId)) return true;

    const authorization = permit && typeof permit === "object" ? this.#permits.get(permit) : null;
    const valid = Boolean(
      authorization
      && authorization.guildId === guildId
      && authorization.feature === feature
      && authorization.operation === operation
      && authorization.expiresAt >= this.#now()
    );

    if (!valid) {
      throw new PremiumMutationDeniedError(PremiumMutationDecision.INVALID_PERMIT, {
        guildId,
        feature,
        operation,
      });
    }

    this.#permits.delete(permit);
    return true;
  }

  denied(code) {
    return Object.freeze({
      allowed: false,
      code,
      protected: true,
      permanent: true,
    });
  }
}

module.exports = {
  TECHNICAL_PREMIUM_GUILD_ID,
  PremiumMutationAuthority,
  PremiumMutationOperation,
  PremiumMutationDecision,
  PremiumMutationDeniedError,
  PremiumMutationPolicy,
};
