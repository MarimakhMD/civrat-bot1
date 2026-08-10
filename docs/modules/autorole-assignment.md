# AutoRole Assignment Foundation

This foundation consumes a validated eligibility result and delegates assignment
only through `DiscordAutoRoleTransport.assignRole`. It returns structured
success, skipped, or failure results and emits guild delivery logs through
`AutoRoleLogService`. It does not read configuration, evaluate eligibility,
register routes, assign roles on member join, or use Discord.js directly.

## Intégration guildMemberAdd

`guildMemberAdd` délègue AutoRole au runtime sans logique métier. La validation,
l’attribution et les logs restent dans les services AutoRole. La validation
Discord réelle doit couvrir humains, bots, rôles absents/gérés/trop hauts,
ManageRoles, membres non gérables, rôles déjà présents, logs guild et continuité
Welcome, Captcha, Invites et Security.
