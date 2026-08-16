# CIVRAT

CIVRAT is a Discord bot designed for configurable, server-native administration.
All bot administration is intended to happen directly in Discord through slash
commands, buttons, select menus, modals, and persistent panels.

## Project direction

- The Discord bot is the product runtime.
- PostgreSQL/Supabase is the source of truth for business data and configuration.
- MongoDB is reserved for justified dynamic or high-write data.
- The historical dashboard is being removed progressively. No new feature may
  depend on it.
- A future public website is a separate showcase project and must not administer
  the bot.
- A future Owner Panel will run exclusively through Discord direct messages.

See [`docs/architecture/decisions.md`](docs/architecture/decisions.md) and
[`docs/architecture/module-convention.md`](docs/architecture/module-convention.md)
for the engineering rules.

The frozen product reference is [`docs/product/civrat-product-charter-v1.md`](docs/product/civrat-product-charter-v1.md).

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

`npm run deploy` registers global slash commands. Discord can take time to
propagate global command changes.

## Deploy on Bot-Hosting / Pterodactyl (no free-form env variables)

The Bot-Hosting startup template does not expose free-form environment
variables, so deployment is triggered through the **Start bash file** only.
Use `start.js` as the single launcher:

1. Set **Start bash file** to `node start.js` once. The bot starts normally
   (identical to `node index.js`, no deployment).
2. To deploy the 24 slash commands, set **Start bash file** to:
   - `node start.js deploy` — global deploy (propagation can take time), or
   - `node start.js deploy <guildId>` — guild-scoped deploy (instant) for fast testing.
   Then restart and watch the console for:
   `Discord deployment started` → `24 commands prepared` → `Deployment successful`
   → `24 commands registered` → `Read-back: 24 commands currently registered.`
   → `CIVRAT is online …`.
3. After a successful deploy, set **Start bash file** back to `node start.js`
   so the next restart does not deploy again.

The bot always comes online even if the deploy fails: the failure is logged
with its HTTP status and Discord code only (never the token). If Discord
returns `50001 Missing Access`, re-invite the bot with the
`applications.commands` scope (`scope=bot%20applications.commands`).

## Scripts

| Script | Purpose |
| --- | --- |
| `npm start` | Starts the current bot runtime. |
| `npm run dev` | Starts the current bot runtime in Node watch mode. |
| `npm run deploy` | Deploys global slash commands. |
| `npm run check:syntax` | Performs JavaScript syntax checks only. |
| `npm run check:commands` | Performs static slash-command source checks only. |
| `npm run check:repository` | Verifies repository safety baselines only. |
| `npm run check` | Runs all static checks. |
| `npm run test:core` | Runs offline unit tests for the isolated core. |
| `npm run test:phase-2` | Runs offline core, adapter, and Guild Settings tests. |

The `check:*` and `test:core` scripts are intentionally offline: they never start
the bot and never connect to Discord, MongoDB, or Supabase.

## Environment variables

Use [`.env.example`](.env.example) as the canonical local template. Never add
real credentials to the repository.

## Development rules

- Keep changes small, targeted, and reversible.
- Do not add dashboard dependencies or dashboard-based administration.
- Keep each feature module self-contained.
- Do not introduce a second source of truth for any data type.
- Use centralized translations for all bot-facing text in future feature work.
- Run `npm run check` before delivering a change.
