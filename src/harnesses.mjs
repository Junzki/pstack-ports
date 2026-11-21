import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

function configHome(home, env) {
  return env.XDG_CONFIG_HOME || join(home, ".config");
}

function codexHome(home, env) {
  return env.CODEX_HOME || join(home, ".codex");
}

function claudeHome(home, env) {
  return env.CLAUDE_CONFIG_DIR || join(home, ".claude");
}

/**
 * Complete registry of supported AI coding agent harnesses.
 *
 * Each entry defines:
 * - id: canonical CLI identifier
 * - name: human-readable display name
 * - aliases: accepted CLI aliases
 * - localSkillsDir: project-relative skills directory
 * - globalSkillsDir(home, env): global user-level skills directory
 * - localAgentsDir: optional project-relative custom subagents directory
 * - globalAgentsDir(home, env): optional global custom subagents directory
 * - agentFormat: optional format identifier ("cursor" | "claude-code" | "opencode" | "copilot")
 * - detect(cwd, home, env): returns true when the harness appears installed/configured
 */
export const HARNESSES = [
  {
    id: "universal",
    name: "Universal (.agents)",
    aliases: ["agents", "standard"],
    localSkillsDir: ".agents/skills",
    globalSkillsDir: (home) => join(home, ".agents", "skills"),
    detect: (cwd, home) =>
      existsSync(join(cwd, ".agents")) || existsSync(join(home, ".agents")),
  },
  {
    id: "cursor",
    name: "Cursor",
    aliases: [],
    localSkillsDir: ".cursor/skills",
    globalSkillsDir: (home) => join(home, ".cursor", "skills"),
    localAgentsDir: ".cursor/agents",
    globalAgentsDir: (home) => join(home, ".cursor", "agents"),
    agentFormat: "cursor",
    detect: (cwd, home) =>
      existsSync(join(cwd, ".cursor")) || existsSync(join(home, ".cursor")),
  },
  {
    id: "claude-code",
    name: "Claude Code",
    aliases: ["claude"],
    localSkillsDir: ".claude/skills",
    globalSkillsDir: (home, env) => join(claudeHome(home, env), "skills"),
    localAgentsDir: ".claude/agents",
    globalAgentsDir: (home, env) => join(claudeHome(home, env), "agents"),
    agentFormat: "claude-code",
    detect: (cwd, home, env) =>
      existsSync(join(cwd, ".claude")) || existsSync(claudeHome(home, env)),
  },
  {
    id: "codex",
    name: "OpenAI Codex",
    aliases: ["openai-codex"],
    localSkillsDir: ".agents/skills",
    globalSkillsDir: (home, env) => join(codexHome(home, env), "skills"),
    detect: (cwd, home, env) =>
      existsSync(join(cwd, ".codex")) || existsSync(codexHome(home, env)),
  },
  {
    id: "opencode",
    name: "OpenCode",
    aliases: ["open-code"],
    localSkillsDir: ".opencode/skills",
    globalSkillsDir: (home, env) => join(configHome(home, env), "opencode", "skills"),
    localAgentsDir: ".opencode/agents",
    globalAgentsDir: (home, env) => join(configHome(home, env), "opencode", "agents"),
    agentFormat: "opencode",
    detect: (cwd, home, env) =>
      existsSync(join(cwd, ".opencode")) ||
      existsSync(join(configHome(home, env), "opencode")),
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    aliases: ["gemini"],
    localSkillsDir: ".gemini/skills",
    globalSkillsDir: (home) => join(home, ".gemini", "skills"),
    detect: (cwd, home) =>
      existsSync(join(cwd, ".gemini")) || existsSync(join(home, ".gemini")),
  },
  {
    id: "antigravity",
    name: "Antigravity",
    aliases: ["agy"],
    localSkillsDir: ".agents/skills",
    globalSkillsDir: (home) => join(home, ".gemini", "config", "skills"),
    detect: (cwd, home) =>
      existsSync(join(home, ".gemini", "antigravity")) ||
      existsSync(join(home, ".gemini", "config")) ||
      existsSync(join(cwd, ".agent")),
  },
  {
    id: "github-copilot",
    name: "GitHub Copilot",
    aliases: ["copilot"],
    localSkillsDir: ".github/skills",
    globalSkillsDir: (home) => join(home, ".copilot", "skills"),
    localAgentsDir: ".github/agents",
    globalAgentsDir: (home) => join(home, ".copilot", "agents"),
    agentFormat: "copilot",
    detect: (cwd, home) =>
      existsSync(join(cwd, ".github", "copilot-instructions.md")) ||
      existsSync(join(cwd, ".github", "skills")) ||
      existsSync(join(home, ".copilot")),
  },
  {
    id: "windsurf",
    name: "Windsurf",
    aliases: ["codeium"],
    localSkillsDir: ".windsurf/skills",
    globalSkillsDir: (home) => join(home, ".codeium", "windsurf", "skills"),
    detect: (cwd, home) =>
      existsSync(join(cwd, ".windsurf")) ||
      existsSync(join(home, ".codeium", "windsurf")),
  },
  {
    id: "cline",
    name: "Cline",
    aliases: [],
    localSkillsDir: ".cline/skills",
    globalSkillsDir: (home) => join(home, ".cline", "skills"),
    detect: (cwd, home) =>
      existsSync(join(cwd, ".cline")) || existsSync(join(home, ".cline")),
  },
  {
    id: "roo",
    name: "Roo Code",
    aliases: ["roo-code", "roocode"],
    localSkillsDir: ".roo/skills",
    globalSkillsDir: (home) => join(home, ".roo", "skills"),
    detect: (cwd, home) =>
      existsSync(join(cwd, ".roo")) || existsSync(join(home, ".roo")),
  },
  {
    id: "amp",
    name: "Amp",
    aliases: [],
    localSkillsDir: ".agents/skills",
    globalSkillsDir: (home, env) => join(configHome(home, env), "agents", "skills"),
    detect: (_cwd, home, env) =>
      existsSync(join(configHome(home, env), "amp")) ||
      existsSync(join(configHome(home, env), "agents")),
  },
  {
    id: "goose",
    name: "Goose",
    aliases: [],
    localSkillsDir: ".goose/skills",
    globalSkillsDir: (home, env) => join(configHome(home, env), "goose", "skills"),
    detect: (cwd, home, env) =>
      existsSync(join(cwd, ".goose")) ||
      existsSync(join(configHome(home, env), "goose")),
  },
  {
    id: "kiro",
    name: "Kiro",
    aliases: ["kiro-cli"],
    localSkillsDir: ".kiro/skills",
    globalSkillsDir: (home) => join(home, ".kiro", "skills"),
    detect: (cwd, home) =>
      existsSync(join(cwd, ".kiro")) || existsSync(join(home, ".kiro")),
  },
  {
    id: "trae",
    name: "Trae",
    aliases: [],
    localSkillsDir: ".trae/skills",
    globalSkillsDir: (home) => join(home, ".trae", "skills"),
    detect: (cwd, home) =>
      existsSync(join(cwd, ".trae")) || existsSync(join(home, ".trae")),
  },
  {
    id: "droid",
    name: "Factory Droid",
    aliases: ["factory"],
    localSkillsDir: ".factory/skills",
    globalSkillsDir: (home) => join(home, ".factory", "skills"),
    detect: (cwd, home) =>
      existsSync(join(cwd, ".factory")) || existsSync(join(home, ".factory")),
  },
  {
    id: "kilo",
    name: "Kilo Code",
    aliases: ["kilocode", "kilo-code"],
    localSkillsDir: ".kilocode/skills",
    globalSkillsDir: (home) => join(home, ".kilocode", "skills"),
    detect: (cwd, home) =>
      existsSync(join(cwd, ".kilocode")) || existsSync(join(home, ".kilocode")),
  },
  {
    id: "continue",
    name: "Continue",
    aliases: [],
    localSkillsDir: ".continue/skills",
    globalSkillsDir: (home) => join(home, ".continue", "skills"),
    detect: (cwd, home) =>
      existsSync(join(cwd, ".continue")) || existsSync(join(home, ".continue")),
  },
  {
    id: "augment",
    name: "Augment",
    aliases: [],
    localSkillsDir: ".augment/skills",
    globalSkillsDir: (home) => join(home, ".augment", "skills"),
    detect: (cwd, home) =>
      existsSync(join(cwd, ".augment")) || existsSync(join(home, ".augment")),
  },
  {
    id: "junie",
    name: "Junie",
    aliases: [],
    localSkillsDir: ".junie/skills",
    globalSkillsDir: (home) => join(home, ".junie", "skills"),
    detect: (cwd, home) =>
      existsSync(join(cwd, ".junie")) || existsSync(join(home, ".junie")),
  },
  {
    id: "zencoder",
    name: "Zencoder",
    aliases: [],
    localSkillsDir: ".zencoder/skills",
    globalSkillsDir: (home) => join(home, ".zencoder", "skills"),
    detect: (cwd, home) =>
      existsSync(join(cwd, ".zencoder")) || existsSync(join(home, ".zencoder")),
  },
  {
    id: "qwen-code",
    name: "Qwen Code",
    aliases: ["qwen"],
    localSkillsDir: ".qwen/skills",
    globalSkillsDir: (home) => join(home, ".qwen", "skills"),
    detect: (cwd, home) =>
      existsSync(join(cwd, ".qwen")) || existsSync(join(home, ".qwen")),
  },
  {
    id: "pi",
    name: "Pi",
    aliases: [],
    localSkillsDir: ".pi/skills",
    globalSkillsDir: (home) => join(home, ".pi", "agent", "skills"),
    detect: (cwd, home) =>
      existsSync(join(cwd, ".pi")) || existsSync(join(home, ".pi", "agent")),
  },
];

