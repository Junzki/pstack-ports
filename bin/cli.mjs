#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { detectInstalledHarnesses, getHarnessPaths, HARNESSES } from "../src/harnesses.mjs";
import { discoverAgents } from "../src/agents.mjs";
import {
  discoverSkills,
  getInstallStatus,
  getPackageVersion,
  installPstack,
  uninstallPstack,
} from "../src/installer.mjs";
import { promptInstallOptions } from "../src/prompts.mjs";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function printHelp(version) {
  console.log(`pstack v${version} — rigorous multi-harness agent skills & workflows

Usage:
  npx github:Junzki/pstack-ports [command] [options]

Commands:
  install (add, i)        Install pstack skills and agents (default command)
  uninstall (remove, rm)  Remove pstack skills and agents (keeps your other skills)
  list (ls)               List all bundled skills and agents
  status                  Show installed pstack status across all harnesses
  harnesses               List all supported harnesses and their directories
  doctor (verify)         Validate bundled skills, links, and harness adapters

Options:
  -a, --harness <list>    Target harness(es), comma-separated or repeated (alias: --agent)
                          Accepts: all, detected, or harness IDs (cursor, claude-code,
                          codex, opencode, gemini-cli, antigravity, github-copilot,
                          windsurf, cline, roo, amp, goose, kiro, trae, universal, ...)
      --all               Target all ${HARNESSES.length} supported harnesses
  -g, --global            Install/uninstall in global user directories (e.g. ~/.claude/skills)
      --local             Install/uninstall in the current project directory (default)
      --dir <path>        Target project directory for local installs (alias: --cwd)
  -s, --skills <list>     Skill names or presets: all (default), core, commands, principles
      --copy              Copy skill files into each harness directory instead of symlinking
      --symlink           Symlink/junction from canonical .agents/skills to other harnesses
      --no-agents         Skip installing custom subagent files (poteto-agent, comment-sicko)
      --dry-run           Preview actions without modifying files
  -y, --yes               Skip interactive prompts
      --json              Output machine-readable JSON
  -v, --version           Print version
  -h, --help              Show this help message

Examples:
  npx github:Junzki/pstack-ports install --all -g
  npx github:Junzki/pstack-ports install -a cursor,claude-code,codex,opencode,antigravity -g
  npx github:Junzki/pstack-ports install --all --copy
  npx github:Junzki/pstack-ports install -a claude-code -s core
  npx github:Junzki/pstack-ports uninstall --all -g
  npx github:Junzki/pstack-ports status

Also compatible with Vercel's skills CLI:
  npx skills add Junzki/pstack-ports --all -g
`);
}

