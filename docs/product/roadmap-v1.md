# CIVRAT v1.0 Roadmap

CIVRAT v1.0 targets Free and Premium Discord communities. Enterprise is not a
v1.0 prerequisite and is developed separately after the public v1.0 release is
stable.

## Planning rule

A phase is detailed officially only when it becomes the active priority. At that
point it receives an official name, Free scope, Premium scope, dependencies,
Definition of Done, and a validated technical plan. Future phases remain
planned without prematurely frozen scope or ordering.

## Official phases

| Phase | Name | Status | Scope |
| --- | --- | --- | --- |
| 0 | Repository Foundations | Completed | Repository safety, documentation, environment template, static checks. |
| 1 | Core Foundation | Completed | Transport-neutral contracts for i18n, errors, permissions, configuration and interactions. |
| 2 | Guild Settings | Completed | Discord-native settings entry point, language selection and runtime composition. |
| 3 | Welcome & Goodbye | Ready for Production Validation | Free Welcome and Goodbye capabilities plus Welcome Image Foundation. Real Discord/Supabase validation remains pending. |
| 4 | AutoRole / Onboarding | Planned — Scope and order to be decided before implementation | The next candidate phase; detailed scope is not yet official. |
| 15 | CIVRAT v1.0 Release | Planned — Scope and order to be decided before implementation | Release readiness, production validation and public delivery. |

## Planned phases

The remaining v1.0 phase numbers are intentionally not assigned to a module
until they become the active priority:

```text
Phase 5
Phase 6
Phase 7
Phase 8
Phase 9
Phase 10
Phase 11
Phase 12
Phase 14
```

Status for each:

```text
Planned — Scope and order to be decided before implementation
```

Potential modules mentioned historically, such as Logs, Tickets, Captcha, XP,
Temp Voice, Suggestions, Giveaways, AutoMod, and Security, remain planning
candidates rather than official numbered commitments.

## Phase 3 design pending

Phase 3 is Ready for Production Validation. The following Premium Image
capabilities remain part of the v1.0 product direction but are suspended until
their product and visual design is approved:

- Official Templates
- Premium Personalization
- Random Template
- Premium Entitlements

Welcome Image Foundation is complete and can host those capabilities later
without architecture changes.

## Enterprise boundary

Phase 13 is reserved for the separate Enterprise roadmap and is excluded from
CIVRAT v1.0. See `docs/product/civrat-enterprise-v2-roadmap.md`.
