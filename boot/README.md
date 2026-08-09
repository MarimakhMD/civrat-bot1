# CIVRAT Dashboard

Dashboard web CIVRAT construit avec React, TypeScript, Vite, Tailwind CSS, Framer Motion et les intégrations existantes du projet.

> Cette application conserve les connexions existantes à Discord OAuth, Supabase, MongoDB et au bot CIVRAT. Le front-end ne contient aucun secret et ne doit jamais en ajouter.

## Démarrage

```bash
npm ci
npm run dev
```

Commandes de contrôle :

```bash
npm run lint
npm run build
npm run preview
```

## Architecture active

- `src/main.tsx` : point d’entrée Vite.
- `src/App.tsx` : routes React Router et chargement différé des pages.
- `src/pages/` : landing, authentification, sélection de serveur et modules.
- `src/components/layout/` : sidebar, top bar et shell dashboard.
- `src/components/ui/` : composants UI partagés utilisés par le dashboard.
- `src/context/` : états d’authentification et de serveur actuellement utilisés par l’interface.
- `src/index.css` : thème CIVRAT noir, vert néon et or, règles responsive et accessibilité.

Les pages dashboard sont chargées avec `React.lazy` : le code d’un module n’est téléchargé que lorsqu’il est ouvert.

## Modules

Le dashboard contient les espaces Welcome, Tickets, Logs, AutoMod, Captcha, XP & Niveaux, Giveaways, Suggestions, Security, Invitations, paramètres et outils d’administration.

Les réglages déjà exposés par le projet utilisent les mécanismes existants. Les aperçus ou contrôles dont le bot ne fournit pas encore de données sont présentés comme des interfaces prêtes à connecter : ils ne créent ni API, ni table, ni collection de données supplémentaire.

## Configuration et déploiement

Les variables d’environnement, les secrets Discord, la configuration Supabase/MongoDB et le déploiement Vercel sont gérés par l’infrastructure existante. Ne créez pas de variable `VITE_*` pour un secret, un token Discord ou une clé de service.

Pour un déploiement, utilisez la configuration Vercel déjà reliée au dépôt et vérifiez que les URL de callback Discord existantes correspondent au domaine de production.

## Qualité

- `npm run build` vérifie TypeScript puis produit le build Vite.
- `npm run lint` contrôle le code de l’application Vite active.
- Les anciens exports TanStack / React Start encore présents dans le dépôt sont exclus du lint actif : ils ne font pas partie du point d’entrée `src/main.tsx` / `src/App.tsx` et sont conservés pour ne pas supprimer une structure historique sans migration dédiée.

## Guide développeur

1. Préserver les contrats des contextes, services et intégrations existants.
2. Ajouter les chaînes de texte via le système de présentation approprié avant de les réutiliser dans des modules.
3. Pour une donnée Discord non exposée par le backend, créer uniquement un état visuel explicite « prêt à connecter » ; ne pas simuler de persistance.
4. Tester au minimum le build et le lint avant toute mise en production.

## Security Center (bot)

The bot currently enforces the canonical `guild_configs` Security fields below:

- `security_enabled`
- `security_anti_raid`
- `security_anti_nuke`
- `security_anti_bot`
- `security_whitelist`
- `security_quarantine_role`
- `log_moderation_channel_id`

When enabled, CIVRAT detects join bursts, unapproved bot joins, and repeated channel/role creation or deletion from the same audit-log actor. It writes security incidents to the configured moderation log and applies the configured quarantine role where Discord permissions allow it. Webhook, mass-ban, mass-kick, and per-action thresholds remain future work because the current canonical configuration does not contain fields for them.

## Invitation tracking (bot)

When `invitations_enabled` is enabled, CIVRAT caches guild invites at startup and after invite lifecycle events. It identifies the incremented invite on member join, persists total/current/left counts in the existing `InviteStats` MongoDB collection, records invitation joins in `invitations_log_channel_id`, and exposes the available counters plus a leaderboard through `/invites`. Fake-invite detection is intentionally reported as unavailable because no fake-account data model exists yet.

## XP & Levels (bot)

When `xp_enabled` is enabled, CIVRAT stores member XP in the `UserXP` MongoDB collection. It uses `xp_per_message`, `xp_cooldown`, `xp_announce_channel_id` and `role_rewards` from `guild_configs`. The stable formula is `100 × level²` total XP. `/niveau` displays a member profile and `/classement` displays the top ten. XP level announcements and configured role rewards are sent/applied only when Discord permissions allow them.

