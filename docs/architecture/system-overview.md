# System overview

Open Publisher is one desktop product composed of three local trust zones and an optional browser
companion. The process split is intentional: presentation, credentials, AI orchestration, and
remote publishing do not share equal authority.

```mermaid
flowchart LR
    subgraph Desktop["Tauri desktop"]
        UI["React workspace<br/>Markdown + review UI"]
        Host["Rust host<br/>validation · secrets · supervision"]
        UI -->|"typed Tauri commands"| Host
    end

    subgraph Runtime["Authenticated local Sidecar"]
        API["FastAPI application"]
        Harness["RunController / Harness"]
        Graph["LangGraph workflows"]
        Artifacts["SQLite + artifact store"]
        Publish["Deterministic PublishService"]
        API --> Harness --> Graph
        API --> Artifacts
        Harness --> Artifacts
        API --> Publish --> Artifacts
    end

    Host -->|"loopback + per-launch token"| API
    Host -->|"short-lived secret lease"| Runtime
    Graph -->|"structured artifacts only"| Publish
    Publish -->|"official API when available"| Platforms["Publishing platforms"]

    subgraph Browser["MV3 browser companion"]
        Worker["Service worker"]
        Adapter["Editor adapter"]
        Worker --> Adapter
    end

    Publish -->|"scoped task + nonce"| Worker
    Adapter -->|"draft fill / NEEDS_USER"| Platforms
    Wandao["Wandao"] <-->|"ContentPackage v1"| Artifacts
```

## Canonical data flow

```mermaid
flowchart TD
    Sources["Topic · URLs · notes · Wandao package"] --> Research["ResearchBundle"]
    Research --> Outline["Outline"]
    Outline --> Revision["ArticleRevision<br/>canonical Markdown"]
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

The arrows describe artifact dependencies, not permission inheritance. Producing a later artifact
does not grant an agent permission to perform a remote write.

## Deployment modes

- **v0.1 local desktop:** all orchestration and storage run on the user's machine. No hosted
  account is required.
- **optional external model gateway:** a user may configure an OpenAI-compatible endpoint. The
  gateway is not bundled and remains behind `ModelAccessLayer`.
- **future cloud runner:** scheduling and team collaboration may add a server later, but it must
  use the same versioned contracts, approval binding, and outbox semantics.
