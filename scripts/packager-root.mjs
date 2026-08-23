#!/usr/bin/env node
/** Resolve installed vibed-infra package root (directory containing install.sh). */
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
try {
  const pkg = require.resolve("vibed-infra/package.json");
  process.stdout.write(path.dirname(pkg));
} catch {
  console.error("vibed-infra is not installed — run npm install");
  process.exit(1);
}
