# pstack Harness Adapter

pstack skills were originally authored using Cursor tool, subagent, model, and path names. Outside Cursor, read this file once per session, then map each Cursor name in a skill using your harness's section below (falling back to the Universal table when a harness has no override). `<skills-root>` means the directory that holds `poteto-mode/`, `setup-pstack/`, and the sibling skill folders. If a Cursor field has no equivalent in your harness, drop it and say so. Never pass a field or value your tool schema rejects.

## Universal Mapping (Any Agent Skills Harness)

Use this table on Windsurf, Cline, Roo Code, Amp, Goose, Kiro, Trae, Droid, Kilo Code, Continue, Augment, Junie, Zencoder, Qwen Code, Pi, or any other harness without a dedicated override below.

### Tools

| Cursor | Universal equivalent |
| --- | --- |
| `Task` | Use your harness's native subagent tool. If your harness has no subagent tool, execute the delegated task directly in an isolated git worktree or temp directory and note single-agent execution. |
| `AskQuestion` | Use your harness's interactive question tool if available; otherwise ask in plain text. |
| Open a todolist, or copy steps into the todolist tool | Use your harness's todo/plan/task-list tool if available; otherwise keep a checklist in your reply and update it at each phase. |
| Run another pstack skill (`/name` or "the **name** skill") | Read `<skills-root>/<name>/SKILL.md` directly and follow it. Do not fail if slash-command routing is unavailable. |
| `Grep`, `Glob` | Use your harness's native search/glob tools, or shell `rg` / `find`. |

### Subagent fields

| Cursor | Universal equivalent |
| --- | --- |
| `subagent_type: generalPurpose` | Default / general-purpose subagent with read, write, and shell access. |
| `poteto-agent` | If your harness has a registered `poteto-agent` subagent, use it. Otherwise spawn a general-purpose subagent (or follow inline) with instructions from `<skills-root>/poteto-mode/references/agents/poteto-agent.md` and pass the absolute path to `<skills-root>/poteto-mode/SKILL.md`. |
| `comment-sicko` | If your harness has a registered `comment-sicko` subagent, use it. Otherwise spawn a subagent (or follow inline) using `<skills-root>/poteto-mode/references/agents/comment-sicko.md`. |
| `readonly: true` | Use a read-only / research subagent if available; otherwise instruct the subagent "do not edit files" and verify with `git status` afterward. |
| `readonly: false` | Standard read/write subagent. |
| `environment: "cloud"` | Use an isolated git worktree (`git worktree add`) or your harness's isolated workspace mode. Name the branch or commit to check out. |
| `environment: "local"` | Omit; run in the current workspace. |
| `cloud_base_branch: <b>` | Tell the worker to base its worktree on `<b>` first. |
| `run_in_background: true` | Run asynchronously / in parallel if your harness supports it; otherwise omit and run sequentially. |
| `resume` | If your harness supports messaging an existing subagent, use it; otherwise spawn a fresh subagent and paste the earlier result and branch into its brief. |
| `file_attachments` | List the file paths in the brief and instruct the subagent to read them. |

### Models

| Cursor | Universal equivalent |
| --- | --- |
| `claude-*`, `grok-*`, `gpt-*`, `gemini-*` | Map to the closest valid model identifier supported by your harness. If your harness does not support per-subagent model overrides or cross-vendor slugs, omit `model` so the subagent runs on the session model, and state that once. |
| `auto` or `inherit-parent` | Omit `model` so the subagent inherits the session model. |
| `pstack-models.mdc` / `~/.cursor/rules/pstack-models.mdc` | Read/write your harness's global rules or model config file (see Harness-Specific Overrides below; default fallback: `~/.agents/pstack-models.md`). If absent, use the skill defaults mapped to your harness's models. |

### Paths

