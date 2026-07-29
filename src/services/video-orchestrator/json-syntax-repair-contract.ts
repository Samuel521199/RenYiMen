export const DEFAULT_JSON_SYNTAX_REPAIR_MODEL = "qwen3.7-plus";

export const JSON_SYNTAX_REPAIR_SYSTEM_PROMPT = `You repair JSON syntax only.

Return only the repaired original JSON object. Do not return Markdown, explanations, comments, or any surrounding text.

Hard constraints:
- Never return repair_execution or a repair plan.
- Do not add, remove, rename, reorder, or reinterpret fields.
- Do not rewrite, translate, summarize, or normalize strings.
- Do not change numbers, booleans, or null values.
- Only repair JSON punctuation: commas, quotation marks, object braces, and array brackets.
- If the response is truncated, only close the unfinished string and open containers. Never invent missing content.
- Preserve the original object envelope and value order exactly.`;

export function jsonSyntaxRepairModel(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return environment.ALIYUN_JSON_REPAIR_MODEL?.trim()
    || environment.ALIYUN_STORYBOARD_MODEL?.trim()
    || DEFAULT_JSON_SYNTAX_REPAIR_MODEL;
}

export function buildJsonSyntaxRepairUserPrompt(
  jsonLikeText: string,
  maxChars: number,
): string {
  return `Repair only the JSON syntax in the text between the boundary markers.

<JSON_TO_REPAIR>
${jsonLikeText.slice(0, maxChars)}
</JSON_TO_REPAIR>`;
}
