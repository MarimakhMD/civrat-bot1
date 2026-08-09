"use strict";

const { RouteNotFoundError, UnsupportedInteractionError } = require("../errors");
const { isInteractionKind } = require("./interactionKinds");

/**
 * Transport-neutral router. It accepts normalized envelopes and delegates to
 * module routes. Platform-specific adapters are intentionally out of scope.
 */
class InteractionRouter {
  constructor({ registry, contextFactory, logger = null }) {
    if (!registry || typeof registry.find !== "function") throw new TypeError("InteractionRouter requires an InteractionRegistry.");
    if (!contextFactory || typeof contextFactory.create !== "function") throw new TypeError("InteractionRouter requires an InteractionContextFactory.");
    this.registry = registry;
    this.contextFactory = contextFactory;
    this.logger = logger;
  }

  async handle(envelope) {
    try {
      if (!envelope || !isInteractionKind(envelope.kind)) {
        throw new UnsupportedInteractionError({ kind: envelope?.kind || null });
      }
      const route = this.registry.find(envelope);
      if (!route) throw new RouteNotFoundError({ kind: envelope.kind, name: envelope.name || null, customId: envelope.customId || null });

      const context = await this.contextFactory.create(envelope);
      if (route.permissions) await context.permissions.require(context, route.permissions);
      this.logger?.debug?.("Core interaction route invoked", { kind: route.kind, route: route.name || route.matcher?.value });
      return await route.execute(context);
    } catch (error) {
      if (!envelope?.transport?.replyError) throw error;
      const context = await this.contextFactory.create({ ...envelope, guildId: envelope.guildId || null });
      return context.respondError(error);
    }
  }
}

module.exports = { InteractionRouter };
