# CIVRAT

CIVRAT is a Discord bot designed for configurable, server-native administration.
Administration happens in Discord through slash commands, buttons, select menus,
modals, and persistent panels.

## Project direction

- The Discord bot is the product runtime.
- PostgreSQL/Supabase is the source of truth for business data and configuration.
- MongoDB is reserved for justified dynamic or high-write data.
- The historical dashboard is being removed progressively. No new feature may
  depend on it.
- A public website is a separate showcase project and must not administer the bot.
- Technical and Owner operations use the guild-scoped `/admin` panel.

See [`docs/architecture/decisions.md`](docs/architecture/decisions.md) and
[`docs/architecture/module-convention.md`](docs/architecture/module-convention.md)
for the engineering rules.

The frozen product reference is
[`docs/product/civrat-product-charter-v1.md`](docs/product/civrat-product-charter-v1.md).

## Requirements

- Node.js `>= 18.17.0`
- A Discord application and bot token
- A Supabase project with the current runtime tables
- MongoDB only when using features that require dynamic persistence

## Setup

```bash
cp .env.example .env
# Fill in the required values in .env
npm ci
npm run deploy -- list --global --all-guilds # inventory only; see maintenance procedure
npm start
```

Normal startup and command deployment are separate operations. `npm start` does
not deploy commands. Command maintenance requires explicit targets, a preview,
and confirmation before writes. See [the Pterodactyl procedure](docs/operations/command-maintenance.md).

## Slash-command scopes

Deployment validates a closed catalog before making any Discord request:

- **22 global Guild commands:** `/analytics`, `/analytics_invites`,
  `/analytics_xp`, `/automod`, `/bannir`, `/debannir`, `/deverrouiller`,
  `/expulser`, `/giveaway`, `/invites`, `/mute`, `/pseudo`, `/settings`,
  `/slowmode`, `/suggest`, `/supprimer`, `/ticketpanel`, `/unmute`,
  `/uploadsticker`, `/verrouiller`, `/warn`, `/welcomeimage`;
- **one technical Guild command:** `/admin`, deployed only through the guild
  endpoint for `CIVRAT_ADMIN_GUILD_ID`.

A global deployment replaces the previous global catalog, which removes the old
`/ownerpanel` and `/recovery` command definitions. Their useful services and
security controls are reused inside `/admin`.

### Explicit command maintenance

Both `node deploy.js` and `start.sh → start.js` use the secure CLI:

```bash
node deploy.js list --global --all-guilds
node deploy.js deploy --global --all-guilds
node deploy.js clear --guild <guildId>
```

These are read-only inventories/simulations. Writes additionally require
`--apply --confirm <preview fingerprint>` after approval. Global scope is
separate from `--all-guilds`. Deploy reconciles ordinary guilds to **empty**
local catalogs to remove historical copies; `/admin` is only placed in the
technical guild. No implicit global target, no positional guild ID syntax.
Maintenance exits without starting the bot, with status 1 for a failure.
See [the procedure](docs/operations/command-maintenance.md) before any real use.

## Technical `/admin` panel

Access is fail-closed and requires all three conditions on every interaction:

1. the configured technical guild;
2. the configured technical channel;
3. the configured Admin role.

Defaults are documented in `.env.example`; all three public Discord IDs can be
overridden in the hosting environment. Refusals are ephemeral and generic and
do not reveal technical IDs, Premium data, identity data, or failure details.

The panel reuses existing data and exposes only what is actually available:
installed guilds from the Discord cache, diagnostics, technical and feature
configuration state, Premium entitlement data, history, and audit data. Backend
outages are displayed as unavailable, never as an invented zero.

### Owner section and Recovery

The Owner section is rendered only to the effective CIVRAT Owner. The Owner must
also satisfy the `/admin` guild/channel/role guard and submit
`OWNER_PANEL_MASTER_CODE`. The value is read from the environment and compared
server-side with the existing timing-safe, rate-limited service. It is never
hardcoded, logged, placed in a component `customId`, or persisted; only an
expiring in-memory session is stored.

