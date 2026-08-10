# CIVRAT Module Convention

Every new CIVRAT feature must be a self-contained module. A module owns its
public Discord behavior and the implementation required to support it.

## Required responsibilities

When applicable, a module contains or explicitly owns:

1. Slash commands and their registration metadata.
2. Button, select menu, modal, and persistent-panel interactions.
3. Discord event listeners specific to the feature.
4. Business services and domain rules.
5. Guild configuration and validation.
6. Persistence repositories and schema/migration ownership.
7. Discord logs and PostgreSQL administrative-journal events.
8. Translation keys and localized responses.
9. Permission checks and authorization rules.
10. Unit, static, and integration tests appropriate to the feature.

## Boundaries

- A module may use shared core utilities, but shared code must not own feature
  business rules.
- A module must not write directly into another module's persistence records.
- A module must not create a second source of truth for a data type.
- A module must not depend on the historical dashboard.
- Cross-module communication must use a documented interface rather than hidden
  imports or duplicated logic.

## Future directory direction

Future work should move toward a feature-first layout without moving files only
for cosmetic reasons:

```text
src/
  core/
  modules/
    <module-name>/
      commands/
      interactions/
      events/
      services/
      repositories/
      translations/
      tests/
```

Existing reliable code should be moved only when the owning module is being
stabilized in an approved phase.

## Core usage after module migration

Once a module is migrated in an approved later phase, it must register its
interactions through `InteractionRegistry`, declare authorization through
`PermissionService`, resolve guild data through `GuildConfigResolver`, and use
context-bound translation keys. It must not bypass these contracts.
