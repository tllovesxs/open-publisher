# System overview

Open Publisher is one local-first desktop product composed of three trust zones and an optional
browser companion. Presentation, operating-system authority, Agent orchestration, and remote
publishing do not share equal authority.

```mermaid
flowchart LR
    subgraph Desktop["Tauri desktop"]
        UI["React workspace<br/>Markdown + review UI"]
        Host["Rust host<br/>scope · secrets · supervision"]
        UI -->|"typed Tauri commands"| Host
    end

    subgraph Runtime["Authenticated TypeScript Sidecar"]
        API["Hono loopback API"]
        Pi["Pi Agent adapter"]
        Tools["Scoped product tools"]
        Store["SQLite + Markdown + artifacts"]
        Publish["PublishService<br/>outbox + idempotency"]
        API --> Pi --> Tools
        API --> Store
        Tools --> Store
        API --> Publish --> Store
    end

    Host -->|"loopback + per-launch token"| API
    Host -.->|"short-lived secret lease"| Pi
    Pi -->|"structured tool requests"| Tools
    Publish -->|"explicitly approved draft sync"| Bridge["Browser publishing bridge"]
    Bridge --> Platforms["Publishing platforms"]

    subgraph Browser["MV3 browser companion"]
        Worker["Service worker"]
        Adapter["Platform editor adapters"]
        Worker --> Adapter
    end

    Worker -->|"keeps browser login state"| Platforms
    Adapter -->|"draft fill / NEEDS_USER"| Platforms
    Wandao["Wandao"] <-->|"ContentPackage v1"| Store
```

## Canonical data flow

```mermaid
flowchart TD
    Sources["Topic · URLs · project · notes"] --> Writer["Writer Agent + scoped tools"]
    Writer --> Working["Recoverable .working.md"]
    Working --> Revision["Atomic ArticleRevision<br/>canonical Markdown"]
    Revision --> Review["Review + risk reports"]
    Revision --> Visual["VisualPlan + assets"]
    Revision --> Variants["PlatformVariant per target"]
    Review --> Approval{"Human approval policy"}
    Visual --> Approval
    Variants --> Approval
    Approval -->|"approved hashes"| Plan["Immutable PublishPlan"]
    Plan --> Job["Durable outbox job"]
    Job --> Receipt["PublishReceipt"]
```

The arrows describe artifact dependencies, not permission inheritance. An Agent can request a
scoped local tool, but cannot acquire secrets, arbitrary filesystem access, or publication rights.

## Deployment modes

- **Local desktop:** Rust starts a Bun-compiled TypeScript Sidecar. No hosted account is required.
- **Development and release:** Rust starts the same TypeScript/Pi Runtime entrypoint. Legacy Python
  source is migration history and is not an executable desktop path.
- **Optional model endpoint:** users may configure a supported provider or OpenAI-compatible
  endpoint. Provider capabilities are probed rather than inferred from a model name.
- **Browser draft sync:** approved jobs use the browser companion's existing login session. The
  Runtime never exports cookies and never bypasses platform verification.
- **Future Web deployment:** reuses contracts and domain interfaces, but requires new identity,
  tenant, secret, and worker implementations rather than exposing the desktop Sidecar.

ADR 0003 and `pi-agent-runtime-migration.md` are normative for the Runtime migration.