Owner actions retain their existing `CIVRAT_OWNER` permission, confirmation,
transfer-code, and single-use pending-action protections. The existing Recovery
double-factor flow is available from `/admin`; it no longer has a concurrent
slash command.

## `/settings`

`/settings` remains a global Guild command protected by **Manage Server**. Its
13 real feature sections are grouped into seven non-empty categories:

1. General and roles;
2. Protection;
3. Welcome and goodbye;
4. Tickets;
5. Community;
6. Analytics and progression;
7. Logs.

Every feature remains accessible. Category views show status, configuration
completeness, required permission, and applicable Premium capability. A missing
configuration row, cached state, and an unavailable configuration backend are
distinguished. Changing FR/EN rebuilds the same categorized panel without
removing a feature.

## Premium decisions

All runtime consumers share the existing `EntitlementService`. Explicit Premium
interactions preserve three outcomes:

- `ENTITLEMENT_GRANTED`;
- `PREMIUM_REQUIRED`;
- `ENTITLEMENT_UNAVAILABLE`.

Premium controls remain visible. A missing entitlement produces a professional
FR/EN explanation with the support link `https://discord.gg/BA3aDFqtXr` and asks
the user to open a ticket. A backend outage is reported separately and remains
fail-closed. Free Ticket behavior still falls back safely when Premium data is
not available.

## Scripts and verification

| Script | Purpose |
| --- | --- |
| `npm start` | Starts the bot runtime without requiring a command deploy. |
| `npm run dev` | Starts the runtime in Node watch mode. |
| `npm run deploy -- deploy --global --all-guilds` | Preview reconciliation; explicit confirmation required to apply. |
| `node start.js deploy --guild <guildId>` | Preview one Guild reconciliation; does not start the bot. |
| `node deploy.js list --guild <guildId>` | Reads one Guild command catalog without modifying it. |
| `node deploy.js clear --guild <guildId>` | Previews one Guild clear without touching global commands. |
| `npm run check:syntax` | Performs JavaScript syntax checks. |
| `npm run check:commands` | Verifies the real 23-command catalog (22 global + technical `/admin`) against `deploy.js`, plus static `src/commands` source checks. |
| `npm run check:repository` | Verifies repository safety baselines. |
| `npm run check` | Runs all static checks. |
| `npm test` | Discovers and runs **every** `*.test.js` in the repository, deterministically. No filter, no glob to maintain. |
| `npm run test:list` | Lists the discovered test files and their count without executing them. |
| `npm run test:core` | Runs offline core tests (`test/core`). |
| `npm run test:adapters` | Runs adapter tests (`test/adapters`). |
| `npm run test:guild-settings` | Runs Guild Settings and runtime composition tests. |
| `npm run test:modules` | Runs all `src/modules/**/tests` module tests. |
| `npm run test:welcome-goodbye` | Runs Welcome/Goodbye offline tests. |
| `npm run test:phase-2` | Runs offline core, adapter, and Guild Settings tests. |
| `npm run test:phase-3` | Also runs Welcome/Goodbye offline tests. |

`npm test` discovers test files from disk, so adding a `*.test.js` anywhere in
the repository automatically includes it. A scoped script whose filter matches
no file fails loudly instead of reporting a green run.

The repository's automated tests are offline: they do not constitute a real
Discord deployment or interaction test. Real acceptance must still be performed
manually on the technical guild and the intended test guilds, including a DM
visibility check.

## Environment variables

Use [`.env.example`](.env.example) as the canonical template. Never add real
credentials, `.env`, tokens, Master Codes, transfer codes, Recovery codes, or
SMTP passwords to Git.

## Development rules

- Keep changes targeted and reversible.
- Do not add dashboard-based administration.
- Keep each feature module self-contained.
- Do not introduce a second source of truth for configuration, permissions,
  identity, or Premium data.
- Use centralized translations for all bot-facing text.
- Run `npm run check` and the relevant offline test suites before delivery.
