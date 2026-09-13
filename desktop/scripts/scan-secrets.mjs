import { spawnSync } from "node:child_process";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repository = resolve(desktop, "..");
const config = join(desktop, ".secretlintrc.json");
const packageDir = join(desktop, "node_modules", "secretlint");
const packageJson = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8"));
const cli = join(packageDir, typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin.secretlint);
const within = (path) => {
  const part = relative(repository, path);
  return part !== ".." && !part.startsWith("../") && !isAbsolute(part);
};
const files = new Set();

async function collect(path) {
  if (!within(path)) throw new Error("Secret scans must stay within this repository");
  const stat = await lstat(path).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!stat) return;
  if (stat.isSymbolicLink()) throw new Error("Refusing a symlink in the secret scan input");
  if (!within(await realpath(path))) throw new Error("Secret scan input escapes the repository");
  if (stat.isDirectory()) {
    for (const child of await readdir(path)) {
      if (child === "node_modules" || child === ".git") continue;
      await collect(join(path, child));
    }
    return;
  }
  if (!stat.isFile()) return;
  // Secretlint's detectors operate on text. Binary artifacts require an
  // extracted application payload; passing a DMG/ASAR alone is not a scan.
  const bytes = await readFile(path);
  if (!bytes.includes(0)) files.add(path);
}

const args = process.argv.slice(2);
if (args.length) {
  for (const arg of args) await collect(resolve(desktop, arg));
} else {
  const git = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: repository,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (git.status !== 0) throw new Error("Could not enumerate repository files for secret scanning");
  for (const name of git.stdout.split("\0").filter(Boolean)) await collect(join(repository, name));
}
if (!files.size) throw new Error("Secret scan has no text inputs; refusing an empty success");

const all = [...files];
let findings = 0;
for (let offset = 0; offset < all.length; offset += 50) {
  const run = spawnSync(process.execPath, [
    cli, "--format", "json", "--no-color", "--no-terminalLink", "--no-glob",
    "--no-gitignore", "--secretlintrc", config, ...all.slice(offset, offset + 50),
  ], { cwd: desktop, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  // Never forward CLI output, source snippets, or detector messages. Even an
  // unexpected plugin/CLI error must not print a secret into an agent/CI log.
  if (run.error || run.status === null || run.status > 1) {
    throw new Error("Secretlint failed to run; raw diagnostics suppressed for credential safety");
  }
  let reports;
  try {
    reports = JSON.parse(run.stdout);
  } catch {
    throw new Error("Secretlint returned invalid diagnostics; raw output suppressed");
  }
  if (!Array.isArray(reports)) throw new Error("Unexpected Secretlint report format");
  let batchFindings = 0;
  for (const report of reports) {
    for (const message of report.messages ?? []) {
      batchFindings++;
      const path = relative(repository, report.filePath ?? "unknown");
      const rule = String(message.ruleId ?? "unknown").replace(/[^a-zA-Z0-9@/_.-]/g, "");
      console.error(JSON.stringify({ file: path, line: message.line, column: message.column, rule }));
    }
  }
  if (run.status === 1 && !batchFindings) throw new Error("Secretlint failed without structured findings");
  findings += batchFindings;
}
console.log(`Secret scan: ${all.length} text files; ${findings} findings. Secret values omitted.`);
process.exitCode = findings ? 1 : 0;
