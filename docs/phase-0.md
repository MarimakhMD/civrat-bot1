# Phase 0 — Repository Foundations

## Goal

Prepare repository safety, technical documentation, and offline static checks
without changing the current bot runtime behavior.

## Scope

- Add repository ignore rules and an environment template.
- Add developer-facing project and architecture documentation.
- Add offline static verification scripts.
- Keep all current bot commands, events, services, dependencies, and runtime
  behavior unchanged.

## Explicit exclusions

This phase does not remove dashboard code, start a modular migration, alter
persistence, add translations, change Discord interactions, or fix runtime
behavior discovered during the audit.

## Validation

The phase is accepted only when `npm run check` succeeds, no sensitive runtime
files are tracked, and the implementation changes no bot behavior.
