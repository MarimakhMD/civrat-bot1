"use strict";

const {
  CivratError,
  ConfigurationError,
  ErrorCode,
  RouteNotFoundError,
} = require("../errors");
const { AcknowledgementMode } = require("./InteractionRegistry");
const { InteractionKind } = require("./interactionKinds");

class InteractionRouter {
  constructor({ registry, contextFactory }) {
    if (!registry || !contextFactory) throw new TypeError("InteractionRouter requires registry and contextFactory");
    this.registry = registry;
    this.contextFactory = contextFactory;
  }

  async handle(envelope) {
    let context = null;

    try {
      const route = this.registry.find(envelope);
      if (!route) throw new RouteNotFoundError({ kind: envelope.kind });

      await this.acknowledge(route, envelope);
      context = await this.contextFactory.create(envelope);

      if (route.permissions) await context.permissions.require(context, route.permissions);

      const result = await route.execute(context);
      this.assertAcknowledged(envelope);
      return result;
    } catch (error) {
      const mappedError = this.mapError(error, envelope);
      return this.respondToError(mappedError, envelope, context);
    }
  }

  async acknowledge(route, envelope) {
    if (envelope.kind === InteractionKind.AUTOCOMPLETE) return;

    const transport = envelope.transport;
    const mode = route.acknowledgement || AcknowledgementMode.NONE;
    if (!transport || mode === AcknowledgementMode.NONE) return;

    const method = mode === AcknowledgementMode.DEFER_REPLY ? "deferReply" : "deferUpdate";
    if (typeof transport[method] !== "function") return;
    if (typeof transport.supports === "function" && !transport.supports(method)) return;

    if (method === "deferReply") {
      await transport.deferReply(route.acknowledgementOptions || { ephemeral: true });
      return;
    }
    await transport.deferUpdate();
  }

  assertAcknowledged(envelope) {
    if (envelope.kind === InteractionKind.AUTOCOMPLETE) return;
    const transport = envelope.transport;
    if (!transport || typeof transport.isAcknowledged !== "function") return;
    if (transport.isAcknowledged()) return;

    throw new ConfigurationError("Interaction handler completed without acknowledgement", {
      operation: "respond",
      resource: "discord_interaction",
      reason: "MISSING_ACKNOWLEDGEMENT",
    });
  }

  mapError(error, envelope) {
    const mapper = envelope.mapError || envelope.errorMapper;
    if (typeof mapper !== "function") return error;
    try {
      return mapper(error, { operation: "interaction" });
    } catch {
      return error;
    }
  }

  async respondToError(error, envelope, context) {
    if (context && typeof context.respondError === "function") return context.respondError(error);

    if (typeof this.contextFactory.createErrorContext === "function") {
      const errorContext = this.contextFactory.createErrorContext(envelope, error);
      if (errorContext && typeof errorContext.respondError === "function") return errorContext.respondError(error);
    }

    if (error instanceof CivratError && error.terminal) {
      return { code: error.code, delivered: false, terminal: true };
    }

    if (typeof envelope.transport?.replyError === "function") {
      try {
        const delivery = await envelope.transport.replyError({
          code: error instanceof CivratError ? error.code : ErrorCode.INTERNAL_ERROR,
          message: "An unexpected error occurred. Please try again later.",
          details: {},
        });
        return {
          code: error instanceof CivratError ? error.code : ErrorCode.INTERNAL_ERROR,
          delivered: !(delivery && typeof delivery === "object" && delivery.delivered === false),
          terminal: false,
        };
      } catch {
        return {
          code: error instanceof CivratError ? error.code : ErrorCode.INTERNAL_ERROR,
          delivered: false,
          terminal: false,
        };
      }
    }

    throw error;
  }
}

module.exports = { InteractionRouter };
