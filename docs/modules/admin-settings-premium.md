# Admin, Settings, and Premium integration

## Runtime surfaces

CIVRAT exposes one technical administration command:

- `/admin` is registered at runtime but deployed only to
  `CIVRAT_ADMIN_GUILD_ID`;
- `/ownerpanel` and `/recovery` are not runtime commands;
- Owner and Recovery services remain internal dependencies of `/admin`.

Normal commands remain global Guild commands. Command deployment is explicit and
separate from startup.

## `/admin` access matrix

Every command, button, select, and modal route requires all of:

| Condition | Source |
| --- | --- |
| Technical guild | `CIVRAT_ADMIN_GUILD_ID` |
| Technical channel | `CIVRAT_ADMIN_CHANNEL_ID` |
| Admin role | `CIVRAT_ADMIN_ROLE_ID` |

Missing or invalid configuration denies access. A denial is ephemeral and
contains only the centralized authorization message.

The operational panel contains only observable data:

- installed guilds from the current Discord client cache;
- runtime, Discord, configuration, and entitlement diagnostics;
- public technical IDs and the 13 effective feature states;
- Premium status, activation/removal/revocation, history, and audit.

Unavailable repositories are labelled unavailable. Counts are not replaced with
zero unless zero was actually read.

## Owner and Recovery

The Owner entry is conditionally rendered only when the current user is the
effective CIVRAT Owner. The user must still satisfy the technical access matrix.
Admin operations do not require an Owner session; Owner operations do.

Opening Owner requests `OWNER_PANEL_MASTER_CODE` in a modal. The existing
`OwnerPanelService` reads the expected value from the environment, hashes both
values for timing-safe comparison, applies attempt throttling, and stores only
an expiring session. The submitted value is not returned or persisted.

Identity changes retain core `CIVRAT_OWNER`, explicit confirmation, transfer
code, expiration, and single-use pending actions. Recovery retains its existing
Master Code plus one-time e-mail code. A successful Recovery grants only a short
in-memory elevation for the dedicated transfer path.

## `/settings` catalog

`/settings` uses seven non-empty categories and 13 existing section routes:

| Category | Sections |
| --- | --- |
| General and roles | AutoRole, temporary voice |
| Protection | AutoMod, security, CAPTCHA |
| Welcome and goodbye | Welcome/Goodbye |
| Tickets | Tickets |
| Community | Giveaways, suggestions |
| Analytics and progression | Analytics, XP, invitations |
| Logs | Logs |

Each category view displays activation status, configuration completeness,
`MANAGE_GUILD`, and any real Premium capability. The language selector remains
in General. Every section returns to the categorized home, and no feature is
hidden when configuration or Premium infrastructure is unavailable.

## Premium

All runtime paths receive the singleton `EntitlementService`. The Tickets
resolver preserves a Free fallback for normal ticket execution but exposes a
ternary `checkAccess()` decision to Premium interactions. Welcome image preview
uses the same service directly.

The centralized missing-Premium view is available in FR and EN, includes
`https://discord.gg/BA3aDFqtXr`, and asks the user to open a ticket. Backend
unavailability uses a distinct message and denies the Premium operation.

## Verification

Offline coverage includes:

- exact command names and deployment scopes;
- technical guild/channel/role and DM denials;
- true Owner visibility and Master Code behavior;
- Recovery confirmation IDs and single-use transfer flow;
- all seven categories and 13 section IDs;
- Premium granted/required/unavailable decisions;
- Free Ticket fallback and Welcome Premium denial;
- Discord component-row limits and FR/EN key parity;
- static enforcement of one production `EntitlementService` constructor.

These checks do not deploy to Discord. Before release, manually verify command
visibility and interactions on the intended three test guilds and the technical
guild, then verify that `/admin` is absent from DMs and nontechnical guilds.
Record actual results; do not infer them from offline tests.
