#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runVerification } from "./verify-export.mjs";

const DEFAULT_REPO = "https://github.com/cursor/plugins.git";
const DEFAULT_REF = "main";
const UPSTREAM_BLOB_BASE = "https://github.com/cursor/plugins/blob/main/pstack";
const SYNC_STATE_FILE = ".upstream-sync.json";
const LINK_RE = /\]\(([^)\s]+)\)/g;

const CURSOR_TERMS = [
  { key: "`Task`", re: /`Task`|\bTask (tool|subagent|call)/ },
  { key: "`AskQuestion`", re: /AskQuestion/ },
  { key: "todolist", re: /\btodo ?list\b/i },
  { key: "generalPurpose", re: /generalPurpose/ },
  { key: "poteto-agent", re: /poteto-agent/ },
  { key: "comment-sicko", re: /comment-sicko/ },
  { key: "`readonly: true`", re: /readonly: (true|false)|readonly\/Ask/ },
  { key: "`environment: \"cloud\"`", re: /environment: "(cloud|local)"/ },
  { key: "cloud_base_branch", re: /cloud_base_branch/ },
  { key: "`run_in_background: true`", re: /run_in_background/ },
  { key: "`resume`", re: /`resume`/ },
  { key: "`file_attachments`", re: /file_attachments/ },
  { key: "claude-", re: /\bclaude-[a-z]+-\d/ },
  { key: "grok-", re: /\bgrok-\d/ },
  { key: "gpt-", re: /\bgpt-\d/ },
  { key: "inherit-parent", re: /inherit-parent/ },
  { key: "pstack-models.mdc", re: /pstack-models\.mdc/ },
  { key: ".cursor/skills/", re: /\.cursor\/skills/ },
  { key: "~/.cursor/plugins/", re: /\.cursor\/plugins|\.cursor-plugin/ },
  { key: ".cursor/rules/", re: /\.cursor\/rules|always-applied rule/ },
  { key: "agent-transcripts", re: /agent-transcripts|\.cursor\/projects/ },
  { key: "Cursor-only features", re: /Bugbot|Cursor [Aa]utomation|cursor\.(sh|com)\/automations|[Cc]loud [Aa]gent|built-in PR tool/ },
];

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      if (name === ".DS_Store" || name === "node_modules" || name === ".git") return [];
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
}

function hashTree(dir) {
  const hash = createHash("sha256");
  for (const filePath of walk(dir)) {
    const rel = relative(dir, filePath).replace(/\\/g, "/");
    hash.update(`file:${rel}\n`);
    const bytes = readFileSync(filePath);
    const isText =
      /\.(md|json|mjs|js|ts|sh|yaml|yml|txt|cfg|tla|dot|mmd|out|exit)$/i.test(rel) ||
      rel === "LICENSE" ||
      rel === ".gitignore";
    hash.update(isText ? bytes.toString("utf8").replace(/\r\n/g, "\n") : bytes);
    hash.update("\n");
  }
  return hash.digest("hex");
}

function copyDirClean(src, dst) {
  rmSync(dst, { recursive: true, force: true });
  mkdirSync(dst, { recursive: true });
  cpSync(src, dst, {
    recursive: true,
    filter: (p) => {
      const rel = relative(src, p);
      if (!rel) return true;
      const parts = rel.split(/[\\/]/);
      return !parts.includes(".DS_Store") && !parts.includes("node_modules");
    },
  });
}

