---
name: gsd-settings-integrations
description: "Configure third-party API keys, code-review CLI routing, and agent-skill injection"
---

<augment_skill_adapter>
## A. Skill Invocation
- This skill is invoked when the user mentions `gsd-settings-integrations` or describes a task matching this skill.
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
Interactive configuration of GSD's third-party integration surface:
- Search API keys: `brave_search`, `firecrawl`, `exa_search`, and
  the `search_gitignored` toggle
- Code-review CLI routing: `review.models.{claude,codex,gemini,opencode}`
- Agent-skill injection: `agent_skills.<agent-type>`

API keys are stored plaintext in `.planning/config.json` but are masked
(`****<last-4>`) in every piece of interactive output. The workflow never
echoes plaintext to stdout, stderr, or any log.

This command is deliberately distinct from `/gsd-settings` (workflow toggles)
and any `/gsd-settings-advanced` tuning surface. It handles *connectivity*,
not pipeline shape.
</objective>

<execution_context>
@/Volumes/AIWork/projects/ai-image-workbench/.augment/get-shit-done/workflows/settings-integrations.md
</execution_context>

<process>
**Follow the settings-integrations workflow** from
`@/Volumes/AIWork/projects/ai-image-workbench/.augment/get-shit-done/workflows/settings-integrations.md`.

The workflow handles:
1. Resolving `$GSD_CONFIG_PATH` (flat vs workstream)
2. Reading current integration values (masked for display)
3. Section 1 — Search Integrations: Brave / Firecrawl / Exa / search_gitignored
4. Section 2 — Review CLI Routing: review.models.{claude,codex,gemini,opencode}
5. Section 3 — Agent Skills Injection: agent_skills.<agent-type>
6. Writing values via `gsd-sdk query config-set` (which merges, preserving
   unrelated keys)
7. Masked confirmation display
</process>
