"use strict";

const { InteractionKind } = require("./interactionKinds");
const { exact, matches, overlaps, validateMatcher } = require("./routeMatchers");

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

  registerCommand(route) { return this.#registerNamed(this.commandRoutes, InteractionKind.COMMAND, route); }
  registerAutocomplete(route) { return this.#registerNamed(this.autocompleteRoutes, InteractionKind.AUTOCOMPLETE, route); }
  registerButton(route) { return this.#registerComponent(InteractionKind.BUTTON, route); }
  registerSelectMenu(route) { return this.#registerComponent(InteractionKind.SELECT_MENU, route); }
  registerModal(route) { return this.#registerComponent(InteractionKind.MODAL, route); }

  find(envelope) {
    if (envelope.kind === InteractionKind.COMMAND) return this.commandRoutes.get(envelope.name) || null;
    if (envelope.kind === InteractionKind.AUTOCOMPLETE) return this.autocompleteRoutes.get(envelope.name) || null;
    const routes = this.componentRoutes.get(envelope.kind) || [];
    return routes.find((route) => matches(route.matcher, envelope.customId)) || null;
  }

  #registerNamed(collection, kind, route) {
    validateRoute(route);
    if (typeof route.name !== "string" || !route.name) throw new TypeError(`${kind} routes require a name.`);
    if (collection.has(route.name)) throw new Error(`Duplicate ${kind} route: ${route.name}`);
    const registered = Object.freeze({ ...route, kind });
    collection.set(route.name, registered);
    return registered;
  }

  #registerComponent(kind, route) {
    validateRoute(route);
    const matcher = route.matcher || (route.customId ? exact(route.customId) : null);
    validateMatcher(matcher);
    const routes = this.componentRoutes.get(kind);
    if (routes.some((registered) => overlaps(registered.matcher, matcher))) {
      throw new Error(`Ambiguous ${kind} route matcher: ${matcher.value}`);
    }
    const registered = Object.freeze({ ...route, kind, matcher });
    routes.push(registered);
    return registered;
  }
}

function validateRoute(route) {
  if (!route || typeof route.execute !== "function") throw new TypeError("A route requires an execute function.");
}

module.exports = { InteractionRegistry };
