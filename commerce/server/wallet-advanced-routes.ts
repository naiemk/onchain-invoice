import { Contract, JsonRpcProvider, getAddress, isAddress } from "ethers";
import type { AppConfig } from "./config.js";
import type { CommerceDb } from "./db.js";
import {
  ENTRYPOINT_ABI,
  buildFeeTransferCall,
  buildPackedUserOperation,
  encodeExecuteCallData,
  userOpToTuple,
} from "../shared/userop.js";
import { encodeAdvancedSignature } from "../shared/advanced-wallet.js";

const WALLET_POLICY_ABI = [
  "function advanced() view returns (bool)",
  "function threshold() view returns (uint8)",
  "function entityCount() view returns (uint8)",
  "function vetoCount() view returns (uint8)",
  "function vetoBitmap() view returns (uint256)",
];

export function registerWalletAdvancedRoutes(
  db: CommerceDb,
  appConfig: AppConfig,
  handlers: {
    sendJson: (res: import("node:http").ServerResponse, code: number, body: unknown) => void;
    readJson: (req: import("node:http").IncomingMessage) => Promise<Record<string, unknown>>;
  }
) {
  return async function handleWalletAdvancedRoute(
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
    url: URL
  ): Promise<boolean> {
    const policyMatch = url.pathname.match(
      /^\/api\/wallet\/(0x[0-9a-fA-F]{40})\/advanced-policy$/
    );
    if (req.method === "GET" && policyMatch) {
      await getAdvancedPolicy(res, policyMatch[1], appConfig, handlers);
      return true;
    }

    const entitiesMatch = url.pathname.match(/^\/api\/wallet\/(0x[0-9a-fA-F]{40})\/entities$/);
    if (entitiesMatch) {
      const wallet = getAddress(entitiesMatch[1]);
      if (req.method === "GET") {
        handlers.sendJson(res, 200, {
          entities: db.listWalletEntities(wallet),
          keys: db.listWalletEntityKeys(wallet),
        });
        return true;
      }
      if (req.method === "POST") {
        const body = await handlers.readJson(req);
        const entityId = String(body.entityId ?? "").trim();
        if (!entityId.startsWith("0x") || entityId.length !== 66) {
          handlers.sendJson(res, 400, { error: "invalid_entity_id" });
          return true;
        }
        const entity = db.upsertWalletEntity({
          walletAddress: wallet,
          entityId,
          label: body.label != null ? String(body.label) : null,
        });
        handlers.sendJson(res, 200, { entity });
        return true;
      }
    }

    const entityKeysMatch = url.pathname.match(
      /^\/api\/wallet\/(0x[0-9a-fA-F]{40})\/entities\/(0x[0-9a-fA-F]{64})\/keys$/
    );
    if (req.method === "POST" && entityKeysMatch) {
      const wallet = getAddress(entityKeysMatch[1]);
      const entityId = entityKeysMatch[2];
      const body = await handlers.readJson(req);
      const keyId = String(body.keyId ?? "").trim();
      const keyType = Number(body.keyType ?? -1);
      if (!keyId.startsWith("0x") || keyId.length !== 66 || keyType < 0 || keyType > 2) {
        handlers.sendJson(res, 400, { error: "invalid_key" });
        return true;
      }
      const key = db.upsertWalletEntityKey({
        walletAddress: wallet,
        entityId,
        keyId,
        keyType,
        qx: body.qx != null ? String(body.qx) : null,
        qy: body.qy != null ? String(body.qy) : null,
        eoa: body.eoa != null ? String(body.eoa) : null,
        credentialId: body.credentialId != null ? String(body.credentialId) : null,
      });
      handlers.sendJson(res, 200, { key });
      return true;
    }

    const proposalsMatch = url.pathname.match(/^\/api\/wallet\/(0x[0-9a-fA-F]{40})\/proposals$/);
    if (proposalsMatch) {
      const wallet = getAddress(proposalsMatch[1]);
      if (req.method === "GET") {
        const status = url.searchParams.get("status") ?? undefined;
        handlers.sendJson(res, 200, {
          proposals: db.listWalletProposals(wallet, status as never),
        });
        return true;
      }
      if (req.method === "POST") {
        const body = await handlers.readJson(req);
        const target = String(body.target ?? "").trim();
        const value = String(body.value ?? "0");
        const data = String(body.data ?? "0x");
        const chainId = String(body.chainId ?? appConfig.wallet.chainId);
        if (!isAddress(target)) {
          handlers.sendJson(res, 400, { error: "invalid_target" });
          return true;
        }
        const proposal = db.createWalletProposal({
          walletAddress: wallet,
          chainId,
          target,
          value,
          data,
        });
        handlers.sendJson(res, 201, { proposal });
        return true;
      }
    }

    const proposalActionMatch = url.pathname.match(
      /^\/api\/wallet\/(0x[0-9a-fA-F]{40})\/proposals\/([0-9a-f-]{36})(?:\/(prepare|sign|execute))?$/
    );
    if (proposalActionMatch) {
      const wallet = getAddress(proposalActionMatch[1]);
      const proposalId = proposalActionMatch[2];
      const action = proposalActionMatch[3];
      const proposal = db.getWalletProposal(proposalId);
      if (!proposal || proposal.walletAddress.toLowerCase() !== wallet.toLowerCase()) {
        handlers.sendJson(res, 404, { error: "proposal_not_found" });
        return true;
      }

      if (req.method === "GET" && !action) {
        handlers.sendJson(res, 200, {
          proposal,
          signatures: db.listWalletProposalSigs(proposalId),
        });
        return true;
      }

      if (action === "prepare" && req.method === "POST") {
        const chain = appConfig.wallet.chains.find((c) => c.chainId === proposal.chainId) ?? appConfig.wallet;
        if (!chain.rpcUrl) {
          handlers.sendJson(res, 503, { error: "rpc_unavailable" });
          return true;
        }
        const provider = new JsonRpcProvider(chain.rpcUrl);
        const entryPoint = new Contract(appConfig.wallet.entryPointAddress, ENTRYPOINT_ABI, provider);
        const nonce = (await entryPoint.getNonce(wallet, 0)).toString();
        const prepared = db.prepareWalletProposal(proposalId, nonce);
        const userOpHash = await computeProposalUserOpHash({
          wallet,
          proposal: prepared!,
          appConfig,
          feeAmount: BigInt(appConfig.wallet.bundlerFeeUsdc),
        });
        handlers.sendJson(res, 200, { proposal: prepared, userOpHash });
        return true;
      }

      if (action === "sign" && req.method === "POST") {
        const body = await handlers.readJson(req);
        const entityId = String(body.entityId ?? "").trim();
        const keyId = String(body.keyId ?? "").trim();
        const keyType = Number(body.keyType ?? -1);
        const signature = String(body.signature ?? "").trim();
        if (!entityId || !keyId || !signature || keyType < 0) {
          handlers.sendJson(res, 400, { error: "invalid_signature" });
          return true;
        }
        const sig = db.addWalletProposalSig({
          proposalId,
          entityId,
          keyId,
          keyType,
          signature,
        });
        handlers.sendJson(res, 200, { signature: sig });
        return true;
      }

      if (action === "execute" && req.method === "POST") {
        const body = await handlers.readJson(req);
        const signatures = db.listWalletProposalSigs(proposalId);
        if (signatures.length === 0) {
          handlers.sendJson(res, 400, { error: "no_signatures" });
          return true;
        }
        let proposalRecord = proposal;
        if (!proposalRecord.nonce) {
          const chain = appConfig.wallet.chains.find((c) => c.chainId === proposal.chainId) ?? appConfig.wallet;
          if (!chain.rpcUrl) {
            handlers.sendJson(res, 503, { error: "rpc_unavailable" });
            return true;
          }
          const provider = new JsonRpcProvider(chain.rpcUrl);
          const entryPoint = new Contract(appConfig.wallet.entryPointAddress, ENTRYPOINT_ABI, provider);
          const nonce = (await entryPoint.getNonce(wallet, 0)).toString();
          proposalRecord = db.prepareWalletProposal(proposalId, nonce)!;
        }
        const packedSig = encodeAdvancedSignature(
          signatures.map((s) => ({ keyId: s.keyId, sig: s.signature }))
        );
        const feeAmount = BigInt(appConfig.wallet.bundlerFeeUsdc);
        const userOp = await buildProposalUserOp({
          wallet,
          proposal: proposalRecord,
          appConfig,
          feeAmount,
          signature: body.signature != null ? String(body.signature) : packedSig,
        });
        const chain = appConfig.wallet.chains.find((c) => c.chainId === proposal.chainId) ?? appConfig.wallet;
        const provider = new JsonRpcProvider(chain.rpcUrl!);
        const entryPoint = new Contract(appConfig.wallet.entryPointAddress, ENTRYPOINT_ABI, provider);
        const userOpHash = await entryPoint.getUserOpHash(userOpToTuple(userOp));
        const record = db.createWalletUserOp({
          walletAddress: wallet,
          chainId: proposal.chainId,
          userOpHash,
          userOp,
        });
        db.updateWalletProposalStatus(proposalId, "executed");
        handlers.sendJson(res, 200, { userOpHash, userOp: record });
        return true;
      }
    }

    const enrollmentMatch = url.pathname.match(
      /^\/api\/wallet\/(0x[0-9a-fA-F]{40})\/key-enrollment-requests(?:\/([0-9a-f-]{36})(?:\/(approve|reject))?)?$/
    );
    if (enrollmentMatch) {
      const wallet = getAddress(enrollmentMatch[1]);
      const requestId = enrollmentMatch[2];
      const action = enrollmentMatch[3];

      if (req.method === "POST" && !requestId) {
        const body = await handlers.readJson(req);
        const entityId = String(body.entityId ?? "").trim();
        const keyType = Number(body.keyType ?? -1);
        if (!entityId.startsWith("0x") || entityId.length !== 66 || keyType < 0 || keyType > 2) {
          handlers.sendJson(res, 400, { error: "invalid_enrollment" });
          return true;
        }
        if (!db.getWalletEntity(wallet, entityId)) {
          handlers.sendJson(res, 404, { error: "entity_not_found" });
          return true;
        }
        const request = db.createWalletKeyEnrollmentRequest({
          walletAddress: wallet,
          entityId,
          keyType,
          qx: body.qx != null ? String(body.qx) : null,
          qy: body.qy != null ? String(body.qy) : null,
          eoa: body.eoa != null ? String(body.eoa) : null,
          credentialId: body.credentialId != null ? String(body.credentialId) : null,
          label: body.label != null ? String(body.label) : null,
        });
        handlers.sendJson(res, 201, { request });
        return true;
      }

      if (req.method === "GET" && !requestId) {
        const status = url.searchParams.get("status") as import("../shared/wallet.js").WalletKeyEnrollmentStatus | null;
        const requests = db.listWalletKeyEnrollmentRequests(
          wallet,
          status && ["pending", "approved", "rejected", "expired"].includes(status) ? status : undefined
        );
        handlers.sendJson(res, 200, { requests });
        return true;
      }

      if (requestId) {
        const request = db.getWalletKeyEnrollmentRequest(requestId);
        if (!request || request.walletAddress.toLowerCase() !== wallet.toLowerCase()) {
          handlers.sendJson(res, 404, { error: "request_not_found" });
          return true;
        }

        if (req.method === "GET" && !action) {
          handlers.sendJson(res, 200, { request });
          return true;
        }

        if (req.method === "POST" && action === "reject") {
          const updated = db.resolveWalletKeyEnrollmentRequest(requestId, "rejected");
          handlers.sendJson(res, 200, { request: updated });
          return true;
        }

        if (req.method === "POST" && action === "approve") {
          const updated = db.resolveWalletKeyEnrollmentRequest(requestId, "approved");
          handlers.sendJson(res, 200, { request: updated });
          return true;
        }
      }
    }

    return false;
  };
}

