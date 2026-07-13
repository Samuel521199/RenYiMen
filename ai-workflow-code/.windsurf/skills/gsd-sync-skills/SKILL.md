---
name: gsd-sync-skills
description: "Sync managed GSD skills across runtime roots so multi-runtime users stay aligned after an update"
---

<windsurf_skill_adapter>
## A. Skill Invocation
- This skill is invoked when the user mentions `gsd-sync-skills` or describes a task matching this skill.
- Treat all user text after the skill mention as `{{GSD_ARGS}}`.
- If no arguments are present, treat `{{GSD_ARGS}}` as empty.

## B. User Prompting
When the workflow needs user input, prompt the user conversationally:
- Present options as a numbered list in your response text
- Ask the user to reply with their choice
- For multi-select, ask for comma-separated numbers

## C. Tool Usage
Use these Windsurf tools when executing GSD workflows:
- `Shell` for running commands (terminal operations)
- `StrReplace` for editing existing files
- `Read`, `Write`, `Glob`, `Grep`, `Task`, `WebSearch`, `WebFetch`, `TodoWrite` as needed

## D. Subagent Spawning
When the workflow needs to spawn a subagent:
- Use `Task(subagent_type="generalPurpose", ...)`
- The `model` parameter maps to Windsurf's model options (e.g., "fast")
</windsurf_skill_adapter>

<objective>
Sync managed `gsd-*` skill directories from one canonical runtime's skills root to one or more destination runtime skills roots.

Routes to the sync-skills workflow which handles:
- Argument parsing (--from, --to, --dry-run, --apply)
- Runtime skills root resolution via install.js --skills-root
- Diff computation (CREATE / UPDATE / REMOVE per destination)
- Dry-run reporting (default — no writes)
- Apply execution (copy and remove with idempotency)
- Non-GSD skill preservation (only gsd-* dirs are touched)
</objective>
