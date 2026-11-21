import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { discoverAgents } from "../src/agents.mjs";
import { HARNESSES, resolveHarnesses } from "../src/harnesses.mjs";
import {
  discoverSkills,
  getInstallStatus,
  installPstack,
  selectSkills,
  uninstallPstack,
} from "../src/installer.mjs";
import { syncUpstream } from "../scripts/sync-upstream.mjs";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI_PATH = join(PACKAGE_ROOT, "bin", "cli.mjs");

function makeTempDir(prefix = "pstack-test-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("pstack catalog & harness resolution", () => {
  it("discovers all 58 skills and 2 agents", () => {
    const skills = discoverSkills(PACKAGE_ROOT);
    const commands = skills.filter((s) => s.kind === "command");
    const principles = skills.filter((s) => s.kind === "principle");
    const agents = discoverAgents(PACKAGE_ROOT);

    assert.equal(skills.length, 58);
    assert.equal(commands.length, 34);
    assert.equal(principles.length, 24);
    assert.equal(agents.length, 2);
  });

  it("resolves harness aliases and presets", () => {
    const resolved = resolveHarnesses(["claude,agy", "copilot", "gemini"]);
    assert.deepEqual(
      resolved.map((h) => h.id),
      ["claude-code", "antigravity", "github-copilot", "gemini-cli"],
    );

    const all = resolveHarnesses(["all"]);
    assert.equal(all.length, HARNESSES.length);

    assert.throws(() => resolveHarnesses(["nonexistent-harness"]), /Unknown harness/);
  });

  it("selects skill presets cleanly", () => {
    const all = discoverSkills(PACKAGE_ROOT);
    assert.equal(selectSkills(all, "core").length, 27);
    assert.equal(selectSkills(all, "commands").length, 34);
    assert.equal(selectSkills(all, "principles").length, 24);
    assert.deepEqual(
      selectSkills(all, "poteto-mode,tdd").map((s) => s.name),
      ["poteto-mode", "tdd"],
    );
  });
});

