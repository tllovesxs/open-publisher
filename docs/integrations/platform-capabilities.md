# Platform capability baseline

Support is capability-based instead of a single “supported” checkbox. Every adapter reports what
it can do for the selected account and environment before a publish plan is approved.

| Platform | Preferred route | Current implementation | Final publish | Fallback |
| --- | --- | --- | --- | --- |
| Any adapter reported by the installed WechatSync bridge | WechatSync local bridge | Only adapters reported as logged in are shown. An explicit approval saves one platform draft through `syncArticle`. | User clicks publish | Manual Markdown/asset export |

Open Publisher does not maintain a fixed three-platform allow-list in the UI. The usable set is the
intersection of the installed WechatSync adapters, the browser accounts that are currently logged in,
and the capabilities returned by its local bridge. An unknown adapter ID is rendered as a generic
platform rather than being silently discarded.

The built-in MV3 implementation remains a standalone protocol demonstration. Article-page draft
sync uses the already-running WechatSync local bridge instead: after an explicit approval, the
durable outbox sends one immutable platform variant to `syncArticle` and records the returned draft
receipt. The desktop receives only the platform ID, login status and optional account display name;
it never receives browser Cookies, bridge tokens or account credentials.

## Capability states

- `AVAILABLE`: the adapter and required authorization are ready.
- `NEEDS_CONFIGURATION`: a profile, permission, or browser extension is missing.
- `NEEDS_USER`: the editor changed, login expired, or final confirmation is required.
- `UNSUPPORTED`: the route cannot safely perform the requested operation.
- `UNKNOWN`: a remote write may have happened; reconcile before any retry.

An adapter may report different capabilities for two accounts on the same platform. For example,
a WeChat account can support draft creation but not mass publication.

## Route priority

1. Official documented API.
2. Browser companion scoped to an explicit editor origin.
3. Controlled browser handoff with visible user confirmation.
4. Manual export.

Fallback is never silent. A route change creates a visible event and may require the user to
approve a new publish-plan hash.

## Browser companion boundary

The extension Service Worker accepts a versioned draft task from its own extension pages containing
the article payload, target origin, expiry, and one-use nonce. It does not expose an external
message endpoint, request cookie access, export browser storage, or click a final publish control.
A selector or editor-version mismatch returns `NEEDS_USER`. WechatSync is an independent local
bridge with the same final-publish prohibition; its result is retained as an outbox receipt and an
ambiguous timeout enters `UNKNOWN` for user investigation rather than an automatic retry.

## Live test policy

Default tests use deterministic fake providers and perform no platform writes. A real adapter must
add an opt-in test marker, capability probe, documented rollback/reconciliation procedure, and a
test account before this table can claim production support.