function parseArgs(argv) {
  const args = {
    command: null,
    harnesses: [],
    all: false,
    global: false,
    local: false,
    cwd: process.cwd(),
    skills: [],
    mode: "auto",
    includeAgents: true,
    dryRun: false,
    yes: false,
    json: false,
    help: false,
    version: false,
    explicitFlags: false,
  };

  const COMMANDS = new Set([
    "install",
    "add",
    "i",
    "uninstall",
    "remove",
    "rm",
    "list",
    "ls",
    "status",
    "harnesses",
    "doctor",
    "verify",
  ]);

  const requireValue = (flag, i) => {
    const val = argv[i + 1];
    if (!val || val.startsWith("-")) {
      throw new Error(`Missing value for ${flag}`);
    }
    return val;
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!args.command && !token.startsWith("-") && COMMANDS.has(token)) {
      args.command = token;
      continue;
    }
    if (token === "-h" || token === "--help") {
      args.help = true;
    } else if (token === "-v" || token === "--version") {
      args.version = true;
    } else if (token === "--all") {
      args.all = true;
      args.explicitFlags = true;
    } else if (token === "-g" || token === "--global") {
      args.global = true;
      args.explicitFlags = true;
    } else if (token === "--local") {
      args.local = true;
      args.explicitFlags = true;
    } else if (token === "-a" || token === "--harness" || token === "--agent") {
      args.harnesses.push(requireValue(token, i));
      i++;
      args.explicitFlags = true;
    } else if (token.startsWith("--harness=") || token.startsWith("--agent=")) {
      args.harnesses.push(token.slice(token.indexOf("=") + 1));
      args.explicitFlags = true;
    } else if (token === "--dir" || token === "--cwd") {
      args.cwd = resolve(requireValue(token, i));
      i++;
      args.explicitFlags = true;
    } else if (token.startsWith("--dir=") || token.startsWith("--cwd=")) {
      args.cwd = resolve(token.slice(token.indexOf("=") + 1));
      args.explicitFlags = true;
    } else if (token === "-s" || token === "--skills" || token === "--skill") {
      args.skills.push(requireValue(token, i));
      i++;
      args.explicitFlags = true;
    } else if (token.startsWith("--skills=") || token.startsWith("--skill=")) {
      args.skills.push(token.slice(token.indexOf("=") + 1));
      args.explicitFlags = true;
    } else if (token === "--copy") {
      args.mode = "copy";
      args.explicitFlags = true;
    } else if (token === "--symlink") {
      args.mode = "symlink";
      args.explicitFlags = true;
    } else if (token === "--no-agents") {
      args.includeAgents = false;
      args.explicitFlags = true;
    } else if (token === "--dry-run") {
      args.dryRun = true;
      args.explicitFlags = true;
    } else if (token === "-y" || token === "--yes") {
      args.yes = true;
      args.explicitFlags = true;
    } else if (token === "--json") {
      args.json = true;
    } else {
      throw new Error(`Unknown argument: ${token}. Run \`pstack --help\` for usage.`);
    }
  }

  if (args.all) {
    args.harnesses = ["all"];
  }

  return args;
}

async function runDoctor() {
  const { runVerification } = await import("../scripts/verify-export.mjs");
  const ok = runVerification(PACKAGE_ROOT);
  process.exitCode = ok ? 0 : 1;
}

