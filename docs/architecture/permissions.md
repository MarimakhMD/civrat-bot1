# CIVRAT Permission Contract

`PermissionService` centralizes authorization decisions for future modules.
Modules declare requirements; they do not reimplement member permission checks.

## Vocabulary

- `ADMINISTRATOR`
- `MANAGE_GUILD`
- `MANAGE_ROLES`
- `MANAGE_CHANNELS`
- `GUILD_OWNER`
- `CIVRAT_OWNER`

## Requirements

A requirement can require all permissions or one of several permissions:

```js
{ allOf: ["MANAGE_GUILD"] }
{ anyOf: ["ADMINISTRATOR", "GUILD_OWNER"] }
{ allOf: ["MANAGE_GUILD"], anyOf: ["ADMINISTRATOR", "GUILD_OWNER"] }
```

Failed authorization produces a transport-agnostic `AuthorizationError`. The
error responder is responsible for producing a localized user response.

## CIVRAT owners

The final authority for CIVRAT owners is a dedicated PostgreSQL/Supabase table,
as approved in architecture decision O2. It is intentionally not implemented
or activated in Phase 1. The default provider denies every owner request until
the dedicated Owner Panel and persistence phase is approved.
