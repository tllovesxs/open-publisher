# Compatibility and versioning

## Versioned objects

The following objects carry a schema or implementation version:

- workflow definitions and snapshots;
- agent and prompt specifications;
- skills and adapters;
- platform variants;
- publish plans and receipts;
- ContentPackage manifests;
- cross-language events.

## Runtime rule

A workflow run keeps the exact snapshot, agent versions, prompt hashes, skill hashes, adapter
versions, and provider profile identifiers selected at start. Editing a template affects future
runs only.

## Approval rule

An approval is bound to:

- canonical article revision hash;
- platform variant hash;
- selected asset hashes;
- target platform and account;
- requested operation;
- risk-report version.

Changing any bound input invalidates the approval.

