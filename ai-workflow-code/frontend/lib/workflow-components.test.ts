import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const workflowComponentModuleCache = new Map<string, Promise<unknown>>();

function patchWorkflowComponentImports(source: string, componentPath: string) {
  if (componentPath.endsWith("ModelSelector.tsx")) {
    return source.replace(
      'import { ACTIVITY_INPUT_CLASS } from "@/lib/activity-workflow-theme";',
      'const ACTIVITY_INPUT_CLASS = "activity-input";',
    );
  }

  if (componentPath.endsWith("GenerateButton.tsx")) {
    return source.replace(
      'import { ACTIVITY_PRIMARY_BUTTON_CLASS } from "@/lib/activity-workflow-theme";',
      'const ACTIVITY_PRIMARY_BUTTON_CLASS = "activity-primary";',
    );
  }

  if (componentPath.endsWith("StepLayout.tsx")) {
    return source.replace(
      /import\s*\{\s*ACTIVITY_PRIMARY_BUTTON_CLASS,\s*ACTIVITY_SECONDARY_BUTTON_CLASS,\s*ACTIVITY_STEP_RAIL_CLASS,\s*getActivityStepCardClasses,\s*\}\s*from\s*"@\/lib\/activity-workflow-theme";/,
      `const ACTIVITY_PRIMARY_BUTTON_CLASS = "activity-primary";
const ACTIVITY_SECONDARY_BUTTON_CLASS = "activity-secondary";
const ACTIVITY_STEP_RAIL_CLASS = "activity-step-rail";
function getActivityStepCardClasses({ active, finished, clickable }: { active: boolean; finished: boolean; clickable: boolean }) {
  return [active ? "active" : "", finished ? "finished" : "", clickable ? "clickable" : "locked"].filter(Boolean).join(" ");
}`,
    );
  }

  return source;
}

async function loadWorkflowComponent(componentPath: string) {
  if (!workflowComponentModuleCache.has(componentPath)) {
    workflowComponentModuleCache.set(
      componentPath,
      (async () => {
        const source = readFileSync(componentPath, "utf8");
        const patchedSource = patchWorkflowComponentImports(source, componentPath);
        const transpiled = ts.transpileModule(patchedSource, {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2020,
            jsx: ts.JsxEmit.ReactJSX,
          },
          fileName: componentPath,
        }).outputText;
        const tempDir = mkdtempSync(join(process.cwd(), "frontend", ".workflow-component-"));
        const tempFile = join(tempDir, basename(componentPath).replace(/\.tsx$/, ".mjs"));
        writeFileSync(tempFile, transpiled, "utf8");
        const moduleUrl = `${pathToFileURL(tempFile).href}?t=${Date.now()}-${Math.random()}`;
        const loadedModule = await import(moduleUrl);
        rmSync(tempDir, { recursive: true, force: true });
        return loadedModule;
      })(),
    );
  }

  const componentModule = (await workflowComponentModuleCache.get(componentPath)) as { default: (props: any) => unknown };
  return componentModule.default;
}

async function renderWorkflowComponent(componentPath: string, props: Record<string, unknown>) {
  const Component = await loadWorkflowComponent(componentPath);
  return renderToStaticMarkup(createElement(Component, props));
}

test("workflow ModelSelector exposes shared props and optional price display", () => {
  const source = readFileSync("frontend/components/workflow/ModelSelector.tsx", "utf8");

  assert.match(source, /interface ModelSelectorProps/);
  assert.match(source, /models:\s*ModelConfig\[\]/);
  assert.match(source, /value:\s*number \| null/);
  assert.match(source, /onChange:\s*\(id: number\) => void/);
  assert.match(source, /showPrice\?:\s*boolean/);
  assert.match(source, /disabled\?:\s*boolean/);
  assert.match(source, /showPrice = true/);
  assert.match(source, /selectedModel/);
  assert.match(source, /provider/);
  assert.match(source, /price_per_image\?:\s*number \| string \| null/);
});

test("workflow GenerateButton centralizes labels and loading state", () => {
  const source = readFileSync("frontend/components/workflow/GenerateButton.tsx", "utf8");

  assert.match(source, /interface GenerateButtonProps/);
  assert.match(source, /label\?:\s*string/);
  assert.match(source, /loadingLabel\?:\s*string/);
  assert.match(source, /label = "开始生成"/);
  assert.match(source, /loadingLabel = "生成中\.\.\."/);
  assert.match(source, /disabled=\{disabled \|\| loading\}/);
});

test("workflow ImageReviewCard exposes status actions and extra slot", () => {
  const source = readFileSync("frontend/components/workflow/ImageReviewCard.tsx", "utf8");

  assert.match(source, /interface ImageReviewCardProps/);
  assert.match(source, /type ImageReviewStatus = "pending" \| "approved" \| "rejected" \| "refine"/);
  assert.match(source, /status:\s*ImageReviewStatus/);
  assert.match(source, /onApprove\?:\s*\(\) => void/);
  assert.match(source, /onReject\?:\s*\(\) => void/);
  assert.match(source, /onRegenerate\?:\s*\(\) => void/);
  assert.match(source, /onRefine\?:\s*\(\) => void/);
  assert.match(source, /onRevoke\?:\s*\(\) => void/);
  assert.match(source, /extra\?:\s*React\.ReactNode/);
  assert.match(source, /reviewStatusLabel/);
  assert.match(source, /待筛选/);
  assert.match(source, /已废弃/);
});

