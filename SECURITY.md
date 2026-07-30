# Security policy

## Supported versions

Open Publisher is currently pre-release. Security fixes are applied to the latest development
branch until the first stable release is published.

## Reporting

Do not disclose API keys, cookies, access tokens, unpublished manuscripts, or platform account
details in a public issue. Report security problems privately to the maintainer and include only
the minimum reproduction data needed.

## Product boundaries

- Model and platform secrets belong to the planned Rust secret broker. The v0.1 UI stores only
  `env://`/`mock://` references and keeps the deterministic demo on Mock; Stronghold/keyring
  brokering and short-lived credential leases are not yet implemented.
- Browser cookies remain inside the user's browser profile.
- Agents and third-party skills cannot call public publishing operations directly.
- A publish timeout is reconciled against the remote platform before any retry.
- Real platform integration tests are disabled by default.
- Community skills and adapters are untrusted until their source, permissions, signature, hash,
  and license have been reviewed.

## Test data

Use fake credentials and local fixtures in tests. Logs and exported diagnostics must redact:

- `Authorization`
- `Cookie` and `Set-Cookie`
- API keys and application secrets
- access and refresh tokens
- passwords
- token-bearing URL query parameters
