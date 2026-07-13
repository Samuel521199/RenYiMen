---
name: gsd-sketch-wrap-up
description: Package sketch design findings into a persistent project skill for future build conversations
---

<objective>
Curate sketch design findings and package them into a persistent project skill that Claude
auto-loads when building the real UI. Also writes a summary to `.planning/sketches/` for
project history. Output skill goes to `./.codebuddy/skills/sketch-findings-[project]/` (project-local).
</objective>

<execution_context>
@/Volumes/AIWork/projects/ai-image-workbench/.codebuddy/get-shit-done/workflows/sketch-wrap-up.md
@/Volumes/AIWork/projects/ai-image-workbench/.codebuddy/get-shit-done/references/ui-brand.md
</execution_context>

<runtime_note>
**Copilot (VS Code):** Use `vscode_askquestions` wherever this workflow calls `AskUserQuestion`.
</runtime_note>

<process>
Execute the sketch-wrap-up workflow from @/Volumes/AIWork/projects/ai-image-workbench/.codebuddy/get-shit-done/workflows/sketch-wrap-up.md end-to-end.
Preserve all curation gates (per-sketch review, grouping approval, CODEBUDDY.md routing line).
</process>
