import { AbiCoder, Interface, getAddress, toBeHex } from "ethers";

/** OpenZeppelin ERC-4337 EntryPoint v0.9 */
export const ENTRYPOINT_V09 = "0x433709009B8330FDa32311DF1C2AFA402eD8D009";

/** ERC-7821 single batch mode (bytes32) */
export const ERC7821_BATCH_MODE = "0x0100000000000000000000000000000000000000000000000000000000000000";

export const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

export const WALLET_EXECUTE_ABI = [
  "function execute(bytes32 mode, bytes executionData)",
  "function addOwner(bytes32 qx, bytes32 qy)",
  "function removeOwner(bytes32 qx, bytes32 qy)",
  "function enableAdvanced(bytes32 adminEntityId)",
  "function configureMultisig(bytes32[] removeKeyIds, bytes32[] entityIds, bytes32[] entityIdsForKeys, uint8[] keyTypes, bytes32[] qx, bytes32[] qy, address[] eoa, uint8 threshold, bytes32[] vetoEntityIds)",
  "function addEntity(bytes32 entityId)",
  "function removeEntity(bytes32 entityId)",
  "function addKey(bytes32 entityId, uint8 keyType, bytes32 qx, bytes32 qy, address eoa)",
  "function removeKey(bytes32 keyId)",
  "function setThreshold(uint8 m)",
  "function setVeto(bytes32 entityId, bool isVeto)",
];

export const ENTRYPOINT_ABI = [
  "function getNonce(address sender, uint192 key) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function depositTo(address account) payable",
  "function getUserOpHash((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp) view returns (bytes32)",
  "function handleOps((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)[] ops, address payable beneficiary)",
];

export interface BatchCall {
  target: string;
  value: bigint;
  data: string;
}

/** JSON-serializable packed user operation (bigint fields as decimal strings). */
export interface PackedUserOperationJson {
  sender: string;
  nonce: string;
  initCode: string;
  callData: string;
  accountGasLimits: string;
  preVerificationGas: string;
  gasFees: string;
  paymasterAndData: string;
  signature: string;
}

export type UserOpStatus =
  | "pending"
  | "claimed"
  | "submitted"
  | "included"
  | "failed"
  | "rejected";

