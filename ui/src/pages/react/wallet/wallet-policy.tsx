import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Contract, JsonRpcProvider } from "ethers";
import { resolveAdvancedPolicy, type AdvancedPolicy } from "@/shared/wallet-advanced-api.js";
import { fetchWalletConfig, primaryChain } from "@/shared/wallet-api.js";
import { loadWalletSession, WALLET_SESSION_EVENT } from "@/shared/wallet-session.js";

type WalletPolicyValue = {
  policy: AdvancedPolicy | null;
  isSuperWallet: boolean;
  loading: boolean;
  refreshPolicy: () => Promise<void>;
};

const WalletPolicyContext = createContext<WalletPolicyValue>({
  policy: null,
  isSuperWallet: false,
  loading: false,
  refreshPolicy: async () => undefined,
});

const IDENTITY_SUPER_ABI = [
  "function superWallet() view returns (bool)",
  "function threshold() view returns (uint8)",
  "function signerCount() view returns (uint8)",
];

export function WalletPolicyProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState(() => loadWalletSession()?.address ?? null);
  const [policy, setPolicy] = useState<AdvancedPolicy | null>(null);
  const [loading, setLoading] = useState(() => Boolean(loadWalletSession()));

  useEffect(() => {
    const sync = () => setAddress(loadWalletSession()?.address ?? null);
    window.addEventListener(WALLET_SESSION_EVENT, sync);
    return () => window.removeEventListener(WALLET_SESSION_EVENT, sync);
  }, []);

  const refreshPolicy = useCallback(async () => {
    const sess = loadWalletSession();
    if (!sess) {
      setPolicy(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      if (sess.identityId) {
        const cfg = await fetchWalletConfig();
        const chain = primaryChain(cfg);
        if (!chain.rpcUrl) {
          setPolicy({
            wallet: sess.address,
            advanced: false,
            supportsAdvanced: true,
            threshold: 1,
            entityCount: 0,
            vetoCount: 0,
            vetoBitmap: "0",
          });
          return;
        }
        const provider = new JsonRpcProvider(chain.rpcUrl);
        const wallet = new Contract(sess.address, IDENTITY_SUPER_ABI, provider);
        try {
          const superWallet = Boolean(await wallet.superWallet());
          const threshold = Number(await wallet.threshold());
          const signerCount = Number(await wallet.signerCount());
          setPolicy({
            wallet: sess.address,
            advanced: superWallet,
            supportsAdvanced: true,
            threshold: superWallet ? threshold : 1,
            entityCount: superWallet ? signerCount : 0,
            vetoCount: 0,
            vetoBitmap: "0",
          });
        } catch {
          setPolicy({
            wallet: sess.address,
            advanced: false,
            supportsAdvanced: true,
            threshold: 1,
            entityCount: 0,
            vetoCount: 0,
            vetoBitmap: "0",
          });
        }
        return;
      }
      setPolicy(await resolveAdvancedPolicy(sess.address, true));
    } catch {
      setPolicy(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshPolicy();
  }, [address, refreshPolicy]);

  const value = useMemo<WalletPolicyValue>(
    () => ({
      policy,
      isSuperWallet: Boolean(policy?.advanced),
      loading,
      refreshPolicy,
    }),
    [policy, loading, refreshPolicy]
  );

  return <WalletPolicyContext.Provider value={value}>{children}</WalletPolicyContext.Provider>;
}

export function useWalletPolicy(): WalletPolicyValue {
  return useContext(WalletPolicyContext);
}
