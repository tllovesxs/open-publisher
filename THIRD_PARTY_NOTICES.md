# Third-party review record

Open Publisher is implemented independently. The repositories below informed product research or
are candidates for optional integration; their source code is not vendored into this repository.

## AIWriteX

- Project: <https://github.com/iniwap/AIWriteX>
- Reviewed revision: `9688554b3bc1db82afe2080dda9a1b14716b16c5`
- License observed at that revision: Apache-2.0
- Use in Open Publisher: feature and architecture research only
- Copied code or assets: none

Apache-2.0 permits reuse with its notice and attribution requirements, but Open Publisher does
not import the project wholesale. Platform adapters in this repository use the local contracts
and safety boundary defined in `packages/platform-sdk`.

## Guizang Social Card Skill

- Project: <https://github.com/op7418/guizang-social-card-skill>
- Reviewed revision: `cf4b810fac1c73fb65a2bb31d8c9278d82cbc4c5`
- License observed at that revision: AGPL-3.0
- Use in Open Publisher: optional visual-skill design reference
- Copied code or assets: none

The Guizang skill is not bundled in v0.1. If a user installs it later, it must remain a separately
versioned package with its copyright, license, source URL, exact revision, and any required source
offer preserved. Open Publisher's built-in `visual-planning` skill emits a structured plan only;
it is an independent implementation.

## Dependency notices

JavaScript, Rust, and Python package dependencies retain their own licenses. Before a public
binary release, generate a machine-readable dependency inventory and review every runtime
dependency. Development-only dependencies are not automatically part of the distributed product.

