import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { resolveAdvancedPolicy, type AdvancedPolicy } from "@/shared/wallet-advanced-api.js";
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

export function WalletPolicyProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState(() => loadWalletSession()?.address ?? null);
  const [policy, setPolicy] = useState<AdvancedPolicy | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const sync = () => setAddress(loadWalletSession()?.address ?? null);
    window.addEventListener(WALLET_SESSION_EVENT, sync);
    return () => window.removeEventListener(WALLET_SESSION_EVENT, sync);
  }, []);

  const refreshPolicy = useCallback(async () => {
    const sess = loadWalletSession();
    if (!sess) {
      setPolicy(null);
      return;
    }
    setLoading(true);
    try {
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
