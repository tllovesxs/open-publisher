# ADR 0002: Open-source and dependency boundaries

- Status: Proposed
- Date: 2026-07-30

## Decision

The application core uses `AGPL-3.0-only` as the provisional repository license, matching the
local-first and open-service goals of the project. Public contracts and SDK packages are designed
so they may later be published under Apache-2.0 to encourage adapter development.

Third-party source, templates, prompts, skills, and browser extensions are not copied into the
core without a recorded source URL, commit, SPDX identifier, attribution, and compatibility review.

AGPL/GPL skills are installed as separately versioned optional packages unless an explicit
compatibility decision says otherwise.

## Open question

Before the first public release, confirm whether the desired business model is AGPL-only or
AGPL plus a commercial license. Replace this ADR and add the full license text at that time.

