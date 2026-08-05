# Wandao interoperability

Open Publisher and Wandao remain separate applications. They do not share a database, credential
store, runtime environment, or plugin process.

## v0.1 exchange path

The authenticated Sidecar API returns a bounded `ContentPackage` transfer document (canonical
Markdown plus Base64 assets). A trusted desktop or CLI boundary materializes it into the portable
directory form:

```text
content-package/
  manifest.json
  articles/
    <stable-article-id>.md
  assets/
    <sha256>.<extension>
```

The Markdown file is the portable source of truth. Local asset references are relative and remain
inside the package directory. `manifest.json` adds the producing `sourceApp`, stable identities,
hashes, provenance, and revision metadata for tools that understand ContentPackage v1.

Wandao already accepts a local Markdown directory for its import providers. Point Wandao at the
exported `articles` directory for the compatibility path. A future Wandao provider can read the
manifest for richer metadata without changing either application's private storage.

The trusted Rust desktop boundary materializes a transfer document. It never overwrites an existing
directory and verifies the canonical manifest hash plus every entry's byte length and SHA-256 digest.

## Manifest hash

`packageHash` is the SHA-256 of the canonical manifest with `packageHash` omitted, entries sorted
by normalized POSIX path, and platform variant IDs sorted lexicographically. Entry hashes bind the
actual Markdown and asset bytes. The v0.1 manifest domain uses only strings and integers, allowing
all clients to produce the same RFC 8785-compatible canonical bytes.

## Import rules

- Resolve every referenced path against the selected package root.
- Reject absolute paths, parent traversal, symlinks escaping the package, and hash mismatches.
- Treat imported HTML as untrusted and sanitize it before preview.
- Copy bytes into Open Publisher's content-addressed artifact store; never retain a mutable
  dependency on the original directory.
- Preserve the source application and source revision as provenance.

## Deliberate non-goals

- Open Publisher does not invoke Wandao's internal runtime modules.
- Wandao does not receive model or publishing credentials.
- Neither application silently edits the other's files.
- ContentPackage is not a remote synchronization protocol in v0.1.
