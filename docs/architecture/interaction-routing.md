# CIVRAT Interaction Routing Contract

## Purpose

`InteractionRouter` is the single future route dispatcher for slash commands,
autocomplete, buttons, select menus, and modals. It is transport-neutral and
operates on normalized interaction envelopes rather than platform SDK objects.

A future Discord adapter will translate Discord events into envelopes. The core
therefore imports neither Discord.js nor a Discord client.

## Envelope contract

```js
{
  kind: "command" | "autocomplete" | "button" | "select-menu" | "modal",
  name: "command-name",        // commands and autocomplete
  customId: "civrat:v1:...",   // components
  guildId: "..." | null,
  userId: "..." | null,
  member: memberCapability | null,
  locale: "fr" | "en",
  transport: responseTransport
}
```

The transport adapter owns the raw platform interaction and response lifecycle.
The core only requires a `replyError` capability when it must render an error.

## Route registration

Future modules register routes through `InteractionRegistry`. A route requires
an `execute` function and may declare a centralized permission requirement.

Named routes are used for commands and autocomplete. Component routes use exact
or prefix matchers. Duplicate and overlapping routes are rejected at
registration time.

## Persistent component IDs

Future persistent components must use this versioned convention:

```text
civrat:v1:<module>:<action>
```

The version component makes controlled future compatibility changes possible.
Existing component identifiers are intentionally not changed by Phase 1.