export interface WalletUserOpRecord {
  id: string;
  walletAddress: string;
  chainId: string;
  userOpHash: string;
  userOp: PackedUserOperationJson;
  status: UserOpStatus;
  claimedBy: string | null;
  claimedUntil: string | null;
  version: number;
  txHash: string | null;
  rejectReason: string | null;
  gasSpentWei: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BundlerFeeConfig {
  feeTokenAddress: string;
  feeTokenSymbol: string;
  feeTokenDecimals: number;
  bundlerBeneficiary: string;
  minFeeUsdc: bigint;
}

export const DEFAULT_GAS = {
  verificationGasLimit: 500_000n,
  callGasLimit: 350_000n,
  preVerificationGas: 50_000n,
  maxFeePerGas: 1_000_000_000n,
  maxPriorityFeePerGas: 1_000_000_000n,
} as const;

const erc20Iface = new Interface(ERC20_ABI);
const walletIface = new Interface(WALLET_EXECUTE_ABI);
const coder = AbiCoder.defaultAbiCoder();

export function packUint128Pair(high: bigint, low: bigint): string {
  const mask = (1n << 128n) - 1n;
  const packed = ((high & mask) << 128n) | (low & mask);
  return toBeHex(packed, 32);
}

export function unpackUint128Pair(packed: string): { high: bigint; low: bigint } {
  const value = BigInt(packed);
  const mask = (1n << 128n) - 1n;
  return { high: value >> 128n, low: value & mask };
}

/**
 * Rough EntryPoint requiredPrefund for a packed userOp with no paymaster.
 * Bundler tops up EntryPoint.depositTo(sender) so gasless USDC wallets can send.
 */
export function estimateUserOpPrefund(userOp: PackedUserOperationJson): bigint {
  const { high: verificationGasLimit, low: callGasLimit } = unpackUint128Pair(userOp.accountGasLimits);
  const { low: maxFeePerGas } = unpackUint128Pair(userOp.gasFees);
  const preVerificationGas = BigInt(userOp.preVerificationGas);
  return (verificationGasLimit + callGasLimit + preVerificationGas) * maxFeePerGas;
}

export function encodeErc20Transfer(to: string, amount: bigint): string {
  return erc20Iface.encodeFunctionData("transfer", [getAddress(to), amount]);
}

export function encodeAddOwner(qx: string, qy: string): string {
  return walletIface.encodeFunctionData("addOwner", [qx, qy]);
}

export function encodeRemoveOwner(qx: string, qy: string): string {
  return walletIface.encodeFunctionData("removeOwner", [qx, qy]);
}

export function encodeEnableAdvanced(adminEntityId: string): string {
  return walletIface.encodeFunctionData("enableAdvanced", [adminEntityId]);
}

export function encodeAddEntity(entityId: string): string {
  return walletIface.encodeFunctionData("addEntity", [entityId]);
}

export function encodeAddKey(
  entityId: string,
  keyType: number,
  qx: string,
  qy: string,
  eoa: string
): string {
  return walletIface.encodeFunctionData("addKey", [entityId, keyType, qx, qy, eoa]);
}

export function encodeSetThreshold(m: number): string {
  return walletIface.encodeFunctionData("setThreshold", [m]);
}

export function encodeConfigureMultisig(input: {
  removeKeyIds: string[];
  entityIds: string[];
  entityIdsForKeys: string[];
  keyTypes: number[];
  qx: string[];
  qy: string[];
  eoa: string[];
  threshold: number;
  vetoEntityIds: string[];
}): string {
  return walletIface.encodeFunctionData("configureMultisig", [
    input.removeKeyIds,
    input.entityIds,
    input.entityIdsForKeys,
    input.keyTypes,
    input.qx,
    input.qy,
    input.eoa,
    input.threshold,
    input.vetoEntityIds,
  ]);
}

/** ABI-encode Execution[] batch per ERC-7579 / ERC-7821. */
export function encodeBatch(calls: BatchCall[]): string {
  const tuples = calls.map((c) => [getAddress(c.target), c.value, c.data]);
  return coder.encode(["tuple(address target, uint256 value, bytes data)[]"], [tuples]);
}

export function encodeExecuteCallData(calls: BatchCall[]): string {
  return walletIface.encodeFunctionData("execute", [ERC7821_BATCH_MODE, encodeBatch(calls)]);
}

export function buildFeeTransferCall(feeToken: string, beneficiary: string, feeAmount: bigint): BatchCall {
  return {
    target: getAddress(feeToken),
    value: 0n,
    data: encodeErc20Transfer(beneficiary, feeAmount),
  };
}

export function buildSendBatchCalls(input: {
  feeToken: string;
  beneficiary: string;
  feeAmount: bigint;
  recipient: string;
  sendAmount: bigint;
  /** ERC-20 to transfer to recipient; defaults to feeToken (USDC send). */
  sendToken?: string;
}): BatchCall[] {
  const sendToken = input.sendToken ?? input.feeToken;
  return [
    buildFeeTransferCall(input.feeToken, input.beneficiary, input.feeAmount),
    {
      target: getAddress(sendToken),
      value: 0n,
      data: encodeErc20Transfer(input.recipient, input.sendAmount),
    },
  ];
}

export function buildAddOwnerBatchCalls(input: {
  feeToken: string;
  beneficiary: string;
  feeAmount: bigint;
  wallet: string;
  qx: string;
  qy: string;
}): BatchCall[] {
  return [
    buildFeeTransferCall(input.feeToken, input.beneficiary, input.feeAmount),
    {
      target: getAddress(input.wallet),
      value: 0n,
      data: encodeAddOwner(input.qx, input.qy),
    },
  ];
}

export function buildRemoveOwnerBatchCalls(input: {
  feeToken: string;
  beneficiary: string;
  feeAmount: bigint;
  wallet: string;
  qx: string;
  qy: string;
}): BatchCall[] {
  return [
    buildFeeTransferCall(input.feeToken, input.beneficiary, input.feeAmount),
    {
      target: getAddress(input.wallet),
      value: 0n,
      data: encodeRemoveOwner(input.qx, input.qy),
    },
  ];
}

export function buildPackedUserOperation(input: {
  sender: string;
  nonce: bigint;
  callData: string;
  signature?: string;
  gas?: Partial<typeof DEFAULT_GAS>;
}): PackedUserOperationJson {
  const g = { ...DEFAULT_GAS, ...input.gas };
  return {
    sender: getAddress(input.sender),
    nonce: input.nonce.toString(),
    initCode: "0x",
    callData: input.callData,
    accountGasLimits: packUint128Pair(g.verificationGasLimit, g.callGasLimit),
    preVerificationGas: g.preVerificationGas.toString(),
    gasFees: packUint128Pair(g.maxPriorityFeePerGas, g.maxFeePerGas),
    paymasterAndData: "0x",
    signature: input.signature ?? "0x",
  };
}

export function userOpToTuple(userOp: PackedUserOperationJson): [
  string,
  bigint,
  string,
  string,
  string,
  bigint,
  string,
  string,
  string,
] {
  return [
    getAddress(userOp.sender),
    BigInt(userOp.nonce),
    userOp.initCode,
    userOp.callData,
    userOp.accountGasLimits,
    BigInt(userOp.preVerificationGas),
    userOp.gasFees,
    userOp.paymasterAndData,
    userOp.signature,
  ];
}

export function formatUsdcAmount(atoms: bigint, decimals = 6): string {
  const base = 10n ** BigInt(decimals);
  const whole = atoms / base;
  const frac = atoms % base;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr.length ? `${whole}.${fracStr}` : whole.toString();
}

export function formatUsdFromUsdc(atoms: bigint, decimals = 6): string {
  return `$${formatUsdcAmount(atoms, decimals)}`;
}

export function parseUsdcInput(value: string, decimals = 6): bigint | null {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > decimals) return null;
  const padded = frac.padEnd(decimals, "0");
  try {
    return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0");
  } catch {
    return null;
  }
}
