# Phase 2 — Guild Settings Reference Module

Guild Settings is the first production integration of the core. It adds a
minimal ephemeral `/settings` panel and language selection while preserving all
legacy interaction paths. Configuration reads and writes use the stable
GuildConfigResolver contract; the module never accesses Supabase directly.
