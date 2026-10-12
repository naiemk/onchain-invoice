import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect } from "chai";

const CONTRACTS = ["IdentityStore", "IdentityWallet", "IdentityWalletFactory"] as const;
const SNAPSHOT_PATH = "test/snapshots/identity-bytecode.json";
const COMPILER = "0.8.26";

type Artifact = { bytecode?: string; abi?: unknown; metadata?: string };

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

function artifactFor(name: string): Artifact {
  const path = walk("artifacts").find((file) => file.endsWith(`/contracts/wallet/${name}.sol/${name}.json`));
  if (!path) throw new Error(`missing Hardhat artifact for ${name}`);
  return JSON.parse(readFileSync(path, "utf8")) as Artifact;
}

function fingerprint(artifact: Artifact): { bytecodeSha256: string; abiSha256: string } {
  const bytecode = artifact.bytecode ?? "";
  if (!bytecode || bytecode === "0x") throw new Error("empty creation bytecode");
  const compiler = artifact.metadata ? (JSON.parse(artifact.metadata) as { compiler?: { version?: string } }).compiler?.version : "";
  if (compiler && !compiler.startsWith(COMPILER)) {
    throw new Error(`compiler ${compiler} does not match snapshot compiler ${COMPILER}`);
  }
  return {
    bytecodeSha256: createHash("sha256").update(bytecode).digest("hex"),
    abiSha256: createHash("sha256").update(JSON.stringify(artifact.abi ?? [])).digest("hex"),
  };
}

describe("identity bytecode snapshots", function () {
  it("matches the frozen creation bytecode and ABI", function () {
    const current = {
      compiler: COMPILER,
      contracts: Object.fromEntries(CONTRACTS.map((name) => [name, fingerprint(artifactFor(name))])),
    };
    if (!existsSync(SNAPSHOT_PATH)) {
      throw new Error(`${SNAPSHOT_PATH} is missing. Write ${JSON.stringify(current)} and commit it.`);
    }
    const saved = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as typeof current;
    expect(saved.compiler).to.equal(COMPILER);
    expect(saved.contracts).to.deep.equal(current.contracts);
  });
});
