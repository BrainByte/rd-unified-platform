// ============================================================================
// REAL DATAFORM COMPILATION — proves the project is a valid Dataform project.
//
//   npm run dataform:compile
//
// Dataform 3.x requires a PURE workspace: exactly workflow_settings.yaml +
// definitions/ + includes/, and it refuses to compile if npm artifacts
// (package.json, node_modules) share the directory. Those artifacts belong
// to the OFFLINE HARNESS and are irrelevant to the cloud — so this script
// stages the pure workspace into a temp folder and runs the genuine
// @dataform/cli compile against it.
//
// The staged folder IS the deployable artifact set: push those three things
// to the repository a Google Cloud Dataform instance is connected to (or
// keep them as their own repo/subtree) and the same compile runs there.
// No .sqlx files exist BY DESIGN: this project uses Dataform's JavaScript
// API (publish/declare/assert in definitions/*.js) so the same SQL builders
// can also be executed offline — see ARCHITECTURE.md §7.
// ============================================================================
"use strict";
const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SRC = path.join(__dirname, "..");
const STAGE = path.join(os.tmpdir(), "dataform-workspace");

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const f = path.join(from, entry.name);
    const t = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(f, t);
    else fs.copyFileSync(f, t);
  }
}

fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });
fs.copyFileSync(path.join(SRC, "workflow_settings.yaml"),
                path.join(STAGE, "workflow_settings.yaml"));
copyDir(path.join(SRC, "definitions"), path.join(STAGE, "definitions"));
copyDir(path.join(SRC, "includes"), path.join(STAGE, "includes"));

console.log(`Staged pure Dataform workspace -> ${STAGE}`);
console.log("Running the genuine @dataform/cli compile...\n");
try {
  execSync("npx -y @dataform/cli@latest compile", {
    cwd: STAGE, stdio: "inherit", shell: true,
  });
  console.log("\n✔ dataform compile SUCCEEDED — the definitions/ + includes/ " +
              "you just changed are a valid Dataform project as-is.");
} catch (err) {
  console.error("\n✘ dataform compile FAILED — fix the definitions before deploying.");
  process.exit(1);
}
