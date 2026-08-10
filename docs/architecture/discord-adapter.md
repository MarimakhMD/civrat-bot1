# Discord Adapter Boundary

Only `src/adapters/discord/` imports Discord.js for newly migrated code. It
converts Discord events, members, command builders, and response operations to
the transport-neutral core contracts.

`DiscordInteractionAdapter.tryHandle()` returns `false` when no core route is
registered. This is the compatibility boundary that lets all historical
interactions continue through their existing handler.
