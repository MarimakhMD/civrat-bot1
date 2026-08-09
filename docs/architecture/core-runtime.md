# CIVRAT Core Runtime Contract

The core runtime is a transport- and persistence-agnostic foundation for future
CIVRAT modules. It is intentionally isolated from the current bot runtime until
approved module migrations begin.

## Boundaries

Core components must not import or initialize Discord.js, MongoDB, Supabase, or
Express. Concrete integrations belong to adapters supplied by a future runtime
composition layer.

Core components receive dependencies through constructors or method arguments.
This makes every component independently testable and allows future transports,
persistence backends, and centralized observability without changing module
business rules.

## Stable contracts

The following contracts are public core contracts for future modules:

- `I18nService`
- `PermissionService`
- `CivratOwnerProvider`
- `GuildConfigResolver`
- `GuildConfigRepository`
- `InteractionRegistry`
- `InteractionRouter`
- `ErrorResponder`
- `CivratError` and stable error codes

Changes to these contracts require an approved architecture decision and a
compatibility plan.

## Logging

Core services accept an optional logger capability. The required surface is
method-based (`debug`, `info`, `warn`, `error`) and no concrete logger is
imported by the core. A future centralized observability implementation can be
injected without changing core contracts.
