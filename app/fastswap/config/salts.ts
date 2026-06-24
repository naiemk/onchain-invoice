import { keccak256, toUtf8Bytes } from "ethers";

export const DEPLOY_SALT_CONTRACTS = [
  "fastSwapImplementation",
  "fastSwapProxy",
  "invoiceSweeper",
  "liquidityManagerImplementation",
  "liquidityManagerProxy",
] as const;

export type DeploySaltContract = (typeof DEPLOY_SALT_CONTRACTS)[number];

export type DeploySaltSpec = {
  namespace: string;
  version: string;
};

export type ResolvedDeploySalts = Record<DeploySaltContract, string>;

/** Hash `namespace/version/contract` to a CREATE2 bytes32 salt. */
export function hashDeploySalt(namespace: string, version: string, contract: DeploySaltContract): string {
  const label = `${namespace}/${version}/${contract}`;
  return keccak256(toUtf8Bytes(label));
}

export function resolveDeploySalts(input: DeploySaltSpec | ResolvedDeploySalts): ResolvedDeploySalts {
  if (isDeploySaltSpec(input)) {
    const resolved = {} as ResolvedDeploySalts;
    for (const contract of DEPLOY_SALT_CONTRACTS) {
      resolved[contract] = hashDeploySalt(input.namespace, input.version, contract);
    }
    return resolved;
  }
  assertResolvedDeploySalts(input);
  return input;
}

export function isDeploySaltSpec(value: unknown): value is DeploySaltSpec {
  return (
    typeof value === "object" &&
    value !== null &&
    "namespace" in value &&
    "version" in value &&
    typeof (value as DeploySaltSpec).namespace === "string" &&
    typeof (value as DeploySaltSpec).version === "string"
  );
}

function assertResolvedDeploySalts(value: ResolvedDeploySalts): void {
  for (const key of DEPLOY_SALT_CONTRACTS) {
    const salt = value[key];
    if (typeof salt !== "string" || !salt.startsWith("0x") || salt.length !== 66) {
      throw new Error(`Invalid legacy deploy salt for ${key}`);
    }
  }
}
