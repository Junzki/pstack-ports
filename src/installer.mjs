import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import { discoverAgents, renderAgentForHarness } from "./agents.mjs";
import { findHarness, getHarnessPaths, HARNESSES, resolveHarnesses } from "./harnesses.mjs";

export const MANIFEST_FILE = ".pstack-manifest.json";
export const CORE_SKILLS = new Set(["poteto-mode", "poteto-help", "setup-pstack"]);

function safeRemove(targetPath) {
  let stat;
  try {
    stat = lstatSync(targetPath);
  } catch {
    return false;
  }
  if (stat.isSymbolicLink()) {
    unlinkSync(targetPath);
  } else {
    rmSync(targetPath, { recursive: true, force: true });
  }
  return true;
}

function pathExistsOrSymlink(targetPath) {
  try {
    lstatSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

export function getPackageVersion(packageRoot) {
  try {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function parseSkillFrontmatter(skillFilePath) {
  const raw = readFileSync(skillFilePath, "utf8").replace(/\r\n/g, "\n");
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { name: "", description: "" };
  const fields = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
    if (key) fields[key] = val;
  }
  return fields;
}

export function discoverSkills(packageRoot) {
  const skillsRoot = join(packageRoot, "skills");
  if (!existsSync(skillsRoot)) return [];
  return readdirSync(skillsRoot)
    .filter((name) => existsSync(join(skillsRoot, name, "SKILL.md")))
    .sort()
    .map((name) => {
      const dir = join(skillsRoot, name);
      const fm = parseSkillFrontmatter(join(dir, "SKILL.md"));
      const kind = name.startsWith("principle-") ? "principle" : "command";
      return {
        name,
        dir,
        kind,
        description: fm.description || "",
      };
    });
}

export function selectSkills(allSkills, selector = "all") {
  const tokens = Array.isArray(selector)
    ? selector.flatMap((v) => String(v).split(","))
    : selector
      ? String(selector).split(",")
      : ["all"];
  const cleaned = tokens.map((t) => t.trim().toLowerCase()).filter(Boolean);

  if (cleaned.length === 0 || cleaned.includes("all") || cleaned.includes("*")) {
    return [...allSkills];
  }

  const byName = new Map(allSkills.map((s) => [s.name, s]));
  const picked = new Map();
  const unknown = [];

  for (const token of cleaned) {
    if (token === "core") {
      for (const s of allSkills) {
        if (CORE_SKILLS.has(s.name) || s.kind === "principle") picked.set(s.name, s);
      }
    } else if (token === "commands") {
      for (const s of allSkills) {
        if (s.kind === "command") picked.set(s.name, s);
      }
    } else if (token === "principles") {
      for (const s of allSkills) {
        if (s.kind === "principle") picked.set(s.name, s);
      }
    } else if (byName.has(token)) {
      picked.set(token, byName.get(token));
    } else {
      unknown.push(token);
    }
  }

  if (unknown.length > 0) {
    throw new Error(`Unknown skill(s): ${unknown.join(", ")}. Run \`pstack list\` to see available skills.`);
  }

  // Always include poteto-mode if any skill is selected? No — respect explicit selection,
  // unless they used a preset.
  return [...picked.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function copySkillDir(srcDir, dstDir) {
  safeRemove(dstDir);
  mkdirSync(dstDir, { recursive: true });
  cpSync(srcDir, dstDir, {
    recursive: true,
    filter: (src) => !src.endsWith(".DS_Store") && !src.includes("node_modules"),
  });
}

function linkOrCopySkillDir(canonicalDir, dstDir) {
  safeRemove(dstDir);
  try {
    if (process.platform === "win32") {
      // Directory junctions work on Windows without Developer Mode or elevation.
      symlinkSync(canonicalDir, dstDir, "junction");
    } else {
      const relTarget = relative(resolve(dstDir, ".."), canonicalDir);
      symlinkSync(relTarget, dstDir, "dir");
    }
    return "symlink";
  } catch {
    copySkillDir(canonicalDir, dstDir);
    return "copy";
  }
}

function readManifest(dir) {
  const file = join(dir, MANIFEST_FILE);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeManifest(dir, data) {
  writeFileSync(join(dir, MANIFEST_FILE), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export function installPstack({
  packageRoot,
  harnesses: requestedHarnesses,
  skills: requestedSkills = "all",
  global = false,
  cwd = process.cwd(),
  home = homedir(),
  env = process.env,
  mode = "auto",
  includeAgents = true,
  dryRun = false,
} = {}) {
  const version = getPackageVersion(packageRoot);
  const allSkills = discoverSkills(packageRoot);
  const selectedSkills = selectSkills(allSkills, requestedSkills);
  const allAgents = includeAgents ? discoverAgents(packageRoot) : [];
  const targets = resolveHarnesses(requestedHarnesses, { cwd, home, env });

  // Group harnesses by resolved skillsDir so shared directories (like .agents/skills)
  // are written only once.
  const skillBuckets = new Map();
  const agentBuckets = new Map();

  for (const harness of targets) {
    const { skillsDir, agentsDir } = getHarnessPaths(harness, { global, cwd, home, env });
    if (!skillBuckets.has(skillsDir)) {
      skillBuckets.set(skillsDir, { dir: skillsDir, harnesses: [] });
    }
    skillBuckets.get(skillsDir).harnesses.push(harness);

    if (includeAgents && agentsDir && harness.agentFormat && allAgents.length > 0) {
      if (!agentBuckets.has(agentsDir)) {
        agentBuckets.set(agentsDir, { dir: agentsDir, format: harness.agentFormat, harnesses: [] });
      }
      agentBuckets.get(agentsDir).harnesses.push(harness);
    }
  }

  const effectiveMode =
    mode === "copy"
      ? "copy"
      : mode === "symlink"
        ? "symlink"
        : skillBuckets.size > 1
          ? "symlink"
          : "copy";

  const canonicalHarness = findHarness("universal");
  const canonicalSkillsDir = getHarnessPaths(canonicalHarness, { global, cwd, home, env }).skillsDir;

  const skillResults = [];
  const agentResults = [];

  if (effectiveMode === "symlink") {
    // Step 1: ensure canonical store has real copies of selected skills
    if (!dryRun) {
      mkdirSync(canonicalSkillsDir, { recursive: true });
      for (const skill of selectedSkills) {
        copySkillDir(skill.dir, join(canonicalSkillsDir, skill.name));
      }
      writeManifest(canonicalSkillsDir, {
        package: "pstack",
        version,
        mode: "canonical",
        skills: selectedSkills.map((s) => s.name),
        updatedAt: new Date().toISOString(),
      });
    }

    const canonicalBucket = skillBuckets.get(canonicalSkillsDir);
    skillResults.push({
      dir: canonicalSkillsDir,
      harnesses: canonicalBucket ? canonicalBucket.harnesses.map((h) => h.id) : ["universal"],
      skillCount: selectedSkills.length,
      mode: "canonical",
    });

    // Step 2: symlink/junction every other unique target directory to canonical store
    for (const [dir, bucket] of skillBuckets) {
      if (dir === canonicalSkillsDir) continue;
      let actualMode = "symlink";
      if (!dryRun) {
        mkdirSync(dir, { recursive: true });
        for (const skill of selectedSkills) {
          const used = linkOrCopySkillDir(join(canonicalSkillsDir, skill.name), join(dir, skill.name));
          if (used === "copy") actualMode = "copy";
        }
        writeManifest(dir, {
          package: "pstack",
          version,
          mode: actualMode,
          canonicalDir: canonicalSkillsDir,
          skills: selectedSkills.map((s) => s.name),
          updatedAt: new Date().toISOString(),
        });
      }
      skillResults.push({
        dir,
        harnesses: bucket.harnesses.map((h) => h.id),
        skillCount: selectedSkills.length,
        mode: actualMode,
      });
    }
  } else {
    for (const [dir, bucket] of skillBuckets) {
      if (!dryRun) {
        mkdirSync(dir, { recursive: true });
        for (const skill of selectedSkills) {
          copySkillDir(skill.dir, join(dir, skill.name));
        }
        writeManifest(dir, {
          package: "pstack",
          version,
          mode: "copy",
          skills: selectedSkills.map((s) => s.name),
          updatedAt: new Date().toISOString(),
        });
      }
      skillResults.push({
        dir,
        harnesses: bucket.harnesses.map((h) => h.id),
        skillCount: selectedSkills.length,
        mode: "copy",
      });
    }
  }

  for (const [dir, bucket] of agentBuckets) {
    const rendered = allAgents.map((agent) => renderAgentForHarness(agent, bucket.format));
    if (!dryRun) {
      mkdirSync(dir, { recursive: true });
      for (const file of rendered) {
        writeFileSync(join(dir, file.fileName), file.content, "utf8");
      }
      writeManifest(dir, {
        package: "pstack",
        version,
        format: bucket.format,
        agents: rendered.map((f) => f.fileName),
        updatedAt: new Date().toISOString(),
      });
    }
    agentResults.push({
      dir,
      format: bucket.format,
      harnesses: bucket.harnesses.map((h) => h.id),
      files: rendered.map((f) => f.fileName),
    });
  }

  return {
    version,
    scope: global ? "global" : "local",
    dryRun,
    harnesses: targets.map((h) => h.id),
    skills: selectedSkills.map((s) => s.name),
    skillTargets: skillResults,
    agentTargets: agentResults,
  };
}

export function uninstallPstack({
  packageRoot,
  harnesses: requestedHarnesses,
  global = false,
  cwd = process.cwd(),
  home = homedir(),
  env = process.env,
  dryRun = false,
} = {}) {
  const knownSkills = new Set(discoverSkills(packageRoot).map((s) => s.name));
  const knownAgentIds = new Set(discoverAgents(packageRoot).map((a) => a.id));
  const targets = resolveHarnesses(requestedHarnesses, { cwd, home, env });

  const skillDirs = new Map();
  const agentDirs = new Map();
  for (const harness of targets) {
    const { skillsDir, agentsDir } = getHarnessPaths(harness, { global, cwd, home, env });
    if (!skillDirs.has(skillsDir)) skillDirs.set(skillsDir, []);
    skillDirs.get(skillsDir).push(harness.id);
    if (agentsDir) {
      if (!agentDirs.has(agentsDir)) agentDirs.set(agentsDir, { harnesses: [], format: harness.agentFormat });
      agentDirs.get(agentsDir).harnesses.push(harness.id);
    }
  }

  const removedSkills = [];
  const removedAgents = [];

  for (const [dir, harnessIds] of skillDirs) {
    if (!existsSync(dir)) continue;
    const manifest = readManifest(dir);
    const toRemove = new Set(manifest?.skills || []);
    for (const name of knownSkills) {
      if (pathExistsOrSymlink(join(dir, name))) toRemove.add(name);
    }

    const removed = [];
    for (const name of [...toRemove].sort()) {
      const targetPath = join(dir, name);
      if (!pathExistsOrSymlink(targetPath)) continue;
      if (!dryRun) safeRemove(targetPath);
      removed.push(name);
    }

    if (!dryRun && existsSync(join(dir, MANIFEST_FILE))) {
      safeRemove(join(dir, MANIFEST_FILE));
    }

    if (removed.length > 0 || manifest) {
      removedSkills.push({ dir, harnesses: harnessIds, count: removed.length });
    }
  }

  for (const [dir, info] of agentDirs) {
    if (!existsSync(dir)) continue;
    const manifest = readManifest(dir);
    const candidates = new Set(manifest?.agents || []);
    for (const id of knownAgentIds) {
      candidates.add(`${id}.md`);
      candidates.add(`${id}.agent.md`);
    }

    const removed = [];
    for (const fileName of [...candidates].sort()) {
      const targetPath = join(dir, fileName);
      if (!pathExistsOrSymlink(targetPath)) continue;
      if (!dryRun) safeRemove(targetPath);
      removed.push(fileName);
    }

    if (!dryRun && existsSync(join(dir, MANIFEST_FILE))) {
      safeRemove(join(dir, MANIFEST_FILE));
    }

    if (removed.length > 0 || manifest) {
      removedAgents.push({ dir, harnesses: info.harnesses, files: removed });
    }
  }

  return {
    scope: global ? "global" : "local",
    dryRun,
    harnesses: targets.map((h) => h.id),
    removedSkills,
    removedAgents,
  };
}

export function getInstallStatus({
  packageRoot,
  cwd = process.cwd(),
  home = homedir(),
  env = process.env,
} = {}) {
  const knownSkills = discoverSkills(packageRoot).map((s) => s.name);
  const rows = [];

  for (const harness of HARNESSES) {
    const localPaths = getHarnessPaths(harness, { global: false, cwd, home, env });
    const globalPaths = getHarnessPaths(harness, { global: true, cwd, home, env });

    const inspect = (dir) => {
      if (!existsSync(dir)) return { installed: 0, version: null, mode: null };
      const manifest = readManifest(dir);
      let count = 0;
      for (const name of knownSkills) {
        if (existsSync(join(dir, name, "SKILL.md"))) count++;
      }
      return {
        installed: count,
        version: manifest?.version || null,
        mode: manifest?.mode || null,
      };
    };

    rows.push({
      id: harness.id,
      name: harness.name,
      detected: harness.detect(cwd, home, env),
      local: { dir: localPaths.skillsDir, ...inspect(localPaths.skillsDir) },
      global: { dir: globalPaths.skillsDir, ...inspect(globalPaths.skillsDir) },
    });
  }

  return {
    totalBundled: knownSkills.length,
    harnesses: rows,
  };
}
