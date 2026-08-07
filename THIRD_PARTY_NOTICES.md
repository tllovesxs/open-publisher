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

## Baoyu Skills / Article Illustrator

- Project: <https://github.com/JimLiu/baoyu-skills>
- Reviewed revision: `6b7a2e417500561a5ecdd0b168332f4142584617`
- License observed at that revision: MIT
- Use in Open Publisher: the built-in visual planning Agent follows the upstream article
  illustration workflow and reads its original Markdown resources at runtime
- Copied source: a fixed `skills/baoyu-article-illustrator/` documentation snapshot, including
  its references and `prompts/system.md`, is bundled at
  `services/agent-runtime/resources/baoyu-article-illustrator/`.
  It contains no upstream executable entrypoint, provider implementation, or platform adapter.
- Integrity: `SKILL.md` SHA-256 at the pinned revision is
  `5f99fc77bdf524fe0cfff36f17844ce6425ae2c45cb139836fe77727dcb65370`.

Copyright (c) 2026 Jim Liu. The bundled upstream documentation is available under the MIT License:

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
> associated documentation files (the "Software"), to deal in the Software without restriction,
> including without limitation the rights to use, copy, modify, merge, publish, distribute,
> sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions: The above copyright notice and this
> permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
> BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
> NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
> DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## GetDesign / awesome-design-md

- Project: <https://github.com/VoltAgent/awesome-design-md>
- Tool version: `getdesign@0.6.24`
- License reported by the npm package: MIT
- Use in Open Publisher: visual research for the desktop UI refactor
- Generated reference: `docs/design/references/airbnb/DESIGN.md`
- Copied brand assets, logos, fonts, screenshots or application code: none

The generated design analysis is a research reference. Open Publisher uses its own product
structure, components, color tokens and typography, and does not bundle Airbnb Cereal or other
Airbnb brand assets.

## Pi Agent Core and Pi AI

- Project: <https://github.com/earendil-works/pi>
- Packages: `@earendil-works/pi-agent-core@0.83.0`, `@earendil-works/pi-ai@0.83.0`
- License: MIT
- Copyright: Copyright (c) 2025 Mario Zechner
- Use in Open Publisher: model/provider streaming, Agent tool loop, cancellation, steering,
  sessions, and context compaction behind the local `PiAgentAdapter`
- Copied source: none; the packages are installed as pinned runtime dependencies

The Pi packages are used without their TUI, unrestricted Bash/filesystem tools, or coding-agent
system prompt. Their MIT license text is distributed with the packaged dependency notices.

## WechatSync Local Bridge

- Project: <https://github.com/wechatsync/Wechatsync>
- Reviewed upstream revision: `a98e42865387285afcc027c61836488748f3b30f` (`v2`)
- Use in Open Publisher: an optional, user-managed local bridge for reading adapter login status
  and saving approved article drafts through its documented `127.0.0.1` request protocol
- Copied source, extension assets, cookies, tokens or adapter logic: none
- Distribution: Open Publisher does not bundle the WechatSync extension, CLI, MCP server, or
  browser adapters. Users install and configure those components independently.

The upstream repository root declares GPL-3.0 while individual CLI/MCP package manifests declare
MIT. This integration intentionally stays at a process and loopback-HTTP boundary; it is not a
fork or bundled derivative. Before distributing any WechatSync source or binary with Open
Publisher, obtain a written clarification from its maintainers and comply with the applicable
license and notice requirements.

## Humanizer-zh

- Project: <https://github.com/op7418/Humanizer-zh>
- Reviewed revision: `91f3d394db8419c20d67ebe22a96cf8fee0a404b`
- License: MIT
- Copyright: Copyright (c) 2026 歸藏
- Use in Open Publisher: the optional deep de-AI editing mode uses an independently adapted
  Chinese checklist of detectable writing patterns
- Copied executable code or assets: none

The adapted checklist preserves Open Publisher's own Writer contract and article storage flow. It
is loaded only for an explicit deep de-AI rewrite; ordinary creation uses the shorter built-in
natural-writing rules.

## Dependency notices

JavaScript and Rust package dependencies retain their own licenses. Before a public
binary release, generate a machine-readable dependency inventory and review every runtime
dependency. Development-only dependencies are not automatically part of the distributed product.
