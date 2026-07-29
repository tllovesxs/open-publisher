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
} as const;

export type ContractSchemaName = keyof typeof SCHEMA_IDS;
export type ContractSchemaId = (typeof SCHEMA_IDS)[ContractSchemaName];