describe("pstack installer & uninstaller", () => {
  it("installs to all harnesses locally, adapts agents per harness, and uninstalls without touching user skills", () => {
    const cwd = makeTempDir("pstack-local-");
    const home = makeTempDir("pstack-home-");
    try {
      // Seed a user-owned skill and agent to verify uninstall never deletes them
      mkdirSync(join(cwd, ".claude", "skills", "my-custom-skill"), { recursive: true });
      writeFileSync(join(cwd, ".claude", "skills", "my-custom-skill", "SKILL.md"), "# Mine\n", "utf8");
      mkdirSync(join(cwd, ".claude", "agents"), { recursive: true });
      writeFileSync(join(cwd, ".claude", "agents", "my-agent.md"), "# My Agent\n", "utf8");

      const res = installPstack({
        packageRoot: PACKAGE_ROOT,
        harnesses: ["all"],
        global: false,
        cwd,
        home,
        env: {},
      });

      assert.equal(res.harnesses.length, HARNESSES.length);
      assert.equal(res.skills.length, 58);

      // Verify skills readable across major harnesses
      for (const rel of [
        ".agents/skills/poteto-mode/SKILL.md",
        ".agents/skills/poteto-mode/LICENSE",
        ".agents/skills/poteto-mode/NOTICE",
        ".agents/skills/poteto-mode/references/harness-adapter.md",
        ".cursor/skills/poteto-mode/SKILL.md",
        ".claude/skills/poteto-mode/SKILL.md",
        ".claude/skills/poteto-mode/LICENSE",
        ".claude/skills/poteto-mode/NOTICE",
        ".opencode/skills/poteto-mode/SKILL.md",
        ".gemini/skills/poteto-mode/SKILL.md",
        ".github/skills/poteto-mode/SKILL.md",
        ".windsurf/skills/poteto-mode/SKILL.md",
        ".cline/skills/poteto-mode/SKILL.md",
        ".roo/skills/poteto-mode/SKILL.md",
      ]) {
        assert.equal(existsSync(join(cwd, rel)), true, `Expected ${rel} to exist`);
      }

      // Verify harness-specific agent frontmatter adaptation
      const cursorAgent = readFileSync(join(cwd, ".cursor", "agents", "poteto-agent.md"), "utf8");
      assert.match(cursorAgent, /model: claude-opus-5-5-xhigh-fast/);
      assert.match(cursorAgent, /is_background: true/);

      const claudeAgent = readFileSync(join(cwd, ".claude", "agents", "poteto-agent.md"), "utf8");
      assert.match(claudeAgent, /model: opus/);
      assert.doesNotMatch(claudeAgent, /claude-opus-5-5/);
      assert.doesNotMatch(claudeAgent, /is_background/);

      const opencodeAgent = readFileSync(join(cwd, ".opencode", "agents", "poteto-agent.md"), "utf8");
      assert.match(opencodeAgent, /mode: subagent/);

      assert.equal(existsSync(join(cwd, ".github", "agents", "poteto-agent.agent.md")), true);
      assert.equal(existsSync(join(cwd, ".github", "agents", "comment-sicko.agent.md")), true);

      // Status reports installed across harnesses
      const statusBefore = getInstallStatus({ packageRoot: PACKAGE_ROOT, cwd, home, env: {} });
      const claudeStatus = statusBefore.harnesses.find((h) => h.id === "claude-code");
      assert.equal(claudeStatus.local.installed, 58);

      // Uninstall removes pstack cleanly while preserving user's own skill and agent
      uninstallPstack({
        packageRoot: PACKAGE_ROOT,
        harnesses: ["all"],
        global: false,
        cwd,
        home,
        env: {},
      });

      assert.equal(existsSync(join(cwd, ".claude", "skills", "poteto-mode")), false);
      assert.equal(existsSync(join(cwd, ".claude", "agents", "poteto-agent.md")), false);
      assert.equal(existsSync(join(cwd, ".claude", "skills", "my-custom-skill", "SKILL.md")), true);
      assert.equal(existsSync(join(cwd, ".claude", "agents", "my-agent.md")), true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("installs globally into each harness home directory with --copy mode", () => {
    const cwd = makeTempDir("pstack-cwd-");
    const home = makeTempDir("pstack-global-");
    try {
      const res = installPstack({
        packageRoot: PACKAGE_ROOT,
        harnesses: ["cursor", "claude-code", "codex", "opencode", "gemini-cli", "antigravity", "github-copilot"],
        skills: "core",
        global: true,
        mode: "copy",
        cwd,
        home,
        env: {},
      });

      assert.equal(res.scope, "global");
      assert.equal(res.skills.length, 27);
      assert.ok(res.skillTargets.every((t) => t.mode === "copy"));

      for (const p of [
        join(home, ".cursor", "skills", "poteto-mode", "SKILL.md"),
        join(home, ".claude", "skills", "poteto-mode", "SKILL.md"),
        join(home, ".codex", "skills", "poteto-mode", "SKILL.md"),
        join(home, ".config", "opencode", "skills", "poteto-mode", "SKILL.md"),
        join(home, ".gemini", "skills", "poteto-mode", "SKILL.md"),
        join(home, ".gemini", "config", "skills", "poteto-mode", "SKILL.md"),
        join(home, ".copilot", "skills", "poteto-mode", "SKILL.md"),
      ]) {
        assert.equal(existsSync(p), true, `Expected global file ${p}`);
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("respects --dry-run without creating files", () => {
    const cwd = makeTempDir("pstack-dry-");
    const home = makeTempDir("pstack-dry-home-");
    try {
      const res = installPstack({
        packageRoot: PACKAGE_ROOT,
        harnesses: ["cursor", "claude-code"],
        global: false,
        cwd,
        home,
        env: {},
        dryRun: true,
      });

      assert.equal(res.dryRun, true);
      assert.equal(existsSync(join(cwd, ".cursor")), false);
      assert.equal(existsSync(join(cwd, ".claude")), false);
      assert.equal(existsSync(join(cwd, ".agents")), false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("pstack CLI executable", () => {
  it("runs --version, doctor, list, install, status, and uninstall via bin/cli.mjs", () => {
    const cwd = makeTempDir("pstack-cli-");
    try {
      const ver = execFileSync(process.execPath, [CLI_PATH, "--version"], { encoding: "utf8" }).trim();
      assert.match(ver, /^\d+\.\d+\.\d+$/);

      const doctorOut = execFileSync(process.execPath, [CLI_PATH, "doctor"], { encoding: "utf8" });
      assert.match(doctorOut, /OK — 0 problems/);

      const listJson = JSON.parse(
        execFileSync(process.execPath, [CLI_PATH, "list", "--json"], { encoding: "utf8" }),
      );
      assert.equal(listJson.commands.length, 34);
      assert.equal(listJson.principles.length, 24);

      const installJson = JSON.parse(
        execFileSync(
          process.execPath,
          [CLI_PATH, "install", "-a", "claude-code,cursor", "--dir", cwd, "--json"],
          { encoding: "utf8" },
        ),
      );
      assert.equal(installJson.skills.length, 58);
      assert.equal(existsSync(join(cwd, ".claude", "skills", "poteto-mode", "SKILL.md")), true);
      assert.equal(existsSync(join(cwd, ".cursor", "skills", "poteto-mode", "SKILL.md")), true);

      const uninstallJson = JSON.parse(
        execFileSync(
          process.execPath,
          [CLI_PATH, "uninstall", "--all", "--dir", cwd, "--json"],
          { encoding: "utf8" },
        ),
      );
      assert.ok(uninstallJson.removedSkills.length >= 2);
      assert.equal(existsSync(join(cwd, ".claude", "skills", "poteto-mode")), false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("upstream sync", () => {
  it("syncs upstream updates, bumps versions, injects harness adapter on new Cursor skills, and no-ops when unchanged", () => {
    const fakeRepo = makeTempDir("pstack-sync-target-");
    const fakeUpstream = makeTempDir("pstack-sync-upstream-");
    try {
      // Seed target repo from current package
      cpSync(PACKAGE_ROOT, fakeRepo, {
        recursive: true,
        filter: (p) => !p.includes("node_modules") && !p.endsWith(".upstream-sync.json"),
      });

      // Seed synthetic upstream pstack/ with a version bump and a new skill that uses `Task`
      const upstreamPstack = join(fakeUpstream, "pstack");
      cpSync(PACKAGE_ROOT, upstreamPstack, {
        recursive: true,
        filter: (p) => {
          const rel = p.slice(PACKAGE_ROOT.length).replace(/\\/g, "/");
          return (
            rel === "" ||
            rel.startsWith("/skills") ||
            rel.startsWith("/agents") ||
            rel.startsWith("/docs") ||
            rel.startsWith("/automations") ||
            rel.startsWith("/assets") ||
            rel.startsWith("/.cursor-plugin") ||
            rel === "/plugin.json" ||
            rel === "/README.md" ||
            rel === "/LICENSE"
          );
        },
      });
      rmSync(join(upstreamPstack, "docs", "harness", "universal.md"), { force: true });
      rmSync(join(upstreamPstack, "skills", "poteto-mode", "references", "harness-adapter.md"), { force: true });

      const newVersion = "0.99.0";
      for (const rel of ["plugin.json", ".cursor-plugin/plugin.json"]) {
        const p = join(upstreamPstack, rel);
        const json = JSON.parse(readFileSync(p, "utf8"));
        json.version = newVersion;
        writeFileSync(p, `${JSON.stringify(json, null, 2)}\n`, "utf8");
      }

      mkdirSync(join(upstreamPstack, "skills", "demo-upstream-skill"), { recursive: true });
      writeFileSync(
        join(upstreamPstack, "skills", "demo-upstream-skill", "SKILL.md"),
        "---\nname: demo-upstream-skill\ndescription: Synthetic upstream skill\n---\n\n# Demo upstream skill\n\nSpawn a `Task` subagent to verify.\n",
        "utf8",
      );

      const first = syncUpstream({
        targetRoot: fakeRepo,
        source: fakeUpstream,
        verify: true,
      });
      assert.equal(first.changed, true);
      assert.equal(first.version, newVersion);

      // All 4 manifests bumped to newVersion
      for (const rel of ["package.json", "plugin.json", ".cursor-plugin/plugin.json", ".claude-plugin/plugin.json"]) {
        assert.equal(JSON.parse(readFileSync(join(fakeRepo, rel), "utf8")).version, newVersion);
      }

      // New Cursor-term skill automatically received harness adapter pointer
      const syncedSkill = readFileSync(join(fakeRepo, "skills", "demo-upstream-skill", "SKILL.md"), "utf8");
      assert.match(syncedSkill, /Outside Cursor, read \[the harness adapter\]\(\.\.\/poteto-mode\/references\/harness-adapter\.md\)/);

      // Standalone README header preserved
      const readme = readFileSync(join(fakeRepo, "README.md"), "utf8");
      assert.match(readme, /npx github:Junzki\/pstack-ports install --all -g/);

      // Second sync against identical upstream is a clean no-op
      const second = syncUpstream({
        targetRoot: fakeRepo,
        source: fakeUpstream,
        verify: true,
      });
      assert.equal(second.changed, false);
    } finally {
      rmSync(fakeRepo, { recursive: true, force: true });
      rmSync(fakeUpstream, { recursive: true, force: true });
    }
  });
});
