import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { InterfaceAbi } from "ethers";

export type ContractArtifact = {
  abi: InterfaceAbi;
  bytecode: string;
};

export async function readArtifact(pathFromArtifacts: string): Promise<ContractArtifact> {
  const artifactPath = join(process.cwd(), "artifacts", pathFromArtifacts);
  const artifact = JSON.parse(await readFile(artifactPath, "utf8")) as ContractArtifact;
  if (!artifact.abi || !artifact.bytecode) throw new Error(`Invalid artifact at ${artifactPath}`);
  return artifact;
}
