# Guild Settings Module

Guild Settings owns the neutral `/settings` command, category navigation,
translations, service façade, and the catalog linking migrated feature sections.
It depends on core contracts and injected readers; it does not choose Discord
REST endpoints or create persistence clients.

## Access and language

`/settings` is a global Guild command requiring `MANAGE_GUILD`. French and
English use identical key sets. Changing language rebuilds the same categorized
home and never removes a section.

## Catalog

The catalog is the single navigation source for seven non-empty categories and
13 real feature sections. A descriptor contains:

- the existing section `customId`;
- the activation rule;
- the configuration-completeness rule;
- the required permission;
- actual Premium capabilities.

A command without configurable state is not a Settings entry. Modules continue
to own their detailed views and writes; Guild Settings only summarizes and
routes to them.

## Configuration state

The service reads `{ config, available, found, source }` from the guild
configuration layer. Views distinguish persisted values, defaults, cache/memory,
and an unavailable backend. They do not display unconfirmed data as persisted
or infer a zero value from an outage.

## Premium state

Only catalogued Premium capabilities are checked, through the injected singleton
`EntitlementService`. `ENTITLEMENT_GRANTED`, `PREMIUM_REQUIRED`, and
`ENTITLEMENT_UNAVAILABLE` remain distinct. Feature controls stay visible in all
three cases.

See [`admin-settings-premium.md`](admin-settings-premium.md) for the complete
category table and cross-module access model.
