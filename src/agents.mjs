import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

function parseFrontmatter(raw) {
  const normalized = raw.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { fields: {}, body: normalized };
  const fields = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key) fields[key] = val;
  }
  return { fields, body: match[2] };
}

function serializeFrontmatter(fields, body) {
  const lines = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n${body}`;
}

export function discoverAgents(packageRoot) {
  const agentsRoot = join(packageRoot, "agents");
  if (!existsSync(agentsRoot)) return [];
  return readdirSync(agentsRoot)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((fileName) => {
      const id = fileName.slice(0, -3);
      const sourcePath = join(agentsRoot, fileName);
      const raw = readFileSync(sourcePath, "utf8");
      const { fields, body } = parseFrontmatter(raw);
      return { id, fileName, sourcePath, raw, fields, body };
    });
}

/**
 * Renders agent files adapted to a specific harness format so frontmatter never
 * passes invalid Cursor-only slugs (like `claude-opus-5-5-xhigh-fast`) to
 * Claude Code, OpenCode, or GitHub Copilot.
 */
export function renderAgentForHarness(agent, format) {
  const { fields, body } = agent;
  switch (format) {
    case "cursor":
      return {
        fileName: agent.fileName,
        content: agent.raw.replace(/\r\n/g, "\n"),
      };

    case "claude-code": {
      const next = {
        name: fields.name || agent.id,
        description: fields.description || "",
      };
      // Claude Code accepts short model names (`opus`, `sonnet`, `haiku`, `inherit`)
      // and rejects Cursor slugs like `claude-opus-5-5-xhigh-fast`.
      if (fields.model && /^claude-(opus|sonnet|haiku)\b/i.test(fields.model)) {
        next.model = fields.model.match(/^claude-(opus|sonnet|haiku)/i)[1].toLowerCase();
      }
      return {
        fileName: agent.fileName,
        content: serializeFrontmatter(next, body),
      };
    }

    case "opencode": {
      const next = {
        description: fields.description || "",
        mode: "subagent",
      };
      return {
        fileName: agent.fileName,
        content: serializeFrontmatter(next, body),
      };
    }

    case "copilot": {
      const next = {
        name: fields.name || agent.id,
        description: fields.description || "",
      };
      return {
        fileName: `${agent.id}.agent.md`,
        content: serializeFrontmatter(next, body),
      };
    }

    default:
      return {
        fileName: agent.fileName,
        content: agent.raw.replace(/\r\n/g, "\n"),
      };
  }
}
