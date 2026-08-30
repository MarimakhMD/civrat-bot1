# CIVRAT Module Convention

Every CIVRAT feature must be a self-contained module. A module owns its public
Discord behavior and the implementation required to support it.

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
9. Permission requirements expressed with core permission names.
10. Unit, static, and offline integration tests appropriate to the feature.

## Boundaries

- A module may use shared core utilities, but shared code must not own feature
  business rules.
- A module must not write directly into another module's persistence records.
- A module must not create a second source of truth for a data type.
- A module must not depend on the historical dashboard.
- Cross-module communication must use a documented interface rather than hidden
  imports or duplicated logic.
- Modules must not instantiate `EntitlementService`; runtime composition injects
  the shared singleton.
- Secrets are environment inputs to dedicated services. They must never be
  command options, component IDs, persisted interaction state, logs, fixtures,
  or source defaults.

## Command definitions

Transport-neutral command definitions register through `InteractionRegistry`.
They declare:

- name and description;
- core permission requirements;
- Discord contexts and integration types when narrower than defaults;
- `deploymentScope` when not global.

Normal commands use the default `GLOBAL` scope. Only the technical `/admin`
command may use `CIVRAT_ADMIN_GUILD`. A module must not call Discord REST or
choose a deployment endpoint itself.

## Permissions and sensitive routes

Use `PermissionService`; do not duplicate role or owner comparisons in feature
modules. Sensitive handlers may add a defense-in-depth check using the same
injected provider, but must not create a second authorization model.

Every `/admin` route requires `CIVRAT_ADMIN`. Owner actions require both
`CIVRAT_ADMIN` and `CIVRAT_OWNER`, plus the existing Owner session check. Refusal
views are generic, ephemeral, and contain no operational details.

## Entitlement consumers

Explicit Premium actions call the injected `EntitlementService` (or a resolver
that preserves its result) and handle all three decisions:

- granted: execute the Premium operation;
- Premium required: render the centralized FR/EN support-and-ticket message;
- unavailable: render the centralized infrastructure-unavailable message and
  fail closed.

A Free execution path may use a documented Free fallback. It must not convert an
unavailable backend into a claim that the guild lacks Premium.

## Guild Settings entries

A configurable feature is represented exactly once in the Guild Settings
catalog. Its descriptor points to the existing section interaction and declares:

- activation state;
- configuration-completeness rule;
- required permission;
- actual Premium capabilities, if any.

Do not create a category for a command with no configuration. Categories must
remain non-empty. A language change or backend outage must not remove feature
controls.

## Directory direction

Use a feature-first layout without moving reliable files for cosmetic reasons:

```text
src/
  core/
  modules/
    <module-name>/
      commands/
      configuration/
      interactions/
      events/
      services/
      persistence/
      translations/
      tests/
```

Existing reliable code should move only when its owning module is being
stabilized in an approved phase.

## Core and adapter usage

Migrated modules register interactions through `InteractionRegistry`, declare
authorization through `PermissionService`, resolve guild data through
`GuildConfigResolver`, and use context-bound translation keys. Discord-specific
normalization belongs in adapters. The core must remain independent from
Discord.js, MongoDB, Supabase, and Express.

## Verification

Tests must cover success, denial, missing dependencies, backend unavailability,
and Discord component limits where relevant. Offline tests and static checks do
not prove real Discord behavior; release notes must state separately which guild,
channel, role, DM, and deployment checks were actually performed.
