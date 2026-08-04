import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildInitialParameters } from "../../lib/workflow-utils";
import type { WorkflowFormSchema } from "../../types/workflow";

test("text examples are not hydrated as submitted values", () => {
  const schema: WorkflowFormSchema = {
    workflowId: "text-example-test",
    version: "1",
    fields: [
      {
        kind: "textInput",
        id: "prompt",
        label: "Prompt",
        mapping: { nodeId: "1", inputPath: ["text"] },
        defaultValue: "Example prompt",
      },
    ],
  };

  assert.deepEqual(buildInitialParameters(schema), { prompt: "" });
});

test("all workflow text controls render examples as lighter placeholders", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/components/WorkflowForm/controls/TextInputControl.tsx"),
    "utf8",
  );

  assert.match(source, /field\.defaultValue \|\| field\.placeholder/);
  assert.match(source, /placeholder:text-slate-500/);
});

test("one-prompt video starts empty and displays its example as a placeholder", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/app/(platform)/workbench/workflows/one-prompt-video/page.tsx"),
    "utf8",
  );

  assert.match(source, /const \[prompt, setPrompt\] = useState\(""\)/);
  assert.match(source, /placeholder=\{copy\.defaultPrompt\}/);
});