## Giveaways (bot)

The existing Supabase `giveaways` table is the giveaway source of truth. CIVRAT manages active rows with `giveaways_enabled`, durable giveaway entries in the minimal `GiveawayEntry` MongoDB collection, a restart-safe one-minute end scheduler, and the `/giveaway` management command. Entry buttons query the persisted giveaway row, so participation survives bot restarts. Giveaway creation, completion, rerolls, and cancellation are logged through `log_moderation_channel_id`.

## Suggestions (bot)

CIVRAT uses the existing Supabase `suggestions` table for suggestion state and counters, and the minimal MongoDB `SuggestionVote` collection for durable per-user vote choice. `/suggestion proposer` creates a suggestion in `suggestions_channel_id`; Discord buttons allow one active up/down vote or a vote withdrawal. Staff with `ManageGuild` can accept, reject, archive, delete, and answer suggestions. The table now stores `staff_response` and `archived_at`, required for durable staff response and archive state.

## Captcha / verification (bot)

CIVRAT uses `captcha_enabled`, `captcha_channel_id`, `captcha_role_id`, `captcha_success_message`, and `captcha_failure_message`. Staff publish the persistent Discord panel with `/captcha panel`; members click its button to receive the configured role exactly once. New members receive a best-effort DM reminder linking to the configured verification channel. Expiration, removal of a separate unverified role, and image captchas are not implemented because no canonical configuration fields currently exist for them.

## Temporary Voice (bot)

Temporary Voice uses `temp_voice_enabled`, `temp_voice_creator_channel_id`, and `temp_voice_category`. The creator channel identifier is the minimal required canonical field added by this module; without it the bot cannot know which voice channel triggers creation. CIVRAT listens to `voiceStateUpdate`, creates one private owner-managed voice channel per member, moves the member, persists the channel mapping in MongoDB, removes empty channels, and cleans orphaned records at startup.

## Dashboard ↔ Bot configuration synchronization

The active React `GuildContext` now loads `guild_configs` from Supabase when a guild is selected and persists every module save using an upsert on `guild_id`. When `VITE_BOT_API_URL` is configured to the HTTPS-accessible bot API base URL, every successful save sends the current Supabase access token to `POST /api/guilds/:guildId/sync`. The bot validates this bearer token with Supabase, invalidates only that guild cache entry, and warms it immediately. If the optional public URL is absent or unavailable, the Supabase save remains successful and the normal five-minute bot cache TTL is the fallback. `VITE_BOT_API_URL` is a public URL only; never place a bot token, API secret, service-role key, or Discord secret in a Vite variable. The dashboard still uses local demo guild discovery, so live guild/channel/role metadata remains a separate integration task.

## v1.0 production-readiness audit

The Vite dashboard passes lint and production build; dashboard routes are lazy-loaded. All JavaScript bot files pass Node syntax validation and `bot/package-lock.json` pins production dependencies (`npm audit --omit=dev`: no known vulnerabilities at audit time).

Before a public production rollout, apply `supabase-migrations.sql`, replace the default `API_SECRET`, and resolve the explicit security limitations documented below: the active dashboard still discovers demo guilds rather than Discord metadata, Supabase RLS policies in the supplied migration allow all operations, and the bot cache-invalidation API endpoint is not authenticated. These are deployment/security tasks, not completed production guarantees.

## Weekly Discord QA checklist

Before the controlled test week, deploy slash commands with `cd bot && npm run deploy`, run one bot instance only, and apply the current Supabase migration. Static QA completed on this revision: 23 command modules load with unique command names, 22 Discord event modules register exactly once, all bot JavaScript files pass `node --check`, and the dashboard passes lint/build. Runtime QA still requires real Discord, Supabase, and MongoDB credentials; exercise each configured module in a dedicated test guild before public release.

## Hosting source verification and slash-command cleanup

The Arena branch at commit `799b5b4` contains 23 command files and 22 event files. The command loader scans the absolute `bot/src/commands` directory and now logs both its path and discovered file count; a hosting log of 17 loaded commands proves that the process is executing an older/different bot directory, not this branch revision. `deploy.js` already replaces the complete global command collection. To remove historical guild-scoped duplicates once, set `LEGACY_GUILD_ID` to the test-server ID, run `npm run deploy`, then remove that variable. Do not set it to a production guild unless intentionally clearing its old guild-scoped commands.

## Immediate sync authorization

