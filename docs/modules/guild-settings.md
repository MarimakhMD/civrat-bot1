# Guild Settings Module

Guild Settings is CIVRAT's reference module for progressive migration. It owns
its neutral command definition, component IDs, translations, handlers, service,
and tests. It depends on core contracts only and does not import Discord.js,
Supabase, MongoDB, or Express.

Phase 2 provides `/settings` and the guild language selector only. Future
settings sections must be added only when their owning module is migrated.
