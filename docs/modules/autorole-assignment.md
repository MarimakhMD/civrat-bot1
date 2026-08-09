# AutoRole Assignment Foundation

This foundation consumes a validated eligibility result and delegates assignment
only through `DiscordAutoRoleTransport.assignRole`. It returns structured
success, skipped, or failure results and emits guild delivery logs through
`AutoRoleLogService`. It does not read configuration, evaluate eligibility,
register routes, assign roles on member join, or use Discord.js directly.
