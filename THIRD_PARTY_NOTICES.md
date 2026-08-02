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
  `services/agent-runtime/src/open_publisher_runtime/resources/baoyu-article-illustrator/`.
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

## Dependency notices

JavaScript, Rust, and Python package dependencies retain their own licenses. Before a public
binary release, generate a machine-readable dependency inventory and review every runtime
dependency. Development-only dependencies are not automatically part of the distributed product.
