# ADR 0002: Open-source and dependency boundaries

- Status: Accepted
- Date: 2026-07-30

## Decision

The application core uses `AGPL-3.0-only` as the repository license, matching the local-first and
open-service goals of the project.

If the project later adopts AGPL plus a commercial license, that dual-licensing decision must be
recorded in a separate ADR rather than changing the history of this decision.

Third-party source, templates, prompts, skills, and browser extensions are not copied into the
core without a recorded source URL, commit, SPDX identifier, attribution, and compatibility review.

AGPL/GPL skills are installed as separately versioned optional packages unless an explicit
compatibility decision says otherwise.

## Open question

Should public contracts and SDK packages be released separately under Apache-2.0 to encourage
adapter development?
