import { useEffect, useState } from "react";
import { Contract, JsonRpcProvider } from "ethers";
import { identityMayReceiveFunds } from "../../../commerce/shared/identity-fundable.js";
import { apiUrl } from "./site.js";

const GET_IDENTITY =
  "function getIdentity(bytes32 identityId) view returns (bool exists, bool restoreEnabled, uint8 methodCount, uint8 eoaCount, uint8 webauthnCount, uint8 yubikeyCount)";

export async function readIdentityMethodCount(identityId: string): Promise<number | null> {
  const res = await fetch(apiUrl("/api/public/wallet-config"));
  if (!res.ok) return null;
  const cfg = (await res.json()) as { rpcUrl?: string | null; identityStoreAddress?: string | null };
  if (!cfg.rpcUrl || !cfg.identityStoreAddress) return null;
  const provider = new JsonRpcProvider(cfg.rpcUrl);
  try {
    const store = new Contract(cfg.identityStoreAddress, [GET_IDENTITY], provider);
    const rec = (await store.getIdentity(identityId)) as { exists?: boolean; methodCount?: bigint | number };
    if (!rec.exists) return 0;
    return Number(rec.methodCount ?? 0);
  } finally {
    provider.destroy();
  }
}

/** null while the chain read is in flight. Non-identity sessions are fundable. */
export function useIdentityFundable(identityId: string | undefined): boolean | null {
  const [fundable, setFundable] = useState<boolean | null>(identityId ? null : true);
  useEffect(() => {
    if (!identityId) {
      setFundable(true);
      return;
    }
    let cancelled = false;
    setFundable(null);
    void readIdentityMethodCount(identityId)
      .then((count) => {
        if (cancelled) return;
        setFundable(count !== null && identityMayReceiveFunds(count));
      })
      .catch(() => {
        if (!cancelled) setFundable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [identityId]);
  return fundable;
}
