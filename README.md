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
npm run deploy
npm start
```

Normal startup and command deployment are separate operations. `npm start` does
not need to deploy commands. Run `npm run deploy` explicitly when the command
catalog or its configured technical guild changes.

## Slash-command scopes

Deployment validates a closed catalog before making any Discord request:

- **22 global Guild commands:** `/analytics`, `/analytics_invites`,
  `/analytics_xp`, `/automod`, `/bannir`, `/captcha`, `/debannir`,
  `/deverrouiller`, `/expulser`, `/giveaway`, `/invites`, `/mute`, `/pseudo`,
  `/settings`, `/slowmode`, `/suggest`, `/supprimer`, `/ticketpanel`, `/unmute`,
  `/uploadsticker`, `/verrouiller`, `/warn`;
- **one technical Guild command:** `/admin`, deployed only through the guild
  endpoint for `CIVRAT_ADMIN_GUILD_ID`.

A global deployment replaces the previous global catalog, which removes the old
`/ownerpanel` and `/recovery` command definitions. Their useful services and
security controls are reused inside `/admin`.

### Targeted preview and stale Guild commands

`npm run deploy` (or `node deploy.js deploy`) is the production operation: it
updates the 22-command global catalog and then the technical `/admin` catalog.
A valid explicit guild argument instead performs exactly one Guild PUT and no
global PUT:

```bash
node deploy.js deploy <guildId>
```

- a normal guild receives only the 22 normal commands for an instant,
  reversible preview;
- `CIVRAT_ADMIN_GUILD_ID` receives only `/admin`;
- `/admin` is never included for another guild.

Inspect a Guild scope before and after a preview, then remove its temporary
commands when testing is complete:

```bash
node deploy.js list <guildId>
node deploy.js clear <guildId>
```

`clear` never touches global commands. An explicitly supplied invalid ID aborts
the requested REST operation and never falls back to a production deploy.

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

## CAPTCHA

The CAPTCHA command, module, runtime transport, and existing behavior are
preserved. This architecture change does not alter CAPTCHA source files.

## Scripts and verification

| Script | Purpose |
| --- | --- |
| `npm start` | Starts the bot runtime without requiring a command deploy. |
| `npm run dev` | Starts the runtime in Node watch mode. |
| `npm run deploy` | Production deploy: 22 global commands plus technical guild-scoped `/admin`. |
| `node start.js deploy <guildId>` | One target-safe Guild deploy, then starts the bot even if deployment fails. |
| `node deploy.js list <guildId>` | Reads one Guild command catalog without modifying it. |
| `node deploy.js clear <guildId>` | Clears one Guild command catalog without touching global commands. |
| `npm run check:syntax` | Performs JavaScript syntax checks. |
| `npm run check:commands` | Performs static slash-command source checks. |
| `npm run check:repository` | Verifies repository safety baselines. |
| `npm run check` | Runs all static checks. |
| `npm run test:core` | Runs offline core tests. |
| `npm run test:phase-2` | Runs offline core, adapter, and Guild Settings tests. |
| `npm run test:phase-3` | Also runs Welcome/Goodbye offline tests. |

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
