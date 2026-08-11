#!/usr/bin/env node
/**
 * Starts deploy console API (:8790) + Vite UI (:5179).
 */
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function run(label: string, command: string, args: string[]): void {
  const child = spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
    shell: false,
  });
  child.on("exit", (code) => {
    console.error(`[${label}] exited ${code}`);
    process.exit(code ?? 1);
  });
}

run("api", process.execPath, [
  "--experimental-strip-types",
  "--experimental-transform-types",
  "deploy/operator/server.ts",
]);
run("ui", resolve(root, "node_modules/.bin/vite"), [
  "--config",
  "deploy/operator/ui/vite.config.ts",
]);

console.error("Deploy console: http://127.0.0.1:5179  (API :8790)");
