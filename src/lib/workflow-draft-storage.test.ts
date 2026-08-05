import assert from "node:assert/strict";
import test from "node:test";

import {
  clearWorkflowDraft,
  loadWorkflowDraft,
  sanitizeWorkflowDraftParameters,
  saveWorkflowDraft,
  type WorkflowDraftStorage,
} from "./workflow-draft-storage.ts";
import type { WorkflowFormSchema } from "../types/workflow.ts";

class MemoryStorage implements WorkflowDraftStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const mapping = { nodeId: "input", inputPath: ["value"] };
const schema: WorkflowFormSchema = {
  workflowId: "draft-test-workflow",
  version: "2",
  fields: [
    {
      id: "inputs",
      kind: "group",
      label: "Inputs",
      children: [
        { id: "image", kind: "imageUpload", label: "Image", mapping },
        { id: "video", kind: "videoUpload", label: "Video", mapping },
        { id: "prompt", kind: "textInput", label: "Prompt", mapping },
        { id: "strength", kind: "numberSlider", label: "Strength", mapping, validation: { min: 1, max: 10, integer: true } },
        { id: "quality", kind: "select", label: "Quality", mapping, options: [{ value: "std", label: "Standard" }, { value: "pro", label: "Pro" }] },
        { id: "references", kind: "multiImageUpload", label: "References", mapping, maxItems: 2 },
      ],
    },
  ],
};

test("draft sanitizer keeps durable values and drops blob previews and unfinished uploads", () => {
  const parameters = sanitizeWorkflowDraftParameters(schema, {
    inputs: {
      image: { status: "ready", previewUrl: "blob:temporary", remoteUrl: "https://oss/image.png", fileName: "image.png" },
      video: { status: "uploading", previewUrl: "blob:video", fileName: "video.mp4" },
      prompt: "keep this prompt",
      strength: 99,
      quality: "pro",
      references: {
        items: [
          { id: "a", status: "ready", previewUrl: "blob:a", remoteUrl: "https://oss/a.png", fileName: "a.png" },
          { id: "b", status: "error", previewUrl: "blob:b" },
          { id: "c", status: "ready", remoteUrl: "https://oss/c.png" },
        ],
      },
    },
  });

  assert.deepEqual(parameters, {
    inputs: {
      image: { status: "ready", remoteUrl: "https://oss/image.png", fileName: "image.png" },
      video: { status: "empty" },
      prompt: "keep this prompt",
      strength: 10,
      quality: "pro",
      references: {
        items: [
          { id: "a", status: "ready", remoteUrl: "https://oss/a.png", fileName: "a.png" },
          { id: "c", status: "ready", remoteUrl: "https://oss/c.png" },
        ],
      },
    },
  });
});

test("drafts are isolated by user and SKU and can be cleared", () => {
  const storage = new MemoryStorage();
  const parameters = sanitizeWorkflowDraftParameters(schema, {
    inputs: { prompt: "user A draft", quality: "std", strength: 4 },
  });

  assert.equal(saveWorkflowDraft(storage, "user-a", "SKU_A", schema, parameters), true);
  assert.equal(loadWorkflowDraft(storage, "user-b", "SKU_A", schema), null);
  assert.equal(loadWorkflowDraft(storage, "user-a", "SKU_B", schema), null);
  assert.equal(
    ((loadWorkflowDraft(storage, "user-a", "SKU_A", schema)?.inputs as Record<string, unknown>).prompt),
    "user A draft",
  );

  clearWorkflowDraft(storage, "user-a", "SKU_A");
  assert.equal(loadWorkflowDraft(storage, "user-a", "SKU_A", schema), null);
});

test("an unfinished replacement upload does not overwrite the last complete draft", () => {
  const storage = new MemoryStorage();
  const complete = sanitizeWorkflowDraftParameters(schema, {
    inputs: {
      image: { status: "ready", remoteUrl: "https://oss/original.png" },
      prompt: "complete",
    },
  });
  assert.equal(saveWorkflowDraft(storage, "user-a", "SKU_A", schema, complete), true);

  const uploading = {
    ...complete,
    inputs: {
      ...(complete.inputs as Record<string, unknown>),
      image: { status: "uploading", previewUrl: "blob:new" },
      prompt: "not complete yet",
    },
  };
  assert.equal(saveWorkflowDraft(storage, "user-a", "SKU_A", schema, uploading), false);

  const restored = loadWorkflowDraft(storage, "user-a", "SKU_A", schema);
  assert.equal(((restored?.inputs as Record<string, unknown>).prompt), "complete");
  assert.deepEqual((restored?.inputs as Record<string, unknown>).image, {
    status: "ready",
    remoteUrl: "https://oss/original.png",
  });
});

test("unavailable browser storage does not break form startup", () => {
  const unavailable: WorkflowDraftStorage = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
    removeItem() { throw new Error("blocked"); },
  };
  assert.equal(loadWorkflowDraft(unavailable, "user-a", "SKU_A", schema), null);
  assert.equal(
    saveWorkflowDraft(unavailable, "user-a", "SKU_A", schema, sanitizeWorkflowDraftParameters(schema, {})),
    false,
  );
  assert.doesNotThrow(() => clearWorkflowDraft(unavailable, "user-a", "SKU_A"));
});
