import { KEY_EOA, KEY_WEBAUTHN, KEY_YUBIKEY } from "../../../commerce/shared/advanced-wallet.js";
import type { WalletEntityKeyRecord } from "../../../commerce/shared/wallet.js";
import { connectEoaWallet, getConnectedEoaAddress } from "./eoa-connector.js";
import { listWalletEntities } from "./wallet-advanced-api.js";
import {
  passkeyToEntityKey,
  persistCurrentWalletPasskey,
  resolveCurrentWalletPasskey,
  type CurrentWalletPasskey,
} from "./current-wallet-passkey.js";
import type { WalletSession } from "./wallet-session.js";
import type { AdvancedKeyType } from "./advanced-userop-client.js";

export function asAdvancedKeyType(keyType: number): AdvancedKeyType {
  if (keyType === KEY_YUBIKEY) return KEY_YUBIKEY;
  if (keyType === KEY_EOA) return KEY_EOA;
  return KEY_WEBAUTHN;
}

export type ResolvedSigningKey = {
  session: WalletSession;
  key: WalletEntityKeyRecord;
  passkey?: CurrentWalletPasskey;
};

function sessionLooksLikeEoa(session: WalletSession): boolean {
  return session.keyType === KEY_EOA && !session.credentialId?.trim();
}

/** Match this browser's session to an on-chain entity key used for UserOp signatures. */
export async function resolveSessionSigningKey(
  session: WalletSession,
  options?: { connectEoa?: boolean }
): Promise<ResolvedSigningKey | null> {
  const allowEoaPrompt = options?.connectEoa === true || sessionLooksLikeEoa(session);

  if (!sessionLooksLikeEoa(session)) {
    try {
      const passkey = await resolveCurrentWalletPasskey(session, "unknown");
      if (passkey.keyType !== KEY_EOA) {
        const next = persistCurrentWalletPasskey(passkey, session);
        return { session: next, key: passkeyToEntityKey(passkey), passkey };
      }
    } catch (error) {
      if (!allowEoaPrompt) throw error;
    }
  }

  const roster = await listWalletEntities(session.address).catch(() => ({
    entities: [],
    keys: [] as WalletEntityKeyRecord[],
  }));
  let connected = await getConnectedEoaAddress();
  if (!connected && allowEoaPrompt) {
    connected = await connectEoaWallet().catch(() => null);
  }
  if (!connected) return null;
  const key =
    roster.keys.find((k) => k.keyType === KEY_EOA && k.eoa?.toLowerCase() === connected.toLowerCase()) ?? null;
  if (!key) return null;
  return { session, key };
}