| Cursor | Universal equivalent |
| --- | --- |
| `.cursor/skills/`, `~/.cursor/skills/` | Your harness's project and global skills directory (or `.agents/skills/`, `~/.agents/skills/`). |
| `~/.cursor/plugins/`, `.cursor-plugin/plugin.json` | `<skills-root>` (the installed pstack skills directory). |
| `.cursor/rules/*.mdc`, always-applied rules | `AGENTS.md` (or your harness's native rules file such as `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `.windsurfrules`). |
| `agent-transcripts`, `~/.cursor/projects/<slug>/agent-transcripts/` | Your harness's local session/transcript directory if accessible; otherwise skip transcript mining with a one-line note. |

### Cursor-only features

Outside Cursor, there are no Cursor Automations, Bugbot triggers, Cursor cloud agents, or built-in PR tool. When a step needs one, write one line in your reply: `Skipped outside Cursor: <step>. <reason>.` and continue to the next step. Do not stop, ask, or retry.

| Cursor-only features | Universal equivalent |
| --- | --- |
| Cursor Automations (routines, `update_state`, `api2.cursor.sh/automations` webhooks, `SendToUser`) | Skip with the one-line note. |
| Bugbot | Treat existing Bugbot PR comments as normal GitHub review threads via `gh`. Skip steps that start, wait for, or configure Bugbot when no Bugbot check exists. |
| Cursor cloud agents | Map `environment: "cloud"` to a git worktree / isolated workspace. Skip dashboard-only cloud agent steps. |
| Built-in PR tool | Use `gh pr create` / `gh pr view` / `gh pr merge` as given by the step. Not a skip. |

---

## Harness-Specific Overrides

### Claude Code

| Cursor | Claude Code |
| --- | --- |
| `Task` | `Agent` |
| `AskQuestion` | `AskUserQuestion` (in `-p` mode, ask in plain text). |
| todolist | `TodoWrite` if offered, else reply checklist. |
| Run another pstack skill | `Read` `<skills-root>/<name>/SKILL.md` and follow it. When telling the user to invoke a skill as a plugin, write `/pstack:<name>`; when installed as user/project skills in `.claude/skills/`, write `/<name>`. |
| `generalPurpose` | `subagent_type: "general-purpose"` |
| `poteto-agent`, `comment-sicko` | `poteto-agent` / `comment-sicko` (from `.claude/agents/` or `~/.claude/agents/`), or `pstack:poteto-agent` / `pstack:comment-sicko` if installed as a Claude plugin. Always pass mapped `model` and `effort` explicitly on `Agent` calls. |
| `readonly: true` | `subagent_type: "Explore"` plus "do not edit files" in the brief; verify with `git status`. |
| `environment: "cloud"` | `isolation: "worktree"`. |
| `run_in_background: true` | Omit (subagents run in background / parallel by default). |
| `claude-<family>-<version>-<effort>[-fast]` | `model: "<family>"` (`opus`, `sonnet`, `haiku`, `fable`) and `effort: "<effort>"`. Drop `-fast`. |
| Non-Claude slugs (`gemini-*`, `grok-*`, `gpt-*`) | Omit `model` (runs on session model) and say so. |
| `pstack-models.mdc` | `~/.claude/rules/pstack-models.md` (plain markdown, no frontmatter; Claude Code auto-loads `~/.claude/rules/*.md`). Never put role lines in `CLAUDE.md`. |
| `.cursor/skills/`, `~/.cursor/skills/` | `.claude/skills/`, `~/.claude/skills/` |
| `.cursor/rules/*.mdc` | `CLAUDE.md` (or `AGENTS.md`), except `pstack-models.md` in `~/.claude/rules/`. |
| `agent-transcripts` | `~/.claude/projects/<slug>/<session>.jsonl` (workspace path with `/` and `.` replaced by `-`; subagents in `<session>/subagents/`). |

For the full `setup-pstack` procedure in Claude Code, write `<model> <effort>` values (e.g. `opus xhigh`, `fable high`, `inherit-parent`) to `~/.claude/rules/pstack-models.md`.

### OpenAI Codex

| Cursor | Codex |
| --- | --- |
| `Task` | `spawn_agent` / multi-agent tools if enabled; otherwise isolated git worktrees executed sequentially. |
| todolist | `update_plan` tool if available, else reply checklist. |
| `poteto-agent`, `comment-sicko` | Pass `<skills-root>/poteto-mode/references/agents/<name>.md` as the agent instructions. |
| `.cursor/skills/`, `~/.cursor/skills/` | `.agents/skills/`, `~/.codex/skills/` (or `$CODEX_HOME/skills/`). |
| `pstack-models.mdc` | `~/.codex/pstack-models.md` (referenced from `~/.codex/AGENTS.md` if desired). |
| `.cursor/rules/*.mdc` | `AGENTS.md` / `~/.codex/AGENTS.md`. |
| `agent-transcripts` | `~/.codex/sessions/` (or `$CODEX_HOME/sessions/`). |

### OpenCode

| Cursor | OpenCode |
| --- | --- |
| `Task` | `task` tool. |
| `AskQuestion` | `question` tool if available, else plain text. |
| todolist | `todowrite` tool. |
| `generalPurpose` | Default `general` subagent. |
| `poteto-agent`, `comment-sicko` | Registered agents in `.opencode/agents/` or `~/.config/opencode/agents/` (`@poteto-agent`, `@comment-sicko`). |
| `readonly: true` | `explore` subagent (or general with "do not edit files"). |
| `.cursor/skills/`, `~/.cursor/skills/` | `.opencode/skills/` or `.agents/skills/`, and `~/.config/opencode/skills/`. |
| `pstack-models.mdc` | `~/.config/opencode/pstack-models.md`. |
| `.cursor/rules/*.mdc` | `AGENTS.md`. |

### Gemini CLI

| Cursor | Gemini CLI |
| --- | --- |
| `Task` | Native subagent/delegate tool if enabled; otherwise isolated git worktrees sequentially. |
| todolist | `write_todos` if available, else reply checklist. |
| `poteto-agent`, `comment-sicko` | Read `<skills-root>/poteto-mode/references/agents/<name>.md` and include its instructions in the subagent brief or follow inline. |
| `.cursor/skills/`, `~/.cursor/skills/` | `.gemini/skills/` or `.agents/skills/`, and `~/.gemini/skills/`. |
| `pstack-models.mdc` | `~/.gemini/pstack-models.md`. |
| `.cursor/rules/*.mdc` | `GEMINI.md` / `~/.gemini/GEMINI.md`. |

### Antigravity

| Cursor | Antigravity |
| --- | --- |
| `Task` | `invoke_subagent` (with `TypeName: "self"`, `"research"`, or custom defined via `define_subagent`), or `swarm` (`action: "add"`) for coordinated parallel workers. |
| `AskQuestion` | `ask_question` for multiple-choice clarifications; plain text for simple yes/no. |
| `generalPurpose` | `invoke_subagent` with `TypeName: "self"`. |
| `poteto-agent`, `comment-sicko` | Define via `define_subagent` (using `<skills-root>/poteto-mode/references/agents/<name>.md` as `SystemPrompt`) or pass its instructions in `invoke_subagent`. |
| `readonly: true` | `invoke_subagent` with `TypeName: "research"`. |
| `environment: "cloud"` | `Workspace: "share"` or `"branch"` on `invoke_subagent` / `swarm`. |
| `run_in_background: true` | Default behavior of `invoke_subagent` (do not poll; wait for automatic wakeup). |
| `resume` | `send_message` to the existing subagent `conversationId`. |
| `.cursor/skills/`, `~/.cursor/skills/` | `.agents/skills/` (project) and `~/.gemini/config/skills/` (global). |
| `pstack-models.mdc` | `~/.gemini/config/pstack-models.md` (or `.agents/rules/pstack-models.md`). |
| `.cursor/rules/*.mdc` | `GEMINI.md`, `AGENTS.md`, or `.agents/rules/*.md`. |
| `agent-transcripts` | `<appDataDir>/brain/<conversation-id>/.system_generated/logs/transcript.jsonl`. |

### GitHub Copilot

| Cursor | GitHub Copilot |
| --- | --- |
| `Task` | `runSubagent` (or parallel subagent tool when available). |
| `poteto-agent`, `comment-sicko` | Custom agents in `.github/agents/poteto-agent.agent.md` and `.github/agents/comment-sicko.agent.md` (or `~/.copilot/agents/`), else fallback to `<skills-root>/poteto-mode/references/agents/`. |
| `.cursor/skills/`, `~/.cursor/skills/` | `.github/skills/` or `.agents/skills/`, and `~/.copilot/skills/`. |
| `pstack-models.mdc` | `~/.copilot/pstack-models.md`. |
| `.cursor/rules/*.mdc` | `.github/copilot-instructions.md` or `AGENTS.md`. |