test("workflow StepLayout and WorkflowStepHeader provide shared step framing", () => {
  const stepLayoutSource = readFileSync("frontend/components/workflow/StepLayout.tsx", "utf8");
  const headerSource = readFileSync("frontend/components/workflow/WorkflowStepHeader.tsx", "utf8");

  assert.match(stepLayoutSource, /interface StepLayoutProps/);
  assert.match(stepLayoutSource, /currentStep:\s*number/);
  assert.match(stepLayoutSource, /steps:\s*\{\s*label: string\s*\}\[\]/);
  assert.match(stepLayoutSource, /onNext\?:\s*\(\) => void/);
  assert.match(stepLayoutSource, /children:\s*React\.ReactNode/);
  assert.match(headerSource, /interface WorkflowStepHeaderProps/);
  assert.match(headerSource, /actions\?:\s*React\.ReactNode/);
  assert.match(headerSource, /Step \{step\}/);
});

test("workflow WhitespacePositionPicker is extracted into shared component", () => {
  const source = readFileSync("frontend/components/workflow/WhitespacePositionPicker.tsx", "utf8");

  assert.match(source, /interface WhitespacePositionPickerProps/);
  assert.match(source, /value:\s*string\[\]/);
  assert.match(source, /onChange:\s*\(positions: string\[\]\) => void/);
  assert.match(source, /aria-label="留白位置示意图"/);
  assert.match(source, /strokeDasharray="3 3"/);
});

test("background and activity pages import shared workflow components", () => {
  const backgroundSource = readFileSync("frontend/app/workflows/background/page.tsx", "utf8");
  const activitySource = readFileSync("frontend/app/workflows/activity/page.tsx", "utf8");

  assert.match(backgroundSource, /@\/components\/workflow\/ModelSelector/);
  assert.match(backgroundSource, /@\/components\/workflow\/GenerateButton/);
  assert.match(backgroundSource, /@\/components\/workflow\/ImageReviewCard/);
  assert.match(backgroundSource, /@\/components\/workflow\/StepLayout/);
  assert.match(backgroundSource, /@\/components\/workflow\/WorkflowStepHeader/);
  assert.match(backgroundSource, /@\/components\/workflow\/WhitespacePositionPicker/);

  assert.match(activitySource, /@\/components\/workflow\/ModelSelector/);
  assert.match(activitySource, /@\/components\/workflow\/GenerateButton/);
  assert.match(activitySource, /@\/components\/workflow\/StepLayout/);
  assert.match(activitySource, /@\/components\/workflow\/WorkflowStepHeader/);
});

test("expression page imports shared workflow framing and generation components", () => {
  const expressionSource = readFileSync("frontend/app/workflows/expression/page.tsx", "utf8");

  assert.match(expressionSource, /@\/components\/workflow\/ModelSelector/);
  assert.match(expressionSource, /@\/components\/workflow\/GenerateButton/);
  assert.match(expressionSource, /@\/components\/workflow\/StepLayout/);
  assert.match(expressionSource, /@\/components\/workflow\/WorkflowStepHeader/);
});

test("workflow ModelSelector renders safely with nullable model metadata", async () => {
  const html = await renderWorkflowComponent("frontend/components/workflow/ModelSelector.tsx", {
    models: [
      {
        id: 1,
        name: "Nullable Model",
        provider: "openai",
        model_name: "gpt-image-1",
        price_per_image: null,
        usage_type: undefined,
      },
    ],
    value: 1,
    onChange: () => undefined,
  });

  assert.match(html, /Nullable Model/);
  assert.match(html, /openai/);
  assert.match(html, /\$0\.0000/);
});

test("workflow ModelSelector renders with an empty model list without listing model options", async () => {
  const html = await renderWorkflowComponent("frontend/components/workflow/ModelSelector.tsx", {
    models: [],
    value: null,
    onChange: () => undefined,
  });

  assert.match(html, /请选择模型/);
  assert.equal(html.includes("Nullable Model"), false);
  assert.equal(html.includes("<option value=\"1\">"), false);
});

test("workflow GenerateButton shows loading label and disabled state while loading", async () => {
  const html = await renderWorkflowComponent("frontend/components/workflow/GenerateButton.tsx", {
    onClick: () => undefined,
    loading: true,
    label: "开始生成",
    loadingLabel: "忙碌中...",
  });

  assert.match(html, /忙碌中\.\.\./);
  assert.match(html, /disabled/);
});

test("workflow GenerateButton stays disabled when explicitly disabled without loading", async () => {
  const html = await renderWorkflowComponent("frontend/components/workflow/GenerateButton.tsx", {
    onClick: () => undefined,
    loading: false,
    disabled: true,
    label: "禁止点击",
  });

  assert.match(html, /禁止点击/);
  assert.match(html, /disabled/);
});

test("workflow StepLayout renders child content inside the main content container", async () => {
  const html = await renderWorkflowComponent("frontend/components/workflow/StepLayout.tsx", {
    currentStep: 1,
    steps: [{ label: "第一步" }, { label: "第二步" }],
    children: createElement("div", { id: "child-marker" }, "Child Body"),
  });

  assert.match(html, /Step 1/);
  assert.match(html, /第一步/);
  assert.match(html, /<div><div id="child-marker">Child Body<\/div><\/div>/);
});

test("workflow WorkflowStepHeader renders with only a title", async () => {
  const html = await renderWorkflowComponent("frontend/components/workflow/WorkflowStepHeader.tsx", {
    step: 3,
    title: "只传标题",
  });

  assert.match(html, /Step 3/);
  assert.match(html, /只传标题/);
  assert.equal(html.includes("<p"), false);
});
