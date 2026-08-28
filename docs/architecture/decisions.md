# CIVRAT Architecture Decisions

This document records the active engineering decisions for CIVRAT. It is the
technical reference for future work in this repository.

## Product boundaries

1. CIVRAT is an autonomous Discord bot.
2. Bot administration happens in Discord only.
3. The historical dashboard is permanently abandoned and will be removed
   progressively without creating new dashboard dependencies.
4. A public website is a separate showcase-only project. It must not administer
   CIVRAT or expose bot administration APIs.
5. Technical Admin and Owner operations are consolidated in the Discord
   `/admin` panel; `/ownerpanel` and `/recovery` are not runtime commands.

## Command deployment scopes

Command definitions carry transport-neutral deployment metadata. The only
supported scopes are:

- `GLOBAL` for the 22 normal Guild commands;
- `CIVRAT_ADMIN_GUILD` for `/admin` only.

The Discord deployer validates the closed 22+1 catalog before every operation.
Without a target, the production deploy performs two PUTs: 22 commands on the
global endpoint, then `/admin` alone on the configured technical-guild endpoint.
With a valid explicit target, it performs exactly one Guild PUT and no global
PUT: a normal guild receives the 22-command preview catalog, while the technical
guild receives `/admin` only. Targeted previews are temporary and reversible
with the existing Guild `clear` operation.

An explicit invalid target is rejected before any REST call and must never be
normalized into a no-target production deployment. No target or configuration
path may place `/admin` outside `CIVRAT_ADMIN_GUILD_ID`. Runtime registration and
REST deployment remain separate from normal bot startup.

## Authorization model

Permission names and providers are centralized in the core.

- `CIVRAT_ADMIN` is fail-closed. Its concrete provider requires the configured
  technical guild, technical channel, and Admin role cumulatively. It is checked
  by the interaction router and again by sensitive Admin handlers.
- `CIVRAT_OWNER` remains a distinct authority backed by the existing CIVRAT
  identity service. Owner actions require both `CIVRAT_ADMIN` and
  `CIVRAT_OWNER`.
- Admin refusal responses are generic and ephemeral; they must not expose IDs,
  identity state, backend state, or operational data.

The Owner section is rendered only for the effective Owner. Its Master Code is
read live from `OWNER_PANEL_MASTER_CODE`, compared server-side by the existing
timing-safe and rate-limited service, and never stored in a component, database,
log, or source file. Successful authentication stores only an expiring in-memory
session. Existing confirmation, transfer-code, and single-use pending-action
controls remain mandatory.

The Recovery double-factor services remain available from `/admin`; they do not
have a concurrent slash command. A Recovery elevation is temporary, fail-closed,
and consumable only by the dedicated transfer path.

## Persistence ownership

CIVRAT uses a deliberately split persistence model:

- **PostgreSQL/Supabase** owns business data: guild configuration, licences,
  Premium and Enterprise entitlements, owner settings, administrative journals,
  and other business records.
- **MongoDB** may own justified dynamic or high-write data, such as XP,
  statistics, counters, or runtime-oriented records.

A data type must have exactly one owner. A feature must not split one business
concept across PostgreSQL/Supabase and MongoDB.

Guild configuration reads expose both effective values and an explicit state:
`available`, `found`, and `source`. Views must distinguish persisted data,
defaults, cache/memory, and an unavailable backend. They must never turn an
unknown value into a fabricated zero or persisted setting.

## Entitlements and Premium

`EntitlementService` is the only runtime Premium authority and is composed as a
singleton. Modules may use resolvers or views, but may not construct a parallel
entitlement repository/service.

Explicit Premium interactions preserve three decisions:

- `ENTITLEMENT_GRANTED`;
- `PREMIUM_REQUIRED`;
- `ENTITLEMENT_UNAVAILABLE`.

Free business paths may safely fall back to Free defaults, but explicit Premium
requests must explain the actual decision. Premium features remain visible. A
missing entitlement uses the centralized FR/EN ticket-support message; an
infrastructure outage is reported separately and remains fail-closed.

## Guild Settings

`/settings` is a global Guild command guarded by `MANAGE_GUILD`. A centralized
catalog owns the seven non-empty categories and all 13 real feature entries.
Each entry declares its existing interaction ID, activation rule, configuration
completeness rule, required permission, and applicable Premium capability.

Views derive state from this catalog. Language changes rebuild the same panel;
they must not add, hide, or remove functionality. A command without configurable
state must not create an artificial Settings category.

## Language policy

The internal code is language-independent. Bot-facing messages are resolved
through centralized translations using the guild language, with strict FR/EN
key parity. Premium and authorization errors follow the same policy.

## Core contracts

The isolated core exposes stable, transport-neutral contracts for interactions,
permissions, translations, configuration resolution, entitlement decisions,
errors, and logging capabilities. The core does not import Discord.js, MongoDB,
Supabase, or Express. Concrete integrations live in adapters and runtime
composition.

## Log domain separation

Product observability and Discord guild moderation logs are separate domains.
Global CIVRAT supervision stores and presents only product health, deployment,
security, performance, and CIVRAT administrator actions. Guild moderation events
remain within their guild and authorized guild-administrator context. Secret
values must never enter either domain.

## Compatibility and verification

- Preserve reliable existing behavior unless an approved phase changes it.
- Prefer incremental migrations over broad rewrites.
- Keep CAPTCHA behavior and its transport independent of Admin/Settings changes.
- Keep startup and slash-command deployment as separate operations.
- Automated tests are offline evidence only. Never report a Discord deployment,
  guild interaction, or DM check as completed unless it was actually performed.
- Real release acceptance must cover the intended test guilds, the technical
  guild, role/channel denials, and DM command visibility.
