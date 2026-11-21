import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { detectInstalledHarnesses, HARNESSES } from "./harnesses.mjs";

export async function promptInstallOptions({ cwd, home, env }) {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const detected = detectInstalledHarnesses({ cwd, home, env });
    const detectedIds = detected.map((h) => h.id);

    console.log("");
    console.log("pstack installer");
    console.log("----------------");
    if (detectedIds.length > 0) {
      console.log(`Detected harnesses: ${detectedIds.join(", ")}`);
    } else {
      console.log("No harness config folders detected; universal (.agents/skills) is ready.");
    }

    const scopeAnswer = (
      await rl.question("\n1. Install scope? [1] Global (recommended)  [2] Current project  (default: 1): ")
    ).trim();
    const global = scopeAnswer !== "2";

    const defaultTarget = detectedIds.length > 0 ? "1" : "2";
    const harnessAnswer = (
      await rl.question(
        `\n2. Target harnesses?\n` +
          `   [1] Detected (${detectedIds.length > 0 ? detectedIds.join(", ") : "universal"})\n` +
          `   [2] All supported harnesses (${HARNESSES.length})\n` +
          `   Or type comma-separated IDs (e.g. cursor,claude-code,codex,opencode,antigravity)\n` +
          `   Choice (default: ${defaultTarget}): `,
      )
    ).trim();

    let harnesses;
    if (!harnessAnswer || harnessAnswer === defaultTarget) {
      harnesses = defaultTarget === "1" ? ["detected"] : ["all"];
    } else if (harnessAnswer === "1") {
      harnesses = ["detected"];
    } else if (harnessAnswer === "2") {
      harnesses = ["all"];
    } else {
      harnesses = harnessAnswer.split(",").map((s) => s.trim()).filter(Boolean);
    }

    const skillAnswer = (
      await rl.question(
        "\n3. Which skills?\n" +
          "   [1] All (58 skills: 34 workflow commands + 24 principles)\n" +
          "   [2] Core (poteto-mode, poteto-help, setup-pstack + 24 principles)\n" +
          "   [3] Commands only (34 workflow commands)\n" +
          "   Choice (default: 1): ",
      )
    ).trim();

    let skills = "all";
    if (skillAnswer === "2") skills = "core";
    else if (skillAnswer === "3") skills = "commands";

    console.log("");
    return { global, harnesses, skills };
  } finally {
    rl.close();
  }
}
