---
name: gsd-settings-advanced
description: "Power-user configuration — plan bounce, timeouts, branch templates, cross-AI execution, runtime knobs"
---

<augment_skill_adapter>
## A. Skill Invocation
- This skill is invoked when the user mentions `gsd-settings-advanced` or describes a task matching this skill.
- Treat all user text after the skill mention as `{{GSD_ARGS}}`.
- If no arguments are present, treat `{{GSD_ARGS}}` as empty.

## B. User Prompting
When the workflow needs user input, prompt the user conversationally:
- Present options as a numbered list in your response text
- Ask the user to reply with their choice
- For multi-select, ask for comma-separated numbers

## C. Tool Usage
Use these Augment tools when executing GSD workflows:
- `launch-process` for running commands (terminal operations)
- `str-replace-editor` for editing existing files
- `view` for reading files and listing directories
- `save-file` for creating new files
- `grep` for searching code (or use MCP servers for advanced search)
- `web-search`, `web-fetch` for web queries
- `add_tasks`, `view_tasklist`, `update_tasks` for task management

## D. Subagent Spawning
When the workflow needs to spawn a subagent:
- Use the built-in subagent spawning capability
- Define agent prompts in `.augment/agents/` directory
</augment_skill_adapter>

<objective>
Interactive configuration of GSD power-user knobs that don't belong in the common-case `/gsd-settings` prompt.

Routes to the settings-advanced workflow which handles:
- Config existence ensuring (workstream-aware path resolution)
- Current settings reading and parsing
- Sectioned prompts: Planning Tuning, Execution Tuning, Discussion Tuning, Cross-AI Execution, Git Customization, Runtime / Output
- Config merging that preserves every unrelated key
- Confirmation table display

Use `/gsd-settings` for the common-case toggles (model profile, research/plan_check/verifier, branching strategy, context warnings). Use `/gsd-settings-advanced` once those are set and you want to tune the internals.
</objective>

<execution_context>
@/Volumes/AIWork/projects/ai-image-workbench/.augment/get-shit-done/workflows/settings-advanced.md
</execution_context>

<process>
**Follow the settings-advanced workflow** from `@/Volumes/AIWork/projects/ai-image-workbench/.augment/get-shit-done/workflows/settings-advanced.md`.

The workflow handles all logic including:
1. Config file creation with defaults if missing (via `gsd-sdk query config-ensure-section`)
2. Current config reading
3. Six sectioned conversational prompting batches with current values pre-selected
4. Numeric-input validation (non-numeric rejected, empty input keeps current)
5. Answer parsing and config merging (preserves unrelated keys)
6. File writing (atomic)
7. Confirmation table display
</process>
