export type CreationTaskMode = "create" | "transform";

export interface CreationIntentInput {
  instruction: string;
  hasReferenceText: boolean;
  hasImages: boolean;
}

const sourceReference = /(?:这个内容|这些内容|这段(?:内容|文字)?|这篇(?:文章)?|上述|上面|下方|下面|原文|现有内容|已有内容|附件|附图|图片(?:中|里)的?(?:内容|文字)?)/;
const formatRequest = [
  /(?:加|添加|补上|套用|整理|转换|转成|改成|格式化|优化).{0,12}(?:markdown|md)(?:格式|排版)?/i,
  /(?:markdown|md).{0,10}(?:格式|排版|格式化)/i,
  /(?:调整|优化|整理|重新).{0,8}(?:格式|排版)/i,
];
const sourceEditRequest = /(?:整理|改写|润色|翻译|摘要|校对|修改|优化)/;

/** Page presets are defaults; direct requests to process supplied content win. */
export function inferCreationTaskMode(input: CreationIntentInput): CreationTaskMode {
  const instruction = input.instruction.trim();
  const hasSource = input.hasReferenceText || input.hasImages || sourceReference.test(instruction);
  if (hasSource && formatRequest.some((pattern) => pattern.test(instruction))) return "transform";
  if (hasSource && sourceReference.test(instruction) && sourceEditRequest.test(instruction)) return "transform";
  return "create";
}

export function resolveCreationTaskMode(input: {
  taskMode?: CreationTaskMode;
  topic: string;
  references: string;
  inputImages: readonly unknown[];
}): CreationTaskMode {
  if (input.taskMode === "create" || input.taskMode === "transform") return input.taskMode;
  return inferCreationTaskMode({
    instruction: input.topic,
    hasReferenceText: input.references.trim().length > 0,
    hasImages: input.inputImages.length > 0,
  });
}
