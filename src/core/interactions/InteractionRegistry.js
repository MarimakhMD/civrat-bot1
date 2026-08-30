"use strict";

const { InteractionKind } = require("./interactionKinds");
const { exact, matches, overlaps, validateMatcher } = require("./routeMatchers");

const AcknowledgementMode = Object.freeze({
  NONE: "none",
  DEFER_REPLY: "deferReply",
  DEFER_UPDATE: "deferUpdate",
});

const ACKNOWLEDGEMENT_ALIASES = Object.freeze({
  none: AcknowledgementMode.NONE,
  false: AcknowledgementMode.NONE,
  defer: AcknowledgementMode.DEFER_REPLY,
  "defer-reply": AcknowledgementMode.DEFER_REPLY,
  deferReply: AcknowledgementMode.DEFER_REPLY,
  "defer-update": AcknowledgementMode.DEFER_UPDATE,
  deferUpdate: AcknowledgementMode.DEFER_UPDATE,
});

/** In-memory registry that rejects duplicate or ambiguous future module routes. */
class InteractionRegistry {
  constructor() {
    this.commandRoutes = new Map();
    this.autocompleteRoutes = new Map();
    this.componentRoutes = new Map([
      [InteractionKind.BUTTON, []],
      [InteractionKind.SELECT_MENU, []],
      [InteractionKind.MODAL, []],
    ]);
  }

  registerCommand(route) {
    return this.registerNamed(this.commandRoutes, InteractionKind.COMMAND, route, AcknowledgementMode.DEFER_REPLY);
  }

  registerAutocomplete(route) {
    return this.registerNamed(this.autocompleteRoutes, InteractionKind.AUTOCOMPLETE, route, AcknowledgementMode.NONE);
  }

  registerButton(route) {
    return this.registerComponent(InteractionKind.BUTTON, route, AcknowledgementMode.NONE);
  }

  registerSelectMenu(route) {
    return this.registerComponent(InteractionKind.SELECT_MENU, route, AcknowledgementMode.NONE);
  }

  registerModal(route) {
    return this.registerComponent(InteractionKind.MODAL, route, AcknowledgementMode.DEFER_REPLY);
  }

  find(envelope) {
    if (envelope.kind === InteractionKind.COMMAND) return this.commandRoutes.get(envelope.name) || null;
    if (envelope.kind === InteractionKind.AUTOCOMPLETE) return this.autocompleteRoutes.get(envelope.name) || null;
    const routes = this.componentRoutes.get(envelope.kind) || [];
    return routes.find((route) => matches(route.matcher, envelope.customId)) || null;
  }

  registerNamed(collection, kind, route, defaultAcknowledgement) {
    validateRoute(route);
    if (typeof route.name !== "string" || !route.name) throw new TypeError(`${kind} routes require a name.`);
    if (collection.has(route.name)) throw new Error(`Duplicate ${kind} route: ${route.name}`);
    const registered = Object.freeze({
      ...route,
      kind,
      acknowledgement: normalizeAcknowledgement(route, defaultAcknowledgement),
      acknowledgementOptions: normalizeAcknowledgementOptions(route.acknowledgementOptions),
    });
    collection.set(route.name, registered);
    return registered;
  }

  registerComponent(kind, route, defaultAcknowledgement) {
    validateRoute(route);
    const matcher = route.matcher || (route.customId ? exact(route.customId) : null);
    validateMatcher(matcher);
    const routes = this.componentRoutes.get(kind);
    if (routes.some((registered) => overlaps(registered.matcher, matcher))) {
      throw new Error(`Ambiguous ${kind} route matcher: ${matcher.value}`);
    }
    const registered = Object.freeze({
      ...route,
      kind,
      matcher,
      acknowledgement: normalizeAcknowledgement(route, defaultAcknowledgement),
      acknowledgementOptions: normalizeAcknowledgementOptions(route.acknowledgementOptions),
    });
    routes.push(registered);
    return registered;
  }
}

function normalizeAcknowledgement(route, defaultAcknowledgement) {
  const requested = route.acknowledgement ?? route.acknowledge ?? defaultAcknowledgement;
  const key = requested === false ? "false" : requested;
  const acknowledgement = ACKNOWLEDGEMENT_ALIASES[key];
  if (!acknowledgement) {
    throw new TypeError(`Unsupported interaction acknowledgement mode: ${String(requested)}`);
  }
  return acknowledgement;
}

function normalizeAcknowledgementOptions(options) {
  return options && typeof options === "object" && !Array.isArray(options)
    ? Object.freeze({ ...options })
    : null;
}

function validateRoute(route) {
  if (!route || typeof route.execute !== "function") throw new TypeError("A route requires an execute function.");
}

module.exports = { InteractionRegistry, AcknowledgementMode };
