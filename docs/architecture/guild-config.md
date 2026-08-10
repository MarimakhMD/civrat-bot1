# CIVRAT Guild Configuration Contract

Future feature modules access guild configuration only through
`GuildConfigResolver`:

```js
await guildConfigResolver.get(guildId);
await guildConfigResolver.getLanguage(guildId);
await guildConfigResolver.update(guildId, updates); // performs targeted invalidation
```

## Boundaries

`GuildConfigResolver` depends on a `GuildConfigRepository` contract. It does
not import Supabase or know table names, caches, SQL, or MongoDB.

During the transition, `LegacyGuildConfigRepository` adapts the existing
configuration service through injected functions. It does not import that
service itself. This avoids behavior changes while establishing the future
module-facing contract.

A later approved configuration phase may replace the adapter with a
PostgreSQL/Supabase implementation without changing future module code.

## Ownership

Guild configuration remains PostgreSQL/Supabase business data under architecture
decision A3. MongoDB must not become a second source of truth for configuration.
