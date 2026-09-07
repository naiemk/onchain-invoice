import { KEY_EOA, KEY_WEBAUTHN, KEY_YUBIKEY } from "../../../commerce/shared/advanced-wallet.js";
import type { WalletEntityKeyRecord } from "../../../commerce/shared/wallet.js";
import { credentialIdsMatch } from "./credential-id.js";
import { connectEoaWallet, getConnectedEoaAddress } from "./eoa-connector.js";
import { listWalletEntities } from "./wallet-advanced-api.js";
import { healWalletSession } from "./wallet-session-heal.js";
import type { WalletSession } from "./wallet-session.js";
import type { AdvancedKeyType } from "./advanced-userop-client.js";

export function asAdvancedKeyType(keyType: number): AdvancedKeyType {
  if (keyType === KEY_YUBIKEY) return KEY_YUBIKEY;
  if (keyType === KEY_EOA) return KEY_EOA;
  return KEY_WEBAUTHN;
}

/** Match this browser's session to an on-chain entity key used for UserOp signatures. */
export async function resolveSessionSigningKey(
  session: WalletSession,
  options?: { connectEoa?: boolean }
): Promise<{ session: WalletSession; key: WalletEntityKeyRecord } | null> {
  const healed = await healWalletSession(session);
  const sess = healed.session;
  const roster = await listWalletEntities(sess.address).catch(() => ({ entities: [], keys: [] as WalletEntityKeyRecord[] }));
  let key =
    (sess.keyId ? roster.keys.find((k) => k.keyId.toLowerCase() === sess.keyId!.toLowerCase()) : null) ??
    roster.keys.find((k) => Boolean(k.qx) && k.qx === sess.qx && k.qy === sess.qy) ??
    roster.keys.find((k) => k.credentialId && credentialIdsMatch(k.credentialId, sess.credentialId)) ??
    null;
  if (!key && options?.connectEoa !== false) {
    let connected = await getConnectedEoaAddress();
    if (!connected) connected = await connectEoaWallet().catch(() => null);
    if (connected) {
      key =
        roster.keys.find((k) => k.keyType === KEY_EOA && k.eoa?.toLowerCase() === connected.toLowerCase()) ?? null;
    }
  }
  if (!key) return null;
  return { session: sess, key };
}