The bot cache sync endpoint validates the Supabase bearer session, resolves the caller’s Discord member record in the requested guild, and requires Discord `Administrator` or `ManageGuild`. It also limits each authenticated user to 20 requests per 15 minutes and coalesces repeated syncs for a guild into at most one reload every 8 seconds. A coalesced save returns HTTP 202; the delayed reload reads the latest Supabase row, so the final saved configuration wins without repeated database calls.

## Backend configuration path (RLS preparation)

When `VITE_BOT_API_URL` is configured, the active dashboard reads and writes `guild_configs` through authenticated Bot API endpoints (`GET`/`PUT /api/guilds/:guildId/config`) rather than direct browser table access. The API validates the Supabase session, Discord guild membership and `Administrator`/`ManageGuild`, then writes through the server-side Supabase client. Configure `SUPABASE_SERVICE_ROLE_KEY` only on Bot-Hosting before strict RLS is enabled. Until then, omitting `VITE_BOT_API_URL` preserves the existing direct-Supabase controlled-test fallback; production must configure the API URL and remove that fallback only after RLS rollout validation.

The Bot API configuration update endpoint accepts only the canonical `guild_configs` allow-list. It rejects unknown keys, malformed Discord IDs, invalid booleans/enums, unsafe numeric ranges, oversized text, and invalid reward/array payloads before any server-side Supabase write.

## Strict Supabase RLS rollout

The supplied migration now removes every policy on sensitive public tables and revokes `anon`/`authenticated` table and sequence privileges. Browser clients cannot read or write `guild_configs`, `giveaways`, `suggestions`, or `tickets` after it is applied. Production requires `VITE_BOT_API_URL` in the dashboard and `SUPABASE_SERVICE_ROLE_KEY` only on Bot-Hosting; the authorized Bot API is then the exclusive gateway after it verifies the Supabase session, Discord membership and guild management permission. Apply the migration in a test project first, then verify dashboard config load/save through the Bot API before applying it to production.

## Discord production metadata

The dashboard authenticates through Supabase Discord OAuth and sends the short-lived Discord provider token only to the authenticated Bot API. `GET /api/discord/guilds` verifies that token matches the Supabase identity, then returns only Discord guilds where the user is owner, `Administrator`, or `ManageGuild`, marking whether CIVRAT is present. After a managed guild is selected, `GET /api/guilds/:guildId/metadata` returns authorized live channels, categories, roles, emojis, and effective member permissions. The provider token is never logged or persisted by the dashboard.

## Guild discovery diagnostics

The Bot API logs only safe counters for Discord guild discovery: whether a provider token header was received, Discord guild count, count after the owner/Admin/ManageGuild filter, count after the CIVRAT-presence filter, and final response count. It never logs provider tokens. A dashboard error now exposes Bot API failures instead of silently displaying an indistinguishable empty guild list.

## Discord OAuth provider-token diagnostics

Supabase provider tokens are captured during the explicit `/auth/callback` PKCE `exchangeCodeForSession` step and kept only in AuthContext memory. They may be absent from a restored `getSession()` result by design, so a browser refresh can require a fresh Discord OAuth authorization before guild discovery. Set `VITE_AUTH_DEBUG=true` only while diagnosing OAuth; it logs token presence and length, identity providers, and metadata keys, never raw access/provider/refresh token values. In Supabase Auth, allow the dashboard `/auth/callback` URL; in Discord Developer Portal, configure the Supabase project callback URL shown by the Discord provider configuration, not a browser secret exchange URL.

## OAuth callback compatibility

CIVRAT supports both Supabase Discord callback formats during the provider migration: PKCE `?code=...` is exchanged explicitly with `exchangeCodeForSession`, while historical implicit `#access_token=...&refresh_token=...` callbacks are accepted with `setSession`. A Discord provider token found in either result is retained only in transient session memory long enough to load the user guilds, then removed. Configure Supabase Auth redirect URLs for `/auth/callback`; configure the Discord Developer Portal redirect URL to the Supabase provider callback URL. Never enable raw token logging; `VITE_AUTH_DEBUG=true` logs only token presence and length.

## Live Discord metadata and dashboard selects

The Bot API now exposes authorized overview, stats, channels, categories, roles, emojis, members, settings and logs routes under `/api/guilds/:guildId/*`. `GuildContext` refreshes guild metadata every 30 seconds while a guild is selected; Discord gateway events update the bot cache between polls. Core configuration selects now derive channel/category/role choices from this metadata rather than hard-coded option IDs. The logs endpoint intentionally returns 501 until persistent event-log storage is introduced; Discord log channels are not a queryable event history.