const BY_NAME = new Map();
for (const harness of HARNESSES) {
  BY_NAME.set(harness.id, harness);
  for (const alias of harness.aliases) {
    BY_NAME.set(alias, harness);
  }
}

export function findHarness(input) {
  if (!input) return undefined;
  return BY_NAME.get(String(input).trim().toLowerCase());
}

export function detectInstalledHarnesses({ cwd = process.cwd(), home = homedir(), env = process.env } = {}) {
  return HARNESSES.filter((h) => h.detect(cwd, home, env));
}

export function resolveHarnesses(requested, { cwd = process.cwd(), home = homedir(), env = process.env } = {}) {
  const tokens = Array.isArray(requested)
    ? requested.flatMap((v) => String(v).split(","))
    : requested
      ? String(requested).split(",")
      : [];
  const cleaned = tokens.map((t) => t.trim().toLowerCase()).filter(Boolean);

  if (cleaned.length === 0 || cleaned.includes("detected")) {
    const detected = detectInstalledHarnesses({ cwd, home, env });
    if (detected.length > 0) return detected;
    return [findHarness("universal")];
  }

  if (cleaned.includes("all") || cleaned.includes("*")) {
    return [...HARNESSES];
  }

  const resolved = [];
  const seen = new Set();
  const unknown = [];
  for (const token of cleaned) {
    const h = findHarness(token);
    if (!h) {
      unknown.push(token);
      continue;
    }
    if (!seen.has(h.id)) {
      seen.add(h.id);
      resolved.push(h);
    }
  }
  if (unknown.length > 0) {
    const valid = HARNESSES.map((h) => h.id).join(", ");
    throw new Error(`Unknown harness(es): ${unknown.join(", ")}. Supported: all, detected, ${valid}`);
  }
  return resolved;
}

export function getHarnessPaths(harness, { global = false, cwd = process.cwd(), home = homedir(), env = process.env } = {}) {
  const skillsDir = global
    ? resolve(harness.globalSkillsDir(home, env))
    : resolve(cwd, harness.localSkillsDir);
  let agentsDir = null;
  if (global && harness.globalAgentsDir) {
    agentsDir = resolve(harness.globalAgentsDir(home, env));
  } else if (!global && harness.localAgentsDir) {
    agentsDir = resolve(cwd, harness.localAgentsDir);
  }
  return { skillsDir, agentsDir };
}
