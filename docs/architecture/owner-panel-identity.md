# Owner identity used by `/admin`

Statut : **architecture active et DDL documentaire**. Les requêtes SQL ne sont
pas exécutées automatiquement par le bot ; le propriétaire applique les tables
avec le SQL editor Supabase.

The historical `owner-panel` module now supplies identity, authentication,
confirmation, and transfer services to the Owner section of `/admin`.
`/ownerpanel` is no longer a runtime or deployment command.

## 1. Why persistence is required

The initial CIVRAT Owner comes from `CIVRAT_OWNER_ID`. Runtime Owner operations
can transfer ownership and maintain the CIVRAT identity-admin list. Without
persistence, a transfer would be reversed on restart and the previous Owner
would regain authority.

A persisted Owner therefore takes precedence over `CIVRAT_OWNER_ID`. The
environment value is only the initial fallback while no Owner row exists.

## 2. Stored data — no secret

| Table | Columns | Content |
| --- | --- | --- |
| `civrat_owner_state` | `id` (singleton 1), `owner_id`, `updated_at` | current CIVRAT Owner Discord ID |
| `civrat_admins` | `user_id`, `added_at` | CIVRAT identity-admin Discord IDs |

These are public Discord IDs, not credentials. `OWNER_PANEL_MASTER_CODE`,
`OWNER_TRANSFER_CODE`, Recovery/SMTP values, tokens, and passwords remain only
in the hosting environment. They are never stored in these tables.

The technical Discord role is the current authority for operational `/admin`
access. Membership in `civrat_admins` never bypasses the configured technical
guild, channel, or role. The persisted list remains identity/governance data
managed by the existing Owner tools.

## 3. Documentary DDL

```sql
create table if not exists public.civrat_owner_state (
  id smallint primary key default 1,
  owner_id text not null,
  updated_at timestamptz not null default now(),
  constraint civrat_owner_state_singleton check (id = 1)
);

create table if not exists public.civrat_admins (
  user_id text primary key,
  added_at timestamptz not null default now()
);
```

The tables are independent. `create table if not exists` does not migrate an
incompatible existing table. If RLS is active, use the approved service-role
access or explicit policies.

## 4. Current access model

```text
/admin route
   │
   ├─ technical guild + technical channel + Admin role ──► Admin tools
   │
   └─ same technical guard + effective CIVRAT Owner
          + OWNER_PANEL_MASTER_CODE session ─────────────► Owner tools
```

- `CIVRAT_ADMIN` requires all three technical conditions on every interaction.
- Admin tools do not require an Owner session.
- Only `CivratIdentityService.isOwner()` causes the Owner entry to be rendered.
- Owner content requires `OWNER_PANEL_MASTER_CODE`: timing-safe comparison,
  five-attempt lock policy, and expiring memory-only session.
- Owner actions require both core permissions (`CIVRAT_ADMIN`,
  `CIVRAT_OWNER`) and recheck the session in their handlers.
- Add/remove identity-admin and transfer actions use explicit, expiring,
  single-use confirmation state.
- Normal ownership transfer additionally requires `OWNER_TRANSFER_CODE`.
- A successful transfer revokes the old Owner session and persisted identity
  takes precedence after restart.

## 5. Recovery transfer

Recovery is entered from `/admin`, not from `/recovery`. It retains the existing
Master Code plus one-time e-mail code and grants a short in-memory elevation.
That elevation:

1. does not grant `CIVRAT_OWNER`;
2. exposes no Owner/identity data;
3. opens only the dedicated transfer route;
4. must still be active at submit and confirmation;
5. requires `OWNER_TRANSFER_CODE` and valid target ID;
6. is consumed after a successful transfer.

Recovery confirmation and cancel use dedicated component IDs, so an elevated
user cannot enter the normal Owner confirmation route.

## 6. Failure and offline behavior

With no identity repository, reads use `CIVRAT_OWNER_ID` and an empty admin list;
all identity mutations fail closed. Sessions, lockouts, pending confirmations,
and Recovery elevations are process memory and disappear on restart. No secret
value is written to logs or responses.

Technical authorization and identity authorization are intentionally separate:
a backend outage cannot make someone Owner, and an Owner without the configured
technical role/channel/guild cannot use `/admin`.

## 7. References

- identity/services: `src/modules/owner-panel/`;
- integrated registration: `src/modules/admin-panel/register.js`;
- core permissions: `PermissionName.CIVRAT_ADMIN` and
  `PermissionName.CIVRAT_OWNER`;
- runtime composition: `src/runtime/createGuildSettingsRuntime.js`;
- Recovery elevation: `src/modules/recovery/runtime/getRecoveryRuntime.js`.
