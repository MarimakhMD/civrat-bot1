# CIVRAT Architecture Decisions

This document records the active engineering decisions for CIVRAT. It is the
technical reference for future work in this repository.

## Product boundaries

1. CIVRAT is an autonomous Discord bot.
2. Bot administration happens in Discord only.
3. The historical dashboard is permanently abandoned and will be removed
   progressively without creating new dashboard dependencies.
4. A future public website is a separate showcase-only project. It must not
   administer CIVRAT or expose bot administration APIs.
5. A future Owner Panel will be implemented exclusively through Discord direct
   messages.

## Persistence ownership

CIVRAT uses a deliberately split persistence model:

- **PostgreSQL/Supabase** owns business data: guild configuration, licences,
  Premium and Enterprise entitlements, owner settings, administrative journals,
  and other business records.
- **MongoDB** may own justified dynamic or high-write data, such as XP,
  statistics, counters, or runtime-oriented records.

A data type must have exactly one owner. A feature must not split one business
concept across PostgreSQL/Supabase and MongoDB.

## Language policy

The internal code must be language-independent. Future bot-facing messages must
be resolved through a centralized translation system using the guild language.

A guild configured for French must receive French bot messages only. A guild
configured for English must receive English bot messages only.

## Compatibility and change management

- Preserve reliable existing behavior unless a dedicated, approved phase changes it.
- Prefer incremental migrations over broad rewrites.
- Do not remove historical dashboard code until it is no longer required by the
  transitional runtime.
- Keep commits small, focused, reversible, and independently reviewable.


## Core contracts

The isolated core exposes stable, transport-neutral contracts for interactions,
permissions, translations, configuration resolution, errors, and logging
capabilities. The core does not import Discord.js, MongoDB, Supabase, or
Express. Concrete integrations are future adapters.

CIVRAT owner identities will be owned by a dedicated PostgreSQL/Supabase table
(decision O2). The owner provider remains disabled until its dedicated phase.

## Log domain separation

Product observability and Discord guild moderation logs are separate domains.
Global CIVRAT supervision stores and presents only product health, deployment,
security, performance, and CIVRAT administrator actions. Guild moderation events
remain within their guild and authorized guild-administrator context.