async function main() {
  const version = getPackageVersion(PACKAGE_ROOT);
  const args = parseArgs(process.argv.slice(2));

  if (args.version) {
    console.log(version);
    return;
  }

  if (args.help) {
    printHelp(version);
    return;
  }

  const command = args.command || "install";
  const home = homedir();
  const env = process.env;

  if (command === "list" || command === "ls") {
    const skills = discoverSkills(PACKAGE_ROOT);
    const agents = discoverAgents(PACKAGE_ROOT);
    const commands = skills.filter((s) => s.kind === "command");
    const principles = skills.filter((s) => s.kind === "principle");

    if (args.json) {
      console.log(JSON.stringify({ version, commands, principles, agents: agents.map((a) => a.id) }, null, 2));
      return;
    }

    console.log(`pstack v${version} — ${skills.length} skills (${commands.length} commands, ${principles.length} principles), ${agents.length} agents\n`);
    console.log("Workflow & Command Skills:");
    for (const s of commands) {
      console.log(`  /${s.name.padEnd(36)} ${s.description.slice(0, 72)}`);
    }
    console.log("\nPrinciple Skills:");
    for (const s of principles) {
      console.log(`  /${s.name.padEnd(48)} ${s.description.slice(0, 60)}`);
    }
    console.log("\nAgents:");
    for (const a of agents) {
      console.log(`  ${a.id.padEnd(20)} ${a.fields.description?.slice(0, 80) || ""}`);
    }
    return;
  }

  if (command === "harnesses") {
    const detectedSet = new Set(detectInstalledHarnesses({ cwd: args.cwd, home, env }).map((h) => h.id));
    const rows = HARNESSES.map((h) => {
      const local = getHarnessPaths(h, { global: false, cwd: args.cwd, home, env });
      const global = getHarnessPaths(h, { global: true, cwd: args.cwd, home, env });
      return {
        id: h.id,
        name: h.name,
        aliases: h.aliases,
        detected: detectedSet.has(h.id),
        localSkillsDir: h.localSkillsDir,
        globalSkillsDir: global.skillsDir,
        agentsDir: h.localAgentsDir || null,
      };
    });

    if (args.json) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }

    console.log(`Supported harnesses (${rows.length}):\n`);
    console.log(`${"ID".padEnd(16)} ${"Detected".padEnd(10)} ${"Local Skills".padEnd(22)} Global Skills`);
    console.log("-".repeat(92));
    for (const r of rows) {
      const tag = r.detected ? "yes" : "-";
      console.log(`${r.id.padEnd(16)} ${tag.padEnd(10)} ${r.localSkillsDir.padEnd(22)} ${r.globalSkillsDir}`);
    }
    return;
  }

  if (command === "status") {
    const status = getInstallStatus({ packageRoot: PACKAGE_ROOT, cwd: args.cwd, home, env });
    if (args.json) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }

    const active = status.harnesses.filter((h) => h.local.installed > 0 || h.global.installed > 0);
    console.log(`pstack status (${status.totalBundled} bundled skills):\n`);
    if (active.length === 0) {
      console.log("Not installed in any harness yet. Run `npx pstack install --all -g` to install globally.");
      return;
    }
    console.log(`${"Harness".padEnd(16)} ${"Local".padEnd(20)} Global`);
    console.log("-".repeat(60));
    for (const h of active) {
      const fmt = (s) => (s.installed > 0 ? `${s.installed}/${status.totalBundled}${s.version ? ` (v${s.version})` : ""}` : "-");
      console.log(`${h.id.padEnd(16)} ${fmt(h.local).padEnd(20)} ${fmt(h.global)}`);
    }
    return;
  }

  if (command === "doctor" || command === "verify") {
    await runDoctor();
    return;
  }

  if (command === "uninstall" || command === "remove" || command === "rm") {
    const result = uninstallPstack({
      packageRoot: PACKAGE_ROOT,
      harnesses: args.harnesses.length > 0 ? args.harnesses : ["all"],
      global: args.global,
      cwd: args.cwd,
      home,
      env,
      dryRun: args.dryRun,
    });

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const prefix = result.dryRun ? "[dry-run] Would remove" : "Removed";
    if (result.removedSkills.length === 0 && result.removedAgents.length === 0) {
      console.log(`No pstack installation found (${result.scope}).`);
      return;
    }
    for (const entry of result.removedSkills) {
      console.log(`${prefix} ${entry.count} skills from ${entry.dir} (${entry.harnesses.join(", ")})`);
    }
    for (const entry of result.removedAgents) {
      console.log(`${prefix} ${entry.files.length} agents from ${entry.dir} (${entry.harnesses.join(", ")})`);
    }
    return;
  }

  if (command === "install" || command === "add" || command === "i") {
    let global = args.global;
    let harnesses = args.harnesses;
    let skills = args.skills.length > 0 ? args.skills : "all";

    const isInteractive = !args.yes && !args.explicitFlags && !args.json && process.stdin.isTTY && process.stdout.isTTY;
    if (isInteractive) {
      const picked = await promptInstallOptions({ cwd: args.cwd, home, env });
      global = picked.global;
      harnesses = picked.harnesses;
      skills = picked.skills;
    }

    const result = installPstack({
      packageRoot: PACKAGE_ROOT,
      harnesses,
      skills,
      global,
      cwd: args.cwd,
      home,
      env,
      mode: args.mode,
      includeAgents: args.includeAgents,
      dryRun: args.dryRun,
    });

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const verb = result.dryRun ? "[dry-run] Would install" : "Installed";
    console.log(`${verb} pstack v${result.version} (${result.skills.length} skills, ${result.scope}):\n`);
    for (const target of result.skillTargets) {
      console.log(`  skills  [${target.mode.padEnd(9)}] ${target.dir}`);
      console.log(`                     harnesses: ${target.harnesses.join(", ")}`);
    }
    if (result.agentTargets.length > 0) {
      console.log("");
      for (const target of result.agentTargets) {
        console.log(`  agents  [${target.format.padEnd(9)}] ${target.dir} (${target.files.join(", ")})`);
      }
    }
    console.log("\nNext steps:");
    console.log("  1. Run /setup-pstack in your harness to configure models and reasoning budget.");
    console.log("  2. Start any rigorous task with /poteto-mode <your goal>.");
    return;
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
