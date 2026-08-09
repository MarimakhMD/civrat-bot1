# Welcome Free Module

## Scope

Welcome Free provides server-native Welcome text, Discord embeds, Welcome DMs,
configuration, preview, test delivery, localized feedback, and operational logs.
It does not include Welcome Image, custom backgrounds, avatars, templates, or
other entitlement-controlled image features.

## Administrator flow

```text
/settings → Welcome & Goodbye → configure Welcome → save → preview or test
```

Administrators require `ManageGuild`. The panel provides Welcome enablement,
channel selection, message editing, embed enablement and color editing, Welcome
DM enablement and message editing, previews, tests, and Back navigation.

## Configuration ownership

All reads use `GuildConfigResolver.get()` and all writes use
`GuildConfigResolver.update()`. The module never accesses Supabase directly.
The relevant configuration keys are `welcome_enabled`, `welcome_channel_id`,
`welcome_message`, `welcome_embed_enabled`, `welcome_embed_color`,
`welcome_dm_enabled`, and `welcome_dm_message`.

## Free placeholders

| Placeholder | Value |
| --- | --- |
| `{user}` | User mention or user representation |
| `{mention}` | User mention |
| `{username}` | Username |
| `{displayname}` | Guild display name |
| `{userid}` | Discord user ID |
| `{server}` | Guild name |
| `{membercount}` | Guild member count |
| `{joindate}` | Member join date |

The `WelcomeTemplateRenderer` owns the mapping and supports registered future
providers without changing the rendering engine.

## Delivery and errors

`WelcomeDeliveryService` renders text or embeds through an injected transport.
Transport failures are normalized to safe domain errors. Closed Welcome DMs use
the localized `welcomeGoodbye.dmUnavailable` message. Discord response handling
supports replied and deferred interactions.

## Logs

Delivery events are produced by `WelcomeGoodbyeLogService`. Administrator actions
are produced by `WelcomeAdminLogService`, including Welcome enablement, channel
changes, tests, Embed actions, and Welcome DM actions.

## Localization

The module owns `translations/en.json` and `translations/fr.json`. The runtime
composes these dictionaries using the existing core/Guild Settings composition
mechanism. Translation parity is tested offline; there is no cross-language
fallback.

## Tests

Offline tests cover configuration, channels, modals, embeds, DMs, placeholders,
logs, preview, interaction lifecycle, runtime dictionary composition, and legacy
fallback. Real Discord and Supabase tests remain required before production
acceptance.
