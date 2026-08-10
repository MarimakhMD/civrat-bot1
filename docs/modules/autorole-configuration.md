# AutoRole Configuration Foundation

AutoRole Configuration Foundation provides Free guild settings only: enablement,
one member role, and one bot role. All reads and writes use
`GuildConfigResolver` through `AutoRoleService`. Every route requires
`ManageGuild` and uses the shared interaction and translation contracts.

This foundation does not assign roles, inspect role hierarchy, inspect
ManageRoles, handle `guildMemberAdd`, or implement Premium rules. Those
responsibilities are intentionally deferred to a later approved block.