async function getAdvancedPolicy(
  res: import("node:http").ServerResponse,
  walletRaw: string,
  appConfig: AppConfig,
  handlers: { sendJson: (res: import("node:http").ServerResponse, code: number, body: unknown) => void }
): Promise<void> {
  const wallet = getAddress(walletRaw);
  const chain = appConfig.wallet;
  if (!chain.rpcUrl) {
    handlers.sendJson(res, 503, { error: "rpc_unavailable" });
    return;
  }
  const provider = new JsonRpcProvider(chain.rpcUrl);
  const contract = new Contract(wallet, WALLET_POLICY_ABI, provider);
  try {
    const [advanced, threshold, entityCount, vetoCount, vetoBitmap] = await Promise.all([
      contract.advanced(),
      contract.threshold(),
      contract.entityCount(),
      contract.vetoCount(),
      contract.vetoBitmap(),
    ]);
    handlers.sendJson(res, 200, {
      wallet,
      advanced: Boolean(advanced),
      threshold: Number(threshold),
      entityCount: Number(entityCount),
      vetoCount: Number(vetoCount),
      vetoBitmap: vetoBitmap.toString(),
    });
  } catch (error) {
    handlers.sendJson(res, 400, {
      error: "policy_read_failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function computeProposalUserOpHash(input: {
  wallet: string;
  proposal: { target: string; value: string; data: string; nonce: string | null; chainId?: string };
  appConfig: AppConfig;
  feeAmount: bigint;
}): Promise<string> {
  const userOp = await buildProposalUserOp({
    ...input,
    signature: "0x",
  });
  const chainId = input.proposal.chainId ?? input.appConfig.wallet.chainId;
  const chain = input.appConfig.wallet.chains.find((c) => c.chainId === chainId) ?? input.appConfig.wallet;
  const provider = new JsonRpcProvider(chain.rpcUrl!);
  const entryPoint = new Contract(input.appConfig.wallet.entryPointAddress, ENTRYPOINT_ABI, provider);
  return entryPoint.getUserOpHash(userOpToTuple(userOp));
}

async function buildProposalUserOp(input: {
  wallet: string;
  proposal: {
    target: string;
    value: string;
    data: string;
    nonce: string | null;
    chainId?: string;
  };
  appConfig: AppConfig;
  feeAmount: bigint;
  signature: string;
}) {
  const chainId = input.proposal.chainId ?? input.appConfig.wallet.chainId;
  const chain =
    input.appConfig.wallet.chains.find((c) => c.chainId === chainId) ?? input.appConfig.wallet;
  if (!chain.feeTokenAddress || !input.appConfig.wallet.bundlerBeneficiary) {
    throw new Error("Bundler fee not configured");
  }
  const calls = [
    buildFeeTransferCall(chain.feeTokenAddress, input.appConfig.wallet.bundlerBeneficiary, input.feeAmount),
    {
      target: getAddress(input.proposal.target),
      value: BigInt(input.proposal.value),
      data: input.proposal.data,
    },
  ];
  const callData = encodeExecuteCallData(calls);
  return buildPackedUserOperation({
    sender: input.wallet,
    nonce: BigInt(input.proposal.nonce ?? "0"),
    callData,
    signature: input.signature,
  });
}
