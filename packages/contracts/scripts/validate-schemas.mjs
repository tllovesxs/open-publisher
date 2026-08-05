import { readFile, readdir } from "node:fs/promises";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const suites = [
  {
    directory: new URL("../schemas/v1/", import.meta.url),
    expectedTitles: [
      "ArticleRevision",
      "Artifact",
      "WorkflowDefinition",
      "WorkflowSnapshot",
      "WorkflowRun",
      "ConnectionProfile",
      "PlatformVariant",
      "PublishPlan",
      "PublishJob",
      "PublishReceipt",
      "ContentPackageManifest",
      "SkillManifest",
      "PlatformAdapterManifest",
      "RunEvent",
      "SidecarProtocol",
      "TemplateExtraction",
    ],
  },
  {
    directory: new URL("../schemas/v2/", import.meta.url),
    expectedTitles: [
      "RuntimeProtocolV2",
      "AgentRunV2",
      "AgentEventV2",
      "ArticleFileV2",
      "ArticleWriteV2",
      "ArticlePatchV2",
      "VisualPlanV2",
      "ReviewReportV2",
      "ToolExecutionV2",
    ],
  },
];
const schemas = [];
const seenIds = new Set();

for (const suite of suites) {
  const fileNames = (await readdir(suite.directory))
    .filter((fileName) => fileName.endsWith(".schema.json"))
    .sort();
  for (const fileName of fileNames) {
    const schema = JSON.parse(await readFile(new URL(fileName, suite.directory), "utf8"));
    if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") {
      throw new Error(`${fileName} does not declare JSON Schema draft 2020-12`);
    }
    if (typeof schema.$id !== "string" || seenIds.has(schema.$id)) {
      throw new Error(`${fileName} has a missing or duplicate $id`);
    }
    seenIds.add(schema.$id);
    schemas.push(schema);
  }
}

const ajv = new Ajv2020({ allErrors: true, strictSchema: true, strictTypes: false });
addFormats(ajv);
schemas.forEach((schema) => ajv.addSchema(schema));

for (const schema of schemas) {
  if (ajv.getSchema(schema.$id) === undefined) {
    throw new Error(`Schema failed to compile: ${schema.$id}`);
  }
}
for (const suite of suites) {
  for (const title of suite.expectedTitles) {
    if (!schemas.some((schema) => schema.title === title)) {
      throw new Error(`Missing contract schema: ${title}`);
    }
  }
}

console.log(`Validated ${schemas.length} JSON Schema 2020-12 files.`);
