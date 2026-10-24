import { readFileSync } from "node:fs";
import { expect } from "chai";

/** Variables start-api.sh sets by other means (explicit -e/-v), not through add_env. */
const SET_ELSEWHERE = new Set(["CONFIG_PATH", "DB_PATH", "PERSIST_LOG_DIR", "PORT"]);

function configEnvVars(): string[] {
  const src = readFileSync("commerce/server/config.ts", "utf8");
  return [...new Set([...src.matchAll(/env\.([A-Z][A-Z0-9_]+)/g)].map((m) => m[1]))].sort();
}

function passedVars(script: string): Set<string> {
  const src = readFileSync(script, "utf8");
  return new Set([...src.matchAll(/^add_env ([A-Z0-9_]+)/gm)].map((m) => m[1]));
}

describe("deploy env parity", function () {
  for (const script of ["deploy/overlays/start-api.sh", "deploy/templates/start-onchain-invoice-api.sh"]) {
    it(`${script} passes every variable config.ts reads into the container`, function () {
      const passed = passedVars(script);
      const missing = configEnvVars().filter((v) => !passed.has(v) && !SET_ELSEWHERE.has(v));
      expect(missing, `add_env missing in ${script}`).to.deep.equal([]);
    });
  }

  it("API env examples document the email variables", function () {
    for (const f of ["deploy/templates/.env.api.example", "deploy/overlays/env.api.tcmain.example", "deploy/overlays/env.api.tctest.example"]) {
      const src = readFileSync(f, "utf8");
      for (const v of ["RESEND_API_KEY", "RESEND_FROM", "WALLET_RECOVERY_NOTIFY_EMAIL"]) expect(src, `${f} ${v}`).to.include(v);
    }
  });

  it("packaged dist copies match the overlays (run deploy/package.sh or cp after editing overlays)", function () {
    for (const product of ["tcmain", "tctest"]) {
      const pairs: [string, string][] = [
        ["start-api.sh", "start-api.sh"],
        ["update-api.sh", "update-api.sh"],
        ["start-nodes.sh", "start-nodes.sh"],
        ["update-nodes.sh", "update-nodes.sh"],
        [`docker-compose.workers.${product}.yml`, "docker-compose.workers.yml"],
      ];
      pairs.push([`env.api.${product}.example`, ".env.api.example"], ["config-record.sh", "config-record.sh"]);
      for (const [overlay, dist] of pairs) {
        expect(readFileSync(`deploy/${product}/dist/${dist}`, "utf8"), `${product}/${dist}`).to.equal(
          readFileSync(`deploy/overlays/${overlay}`, "utf8")
        );
      }
    }
  });
});
