# Phase 1 — Isolated Core Foundation

## Goal

Create and test the transport-neutral contracts required for future module
migrations without connecting the core to the current bot runtime.

## Delivered components

- Core domain errors and safe response abstraction
- Centralized permission contract with a disabled Owner provider
- Translation contract with French/English parity validation
- Guild configuration repository and resolver contracts
- Normalized interaction registry and router
- Offline unit tests using only Node.js built-ins and test doubles

## Explicit exclusions

Phase 1 does not migrate commands, events, services, models, configuration,
persistence, dashboard code, or existing interactions. It does not activate the
PostgreSQL-backed CIVRAT owner provider.

## Validation

The phase is accepted only when all static checks and offline core tests pass,
all legacy runtime files remain untouched, and no test opens a Discord,
MongoDB, Supabase, or Express connection.
