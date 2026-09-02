import { deriveWalletSalt, predictWalletAddress } from "./wallet-address.js";

export type RecoverOwnerCoords = { qx: string; qy: string };

export type RecoverOwnerMatch = {
  ok: true;
  qx: string;
  qy: string;
  salt: string;
  create2Matched: boolean;
};

export type RecoverOwnerMiss = {
  ok: false;
  error: "owner_coordinates_required" | "passkey_owner_mismatch";
  reason?: "invalid_signature" | "create2_mismatch" | "not_onchain_owner";
};

export function sameRecoverOwner(a: RecoverOwnerCoords, b: RecoverOwnerCoords): boolean {
  return a.qx.toLowerCase() === b.qx.toLowerCase() && a.qy.toLowerCase() === b.qy.toLowerCase();
}

/**
 * Choose the passkey owner that may restore a server wallet record.
 *
 * Deployed wallets: WebAuthn + on-chain owner is enough. CREATE2 against the
 * current factory/implementation is not required (older factory generations
 * and post-recovery owners do not re-derive the clone address).
 *
 * Undeployed wallets: the passkey must be the current CREATE2 owner.
 */
export function matchRecoveredWalletOwner(input: {
  walletAddress: string;
  factoryAddress: string;
  implementationAddress: string;
  candidates: RecoverOwnerCoords[];
  onChainOwners: RecoverOwnerCoords[];
  verify: (owner: RecoverOwnerCoords) => boolean;
}): RecoverOwnerMatch | RecoverOwnerMiss {
  if (input.candidates.length === 0) {
    return { ok: false, error: "owner_coordinates_required" };
  }

  const wallet = input.walletAddress.toLowerCase();
  const deployed = input.onChainOwners.length > 0;
  let sawValidSig = false;
  let sawCreate2Fail = false;
  let sawNotOnChain = false;

  for (const candidate of input.candidates) {
    if (!input.verify(candidate)) continue;
    sawValidSig = true;

    if (deployed && !input.onChainOwners.some((owner) => sameRecoverOwner(owner, candidate))) {
      sawNotOnChain = true;
      continue;
    }

    const salt = deriveWalletSalt(candidate.qx, candidate.qy);
    const predicted = predictWalletAddress(
      input.factoryAddress,
      input.implementationAddress,
      salt
    );
    const create2Matched = predicted.toLowerCase() === wallet;
    if (!deployed && !create2Matched) {
      sawCreate2Fail = true;
      continue;
    }

    return {
      ok: true,
      qx: candidate.qx,
      qy: candidate.qy,
      salt,
      create2Matched,
    };
  }

  let reason: RecoverOwnerMiss["reason"] = "invalid_signature";
  if (sawValidSig && sawCreate2Fail) reason = "create2_mismatch";
  else if (sawValidSig && sawNotOnChain) reason = "not_onchain_owner";
  return { ok: false, error: "passkey_owner_mismatch", reason };
}
