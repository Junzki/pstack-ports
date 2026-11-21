#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
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
  return readdirSync(dir).flatMap((name) => {
    if (name === ".DS_Store" || name === "node_modules") return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

export function runVerification(root = resolve(dirname(fileURLToPath(import.meta.url)), "..")) {
  const problems = [];
  const skillsRoot = join(root, "skills");
  const adapterPath = join(skillsRoot, "poteto-mode", "references", "harness-adapter.md");

  if (!existsSync(adapterPath)) {
    problems.push("Missing skills/poteto-mode/references/harness-adapter.md");
  }
  const adapterText = existsSync(adapterPath) ? readFileSync(adapterPath, "utf8") : "";

  const skills = readdirSync(skillsRoot)
    .filter((name) => existsSync(join(skillsRoot, name, "SKILL.md")))
    .sort();

  const usedTerms = new Set();
  let wrappedCount = 0;
  let linkCount = 0;

  for (const skill of skills) {
    if (!SKILL_NAME_RE.test(skill) || skill.length > 64) {
      problems.push(`skills/${skill}: invalid Agent Skills folder name`);
    }

    const skillFile = join(skillsRoot, skill, "SKILL.md");
    const raw = readFileSync(skillFile, "utf8").replace(/\r\n/g, "\n");
    const fm = raw.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
    const name = fm.match(/^name:(.*)$/m)?.[1].trim().replace(/^(["'])(.*)\1$/, "$2");
    const desc = fm.match(/^description:(.*)$/m)?.[1].trim();
    if (name !== skill) {
      problems.push(`skills/${skill}/SKILL.md: frontmatter name ${JSON.stringify(name)} !== folder ${skill}`);
    }
    if (!desc) {
      problems.push(`skills/${skill}/SKILL.md: missing description in frontmatter`);
    }

    const others = skills.filter((n) => n !== skill).join("|");
    const routeRe = new RegExp(`the \\*\\*(?<bold>${others})\\*\\* skill|\`/(?<command>${others})\``, "g");
    const linksToSkill = (line, target) => line.includes(`(../${target}/`);
    const namesBareSkill = (line) =>
      [...line.matchAll(routeRe)].some(({ groups }) => !linksToSkill(line, groups.bold ?? groups.command));

    let usesCursor = false;
    for (const filePath of walk(join(skillsRoot, skill)).filter((p) => p.endsWith(".md"))) {
      const rel = relative(skillsRoot, filePath).replace(/\\/g, "/");
      const text = readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");

      if (!rel.endsWith("harness-adapter.md")) {
        for (const term of CURSOR_TERMS) {
          if (term.re.test(text)) {
            usedTerms.add(term.key);
            usesCursor = true;
          }
        }
        if (text.split("\n").some(namesBareSkill)) {
          usedTerms.add("Run another pstack skill");
          usesCursor = true;
        }
      }

      for (const [, href] of text.matchAll(LINK_RE)) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#")) continue;
        linkCount++;
        const target = href.split("#")[0].split("?")[0];
        const norm = posix.normalize(posix.join(posix.dirname(rel), target)).replace(/\/$/, "");
        if (norm.startsWith("..")) {
          problems.push(`skills/${rel}: link ${href} escapes skills/ directory`);
        } else if (!existsSync(join(skillsRoot, norm))) {
          problems.push(`skills/${rel}: broken link ${href} (resolved skills/${norm})`);
        }
      }
    }

    if (usesCursor) {
      if (!raw.includes("harness-adapter.md")) {
        problems.push(`skills/${skill}/SKILL.md: uses Cursor terms but missing harness-adapter.md pointer`);
      } else {
        wrappedCount++;
      }
    }
  }

  for (const key of usedTerms) {
    if (!adapterText.includes(key)) {
      problems.push(`harness-adapter.md is missing mapping for ${key}`);
    }
  }

  // Check mirrored agents
  for (const agentFile of ["poteto-agent.md", "comment-sicko.md"]) {
    if (!existsSync(join(root, "agents", agentFile))) {
      problems.push(`Missing agents/${agentFile}`);
    }
    if (!existsSync(join(skillsRoot, "poteto-mode", "references", "agents", agentFile))) {
      problems.push(`Missing skills/poteto-mode/references/agents/${agentFile}`);
    }
  }

  // Check LICENSE and NOTICE are present at root and bundled inside skills/poteto-mode/
  for (const legalFile of ["LICENSE", "NOTICE"]) {
    const rootFile = join(root, legalFile);
    const skillFile = join(skillsRoot, "poteto-mode", legalFile);
    if (!existsSync(rootFile)) {
      problems.push(`Missing ${legalFile}`);
    } else if (!existsSync(skillFile)) {
      problems.push(`Missing skills/poteto-mode/${legalFile}`);
    } else {
      const a = readFileSync(rootFile, "utf8").replace(/\r\n/g, "\n");
      const b = readFileSync(skillFile, "utf8").replace(/\r\n/g, "\n");
      if (a !== b) {
        problems.push(`skills/poteto-mode/${legalFile} is out of sync with ${legalFile}`);
      }
    }
  }

  // Check version consistency across manifests
  const manifestFiles = [
    "package.json",
    "plugin.json",
    ".cursor-plugin/plugin.json",
    ".claude-plugin/plugin.json",
  ];
  const versions = new Map();
  for (const rel of manifestFiles) {
    const p = join(root, rel);
    if (!existsSync(p)) {
      problems.push(`Missing manifest ${rel}`);
      continue;
    }
    versions.set(rel, JSON.parse(readFileSync(p, "utf8")).version);
  }
  if (new Set(versions.values()).size > 1) {
    problems.push(`Version mismatch across manifests: ${JSON.stringify(Object.fromEntries(versions))}`);
  }

  console.log(
    `Verified ${skills.length} skills, ${wrappedCount} with harness adapter pointer, ${linkCount} relative links, ${manifestFiles.length} manifests.`,
  );
  if (problems.length > 0) {
    for (const p of problems) console.error(`FAIL ${p}`);
    console.error(`${problems.length} problem(s) found.`);
    return false;
  }
  console.log("OK — 0 problems.");
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ok = runVerification();
  process.exit(ok ? 0 : 1);
}
