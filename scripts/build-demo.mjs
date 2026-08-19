import { spawn } from "node:child_process";
import { cpSync, copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const client = path.join(root, "client");
const distDemo = path.join(client, "dist-demo");
const demoDir = path.join(root, "demo");

process.env.VITE_APP_DEMO = "1";

const child = spawn(
  "npx",
  ["vite", "build", "--base=/Dayly/", "--outDir", "dist-demo"],
  { cwd: client, stdio: "inherit", env: process.env, shell: true },
);

child.on("exit", (code) => {
  if (code !== 0) process.exit(code ?? 1);
  if (!existsSync(path.join(distDemo, "index.html"))) {
    console.error("build:demo: falta client/dist-demo/index.html");
    process.exit(1);
  }
  rmSync(demoDir, { recursive: true, force: true });
  mkdirSync(demoDir, { recursive: true });
  cpSync(distDemo, demoDir, { recursive: true });
  copyFileSync(path.join(demoDir, "index.html"), path.join(demoDir, "404.html"));
  console.log("Demo lista en demo/ (base /Dayly/)");
});
