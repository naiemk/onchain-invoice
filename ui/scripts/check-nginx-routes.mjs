// Ensures deploy/nginx/ui.conf serves exactly the routes in seo-routes.json.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { indexable, appOnly } = JSON.parse(readFileSync(join(root, "ui/src/shared/seo-routes.json"), "utf8"));
const conf = readFileSync(join(root, "deploy/nginx/ui.conf"), "utf8");
const names = (re) => (conf.match(re)?.[1] ?? "").split("|").sort();
const marketing = names(/\^\/\(([a-z|/-]+)\)\/\?\$/);
const spa = names(/\^\/\(([a-z|-]+)\)\(\/\|\$\)/);
const want = (list) => list.filter((p) => p !== "/").map((p) => p.slice(1)).sort();
const wantSpa = want(appOnly).filter((p) => p !== "pay");
const fail = [];
if (marketing.join() !== want(indexable).join()) fail.push(`indexable mismatch: nginx=${marketing} json=${want(indexable)}`);
if (spa.join() !== wantSpa.join()) fail.push(`app-only mismatch: nginx=${spa} json=${wantSpa}`);
if (fail.length) { console.error(fail.join("\n")); process.exit(1); }
console.log("nginx routes match seo-routes.json");
