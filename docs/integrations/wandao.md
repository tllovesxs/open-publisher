# Wandao interoperability

Open Publisher and Wandao remain separate applications. They do not share a database, credential
store, Python environment, or plugin process.

## v0.1 exchange path

Open Publisher exports a `ContentPackage` directory:

```text
content-package/
  manifest.json
  articles/
    <stable-article-id>.md
  assets/
    <sha256>.<extension>
```

The Markdown file is the portable source of truth. Local asset references are relative and remain
inside the package directory. `manifest.json` adds stable identities, hashes, provenance, and
revision metadata for tools that understand ContentPackage v1.

Wandao already accepts a local Markdown directory for its import providers. Point Wandao at the
exported `articles` directory for the compatibility path. A future Wandao provider can read the
manifest for richer metadata without changing either application's private storage.

## Import rules

- Resolve every referenced path against the selected package root.
- Reject absolute paths, parent traversal, symlinks escaping the package, and hash mismatches.
- Treat imported HTML as untrusted and sanitize it before preview.
- Copy bytes into Open Publisher's content-addressed artifact store; never retain a mutable
  dependency on the original directory.
- Preserve the source application and source revision as provenance.

## Deliberate non-goals

- Open Publisher does not invoke Wandao's internal Python modules.
- Wandao does not receive model or publishing credentials.
- Neither application silently edits the other's files.
- ContentPackage is not a remote synchronization protocol in v0.1.
