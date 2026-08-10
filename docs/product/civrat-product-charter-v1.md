# CIVRAT Product Charter v1.0

**Status: Frozen.** This document is the official product reference for CIVRAT.
It must not be changed during normal module development. Any amendment requires
a dedicated, explicitly approved charter revision (for example v1.1 or v2.0).

## Product philosophy

CIVRAT must remain genuinely useful for free servers. Premium improves
customization, automation, power, flexibility, and comfort; it never removes an
essential free capability.

## Commercial boundary

Business engines never know Free, Premium, Enterprise, subscriptions, or
licences. They ask an entitlement capability only. Discord permissions remain
mandatory and cannot be bypassed by an entitlement.

## Module contract

Every module owns configuration, interactions, services, translations, logs,
tests, and developer documentation. It uses the shared configuration,
interaction, permission, translation, error, entitlement, and transport
contracts. It must not create parallel implementations of those concerns.

## UX

Discord-native configuration uses consistent buttons, menus, modals, back
navigation, previews, and ephemeral responses where appropriate. A new feature
must feel native to CIVRAT.

## Performance and security

Use simple, justified caching and resource reuse. Do not introduce unnecessary
complexity. Never let Premium bypass configuration validation, Discord
permissions, or security controls.

## Sequential development

Only one module phase is active at a time. A module must be implemented, tested,
documented, compatibility-checked, and explicitly approved before another
module starts. New ideas belong in the backlog and do not change an active
phase unless a validated critical exception is required.

## Extensibility

Prepare extension points without prematurely implementing advanced features.
New templates, placeholders, transports, and configuration options must be
addable through declared contracts rather than engine rewrites.

## Observability and server moderation logs

CIVRAT keeps two log domains strictly separate:

- **Product observability** concerns CIVRAT itself: bot availability, shards,
  service connectivity, deployment failures, critical execution errors, security
  alerts affecting CIVRAT, resource use, latency, and actions by CIVRAT owners.
- **Server moderation logs** concern a Discord guild and remain available only
  in that guild context to its authorized administrators. They are not product
  supervision data and must not become a global CIVRAT administration feed.

Future Logs, Analytics, API, Enterprise, and owner-facing work must preserve
this boundary. A change requires a major architecture justification.

## Enterprise roadmap boundary

Enterprise is not a CIVRAT v1.0 prerequisite. CIVRAT v1.0 focuses on Free and
Premium. Enterprise is a distinct v2 roadmap initiated only after v1.0 release
and stabilization.

## Roadmap planning boundary

Future phases are official only when they become the active priority. Until
then, they remain `Planned — Scope and order to be decided before implementation`.
No future module receives a frozen Free scope, Premium scope, dependency set, or
Definition of Done before its dedicated planning cycle.
