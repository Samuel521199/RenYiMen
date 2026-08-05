import test from "node:test";
import assert from "node:assert/strict";
import { bailianWanxI2vWorkflowMock } from "../mocks/bailian-wanx-i2v-workflow.ts";
import { isGroupField } from "../types/workflow.ts";
import { useWorkflowStore } from "../store/useWorkflowStore.ts";
import {
  buildFieldPathMap,
  buildInitialParameters,
  isWorkflowFieldVisible,
  iterateLeafFields,
  setAtPath,
} from "./workflow-utils.ts";

test("Wan 2.7 exposes the optional last frame and HappyHorse hides it", () => {
  const fields = [...iterateLeafFields(bailianWanxI2vWorkflowMock.fields)];
  const lastFrame = fields.find((field) => field.id === "lastFrame");
  assert.ok(lastFrame && !isGroupField(lastFrame));
  assert.deepEqual(lastFrame.mapping, { nodeId: "input", inputPath: ["last_frame_url"] });

  const fieldPaths = buildFieldPathMap(bailianWanxI2vWorkflowMock.fields);
  const parameters = buildInitialParameters(bailianWanxI2vWorkflowMock);
  assert.equal(isWorkflowFieldVisible(lastFrame, parameters, fieldPaths), true);

  setAtPath(parameters, fieldPaths.modelName, "happyhorse-1.1-i2v");
  assert.equal(isWorkflowFieldVisible(lastFrame, parameters, fieldPaths), false);
});

test("a hidden last frame is omitted from the gateway payload after switching models", () => {
  const store = useWorkflowStore.getState();
  store.hydrateSchema(bailianWanxI2vWorkflowMock);
  store.setGatewaySelection("BAILIAN_WANX_I2V", "ALIYUN_BAILIAN");
  store.setFieldValue("refImage", {
    status: "ready",
    remoteUrl: "https://example.com/first.png",
  });
  store.setFieldValue("lastFrame", {
    status: "ready",
    remoteUrl: "https://example.com/last.png",
  });
  store.setFieldValue("videoPrompt", "A continuous move between both frames.");

  const wanPayload = store.buildPayload();
  assert.equal(wanPayload?.nodeInputs.input.last_frame_url, "https://example.com/last.png");

  store.setFieldValue("modelName", "happyhorse-1.1-i2v");
  const happyHorsePayload = store.buildPayload();
  assert.equal(happyHorsePayload?.nodeInputs.input.last_frame_url, undefined);
});
