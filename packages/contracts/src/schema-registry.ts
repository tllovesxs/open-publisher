export const SCHEMA_IDS = {
  ArticleRevision: "https://schemas.openpublisher.dev/v1/article-revision.schema.json",
  Artifact: "https://schemas.openpublisher.dev/v1/artifact.schema.json",
  WorkflowDefinition: "https://schemas.openpublisher.dev/v1/workflow-definition.schema.json",
  WorkflowSnapshot: "https://schemas.openpublisher.dev/v1/workflow-snapshot.schema.json",
  WorkflowRun: "https://schemas.openpublisher.dev/v1/workflow-run.schema.json",
  ConnectionProfile: "https://schemas.openpublisher.dev/v1/connection-profile.schema.json",
  PlatformVariant: "https://schemas.openpublisher.dev/v1/platform-variant.schema.json",
  PublishPlan: "https://schemas.openpublisher.dev/v1/publish-plan.schema.json",
  PublishJob: "https://schemas.openpublisher.dev/v1/publish-job.schema.json",
  PublishReceipt: "https://schemas.openpublisher.dev/v1/publish-receipt.schema.json",
  ContentPackageManifest:
    "https://schemas.openpublisher.dev/v1/content-package-manifest.schema.json",
  SkillManifest: "https://schemas.openpublisher.dev/v1/skill-manifest.schema.json",
  PlatformAdapterManifest:
    "https://schemas.openpublisher.dev/v1/platform-adapter-manifest.schema.json",
  RunEvent: "https://schemas.openpublisher.dev/v1/run-event.schema.json",
  SidecarProtocol: "https://schemas.openpublisher.dev/v1/sidecar-protocol.schema.json",
  TemplateExtraction:
    "https://schemas.openpublisher.dev/v1/template-extraction.schema.json",
} as const;

export const SCHEMA_IDS_V2 = {
  RuntimeProtocol: "https://schemas.openpublisher.dev/v2/runtime-protocol.schema.json",
  AgentRun: "https://schemas.openpublisher.dev/v2/agent-run.schema.json",
  AgentEvent: "https://schemas.openpublisher.dev/v2/agent-event.schema.json",
  ArticleFile: "https://schemas.openpublisher.dev/v2/article-file.schema.json",
  ArticleWrite: "https://schemas.openpublisher.dev/v2/article-write.schema.json",
  ArticlePatch: "https://schemas.openpublisher.dev/v2/article-patch.schema.json",
  VisualPlan: "https://schemas.openpublisher.dev/v2/visual-plan.schema.json",
  ReviewReport: "https://schemas.openpublisher.dev/v2/review-report.schema.json",
  ToolExecution: "https://schemas.openpublisher.dev/v2/tool-execution.schema.json",
} as const;

export type ContractSchemaNameV2 = keyof typeof SCHEMA_IDS_V2;
export type ContractSchemaIdV2 = (typeof SCHEMA_IDS_V2)[ContractSchemaNameV2];

export type ContractSchemaName = keyof typeof SCHEMA_IDS;
export type ContractSchemaId = (typeof SCHEMA_IDS)[ContractSchemaName];