function gitOutput(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function resolveUpstreamSource({ repo, ref, source }) {
  if (source) {
    const resolved = resolve(source);
    const pstackDir = existsSync(join(resolved, "pstack", "plugin.json"))
      ? join(resolved, "pstack")
      : resolved;
    if (!existsSync(join(pstackDir, "plugin.json"))) {
      throw new Error(`No pstack/plugin.json found in source path: ${resolved}`);
    }
    let commit = "local";
    const gitRoot = existsSync(join(resolved, ".git")) ? resolved : null;
    if (gitRoot) {
      try {
        commit = gitOutput(["log", "-1", "--format=%H", "--", "pstack"], gitRoot) || gitOutput(["rev-parse", "HEAD"], gitRoot);
      } catch {
        commit = "local";
      }
    }
    return { pstackDir, commit, cleanup: () => {} };
  }

  const tmp = mkdtempSync(join(tmpdir(), "pstack-upstream-"));
  try {
    execFileSync(
      "git",
      ["clone", "--depth", "1", "--filter=blob:none", "--sparse", "--branch", ref, repo, tmp],
      { stdio: "pipe" },
    );
    execFileSync("git", ["sparse-checkout", "set", "pstack"], { cwd: tmp, stdio: "pipe" });
    const commit = gitOutput(["rev-parse", "HEAD"], tmp);
    return {
      pstackDir: join(tmp, "pstack"),
      commit,
      cleanup: () => rmSync(tmp, { recursive: true, force: true }),
    };
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
}

function patchPotetoAgent(raw) {
  const normalized = raw.replace(/\r\n/g, "\n");
  const fallbackOld =
    "With no path, before any other work, search `~/.cursor/plugins/` for a file whose path ends in `skills/poteto-mode/SKILL.md`. If more than one file matches, use the copy whose `.cursor-plugin/plugin.json` has the highest `version`. Your skill catalog hides this skill, so a missing catalog entry does not mean pstack is absent.";
  const fallbackNew =
    "With no path, before any other work, search for `poteto-mode/SKILL.md` in the current project's skills directory (`.agents/skills/`, `.cursor/skills/`, `.claude/skills/`, `.opencode/skills/`, `.gemini/skills/`, `.github/skills/`) and then the user's global skills or plugins directories (`~/.agents/skills/`, `~/.cursor/skills/`, `~/.cursor/plugins/`, `~/.claude/skills/`, `~/.claude/plugins/`, `~/.codex/skills/`, `~/.config/opencode/skills/`, `~/.gemini/skills/`, `~/.gemini/config/skills/`). If more than one file matches, prefer the project-local copy or the copy with the highest `version`. Your skill catalog may hide this skill, so a missing catalog entry does not mean pstack is absent.";
  if (normalized.includes(fallbackOld)) {
    return normalized.replace(fallbackOld, fallbackNew);
  }
  return normalized;
}

function writeGithubOutputs(outputs) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  const lines = Object.entries(outputs).map(([k, v]) => `${k}=${v ?? ""}`);
  appendFileSync(file, `${lines.join("\n")}\n`, "utf8");
}

export function syncUpstream({
  targetRoot = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  repo = DEFAULT_REPO,
  ref = DEFAULT_REF,
  source = null,
  force = false,
  check = false,
  dryRun = false,
  verify = true,
} = {}) {
  const prevStatePath = join(targetRoot, SYNC_STATE_FILE);
  const prevState = existsSync(prevStatePath) ? JSON.parse(readFileSync(prevStatePath, "utf8")) : null;
  const prevVersion = existsSync(join(targetRoot, "package.json"))
    ? JSON.parse(readFileSync(join(targetRoot, "package.json"), "utf8")).version
    : null;

  const { pstackDir, commit, cleanup } = resolveUpstreamSource({ repo, ref, source });
  try {
    const upstreamPlugin = JSON.parse(readFileSync(join(pstackDir, "plugin.json"), "utf8"));
    const upstreamVersion = upstreamPlugin.version;
    const treeHash = hashTree(pstackDir);

    const upToDate = prevState && prevState.treeHash === treeHash;
    if (upToDate && !force) {
      const result = {
        changed: false,
        version: upstreamVersion,
        prevVersion,
        commit,
        prevCommit: prevState.commit,
        treeHash,
      };
      writeGithubOutputs({
        changed: "false",
        version: upstreamVersion,
        prev_version: prevVersion || "",
        upstream_sha: commit,
        upstream_short_sha: commit.slice(0, 8),
        prev_sha: prevState.commit || "",
      });
      return result;
    }

    if (check || dryRun) {
      const result = {
        changed: true,
        dryRun: true,
        version: upstreamVersion,
        prevVersion,
        commit,
        prevCommit: prevState?.commit || null,
        treeHash,
      };
      writeGithubOutputs({
        changed: "true",
        version: upstreamVersion,
        prev_version: prevVersion || "",
        upstream_sha: commit,
        upstream_short_sha: commit.slice(0, 8),
        prev_sha: prevState?.commit || "",
      });
      return result;
    }

    const skillsDst = join(targetRoot, "skills");
    const universalAdapterSrc = join(targetRoot, "docs", "harness", "universal.md");
    if (!existsSync(universalAdapterSrc)) {
      throw new Error(`Missing canonical universal adapter at ${universalAdapterSrc}`);
    }

    // 1. Replace upstream-owned trees
    copyDirClean(join(pstackDir, "skills"), skillsDst);
    if (existsSync(join(pstackDir, "docs", "guide"))) {
      copyDirClean(join(pstackDir, "docs", "guide"), join(targetRoot, "docs", "guide"));
    }
    if (existsSync(join(pstackDir, "docs", "harness"))) {
      mkdirSync(join(targetRoot, "docs", "harness"), { recursive: true });
      for (const name of readdirSync(join(pstackDir, "docs", "harness"))) {
        if (name === "universal.md") continue;
        copyFileSync(
          join(pstackDir, "docs", "harness", name),
          join(targetRoot, "docs", "harness", name),
        );
      }
    }
    if (existsSync(join(pstackDir, "automations"))) {
      copyDirClean(join(pstackDir, "automations"), join(targetRoot, "automations"));
    }
    if (existsSync(join(pstackDir, "assets"))) {
      copyDirClean(join(pstackDir, "assets"), join(targetRoot, "assets"));
    }

    // 2. Copy root manifests & license
    for (const rel of ["LICENSE", "plugin.json", ".cursor-plugin/plugin.json"]) {
      const src = join(pstackDir, rel);
      const dst = join(targetRoot, rel);
      if (existsSync(src)) {
        mkdirSync(dirname(dst), { recursive: true });
        copyFileSync(src, dst);
      }
    }
    mkdirSync(join(targetRoot, ".claude-plugin"), { recursive: true });
    copyFileSync(join(pstackDir, "plugin.json"), join(targetRoot, ".claude-plugin", "plugin.json"));

    // 3. Sync agents (patching poteto-agent.md fallback search paths) and mirror into poteto-mode/references/agents/
    const agentsSrc = join(pstackDir, "agents");
    const agentsDst = join(targetRoot, "agents");
    const refAgentsDst = join(skillsDst, "poteto-mode", "references", "agents");
    mkdirSync(agentsDst, { recursive: true });
    mkdirSync(refAgentsDst, { recursive: true });
    for (const name of readdirSync(agentsSrc).filter((n) => n.endsWith(".md"))) {
      const raw = readFileSync(join(agentsSrc, name), "utf8");
      const content = name === "poteto-agent.md" ? patchPotetoAgent(raw) : raw.replace(/\r\n/g, "\n");
      writeFileSync(join(agentsDst, name), content, "utf8");
      writeFileSync(join(refAgentsDst, name), content, "utf8");
    }

    // 4. Mirror universal harness adapter, LICENSE, and NOTICE into skills/poteto-mode/
    mkdirSync(join(skillsDst, "poteto-mode", "references"), { recursive: true });
    copyFileSync(universalAdapterSrc, join(skillsDst, "poteto-mode", "references", "harness-adapter.md"));
    if (existsSync(join(targetRoot, "LICENSE"))) {
      copyFileSync(join(targetRoot, "LICENSE"), join(skillsDst, "poteto-mode", "LICENSE"));
    }
    if (existsSync(join(targetRoot, "NOTICE"))) {
      copyFileSync(join(targetRoot, "NOTICE"), join(skillsDst, "poteto-mode", "NOTICE"));
    }

    // 5. Mirror docs/guide/*.md into skills/poteto-help/references/guide/ with self-contained links
    const guideSrc = join(targetRoot, "docs", "guide");
    const guideDst = join(skillsDst, "poteto-help", "references", "guide");
    if (existsSync(guideSrc)) {
      rmSync(guideDst, { recursive: true, force: true });
      mkdirSync(guideDst, { recursive: true });
      for (const name of readdirSync(guideSrc).filter((n) => n.endsWith(".md"))) {
        const raw = readFileSync(join(guideSrc, name), "utf8").replace(/\r\n/g, "\n");
        const rewritten = raw.replace(LINK_RE, (full, href) => {
          if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#")) return full;
          const [target, hash] = href.split("#");
          const suffix = hash ? `#${hash}` : "";
          const norm = posix.normalize(posix.join("docs/guide", target));
          if (norm.startsWith("skills/")) {
            return `](../../../${norm.slice("skills/".length)}${suffix})`;
          }
          if (norm === "docs/harness/claude-code.md") {
            return `](../../../poteto-mode/references/harness-adapter.md#claude-code)`;
          }
          if (norm.startsWith("docs/guide/") && norm.endsWith(".md")) {
            return `](./${norm.slice("docs/guide/".length)}${suffix})`;
          }
          return `](${UPSTREAM_BLOB_BASE}/${norm}${suffix})`;
        });
        writeFileSync(join(guideDst, name), rewritten, "utf8");
      }
    }

    // 6. Update skills/poteto-help/SKILL.md links & install note
    const helpPath = join(skillsDst, "poteto-help", "SKILL.md");
    if (existsSync(helpPath)) {
      let helpText = readFileSync(helpPath, "utf8").replace(/\r\n/g, "\n");
      helpText = helpText
        .replace(/\]\(\.\.\/\.\.\/README\.md\)/g, "](references/guide/README.md)")
        .replace(/\]\(\.\.\/\.\.\/docs\/guide\/([^)]+)\)/g, "](references/guide/$1)")
        .replace(/\]\(\.\.\/\.\.\/docs\/harness\/claude-code\.md\)/g, "](../poteto-mode/references/harness-adapter.md)")
        .replace(
          "1. Install with `/add-plugin pstack` in chat, or from Customize in the sidebar.",
          "1. Install with `npx github:Junzki/pstack-ports install --all -g` (or `npx skills add Junzki/pstack-ports --all -g` for any Agent Skills harness), `/add-plugin pstack` in Cursor, or `/plugin install pstack@cursor-plugins` in Claude Code.",
        );
      writeFileSync(helpPath, helpText, "utf8");
    }

    // 7. Inject 1-line conditional harness adapter pointer into every SKILL.md using Cursor names
    const skills = readdirSync(skillsDst)
      .filter((name) => existsSync(join(skillsDst, name, "SKILL.md")))
      .sort();
    for (const skill of skills) {
      const dir = join(skillsDst, skill);
      const others = skills.filter((n) => n !== skill).join("|");
      const routeRe = new RegExp(`the \\*\\*(?<bold>${others})\\*\\* skill|\`/(?<command>${others})\``, "g");
      const linksToSkill = (line, name) => line.includes(`(../${name}/`);
      const namesBareSkill = (line) =>
        [...line.matchAll(routeRe)].some(({ groups }) => !linksToSkill(line, groups.bold ?? groups.command));

      let usesCursor = false;
      for (const filePath of walk(dir).filter((p) => p.endsWith(".md") && !p.endsWith("harness-adapter.md"))) {
        const text = readFileSync(filePath, "utf8");
        if (CURSOR_TERMS.some((t) => t.re.test(text)) || text.split("\n").some(namesBareSkill)) {
          usesCursor = true;
          break;
        }
      }
      if (!usesCursor) continue;

      const skillFile = join(dir, "SKILL.md");
      const text = readFileSync(skillFile, "utf8").replace(/\r\n/g, "\n");
      const adapterHref =
        skill === "poteto-mode" ? "references/harness-adapter.md" : "../poteto-mode/references/harness-adapter.md";
      const note = `> Outside Cursor, read [the harness adapter](${adapterHref}) once per session before following this skill. It maps Cursor tool, subagent, model, and path names to your harness.`;
      if (!text.includes("> Outside Cursor, read [the harness adapter]")) {
        const updated = text.replace(/^(# .*)\n+/m, `$1\n\n${note}\n\n`);
        writeFileSync(skillFile, updated, "utf8");
      }
    }

    // 8. Sync package.json version to upstream plugin.json version
    const pkgPath = join(targetRoot, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    pkg.version = upstreamVersion;
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");

    // 9. Splice upstream README body (from `## get started` onward) beneath our standalone header
    const upstreamReadmePath = join(pstackDir, "README.md");
    const targetReadmePath = join(targetRoot, "README.md");
    if (existsSync(upstreamReadmePath) && existsSync(targetReadmePath)) {
      const currentReadme = readFileSync(targetReadmePath, "utf8").replace(/\r\n/g, "\n");
      const upstreamReadme = readFileSync(upstreamReadmePath, "utf8").replace(/\r\n/g, "\n");
      const curIdx = currentReadme.indexOf("## get started");
      const upIdx = upstreamReadme.indexOf("## get started");
      if (curIdx !== -1 && upIdx !== -1) {
        writeFileSync(targetReadmePath, currentReadme.slice(0, curIdx) + upstreamReadme.slice(upIdx), "utf8");
      }
    }

    // 10. Record upstream sync metadata
    writeFileSync(
      prevStatePath,
      `${JSON.stringify(
        {
          repo,
          ref,
          commit,
          version: upstreamVersion,
          treeHash,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    if (verify) {
      const ok = runVerification(targetRoot);
      if (!ok) {
        throw new Error("Verification failed after syncing upstream pstack.");
      }
    }

    const result = {
      changed: true,
      version: upstreamVersion,
      prevVersion,
      commit,
      prevCommit: prevState?.commit || null,
      treeHash,
    };
    writeGithubOutputs({
      changed: "true",
      version: upstreamVersion,
      prev_version: prevVersion || "",
      upstream_sha: commit,
      upstream_short_sha: commit.slice(0, 8),
      prev_sha: prevState?.commit || "",
    });
    return result;
  } finally {
    cleanup();
  }
}

function parseCliArgs(argv) {
  const opts = {
    repo: DEFAULT_REPO,
    ref: DEFAULT_REF,
    source: null,
    force: false,
    check: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--repo") opts.repo = argv[++i];
    else if (a === "--ref") opts.ref = argv[++i];
    else if (a === "--source") opts.source = argv[++i];
    else if (a === "--force") opts.force = true;
    else if (a === "--check") opts.check = true;
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "-h" || a === "--help") {
      console.log(
        "Usage: node scripts/sync-upstream.mjs [--repo <url>] [--ref <branch>] [--source <local-path>] [--force] [--check] [--dry-run]",
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${a}`);
    }
  }
  return opts;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opts = parseCliArgs(process.argv.slice(2));
  const res = syncUpstream(opts);
  if (!res.changed) {
    console.log(`Already up to date with upstream pstack v${res.version} (${res.commit.slice(0, 8)}).`);
    process.exit(0);
  }
  if (opts.check) {
    console.log(`Upstream pstack update available: v${res.prevVersion || "none"} -> v${res.version} (${res.commit.slice(0, 8)}).`);
    process.exit(2);
  }
  console.log(
    `${opts.dryRun ? "[dry-run] Would sync" : "Synced"} upstream pstack v${res.prevVersion || "none"} -> v${res.version} (${res.commit.slice(0, 8)}).`,
  );
}
