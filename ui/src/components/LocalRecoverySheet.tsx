import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useLocale } from "@/providers/LocaleProvider";
import { fetchWalletConfig, getWalletAccount } from "@/shared/wallet-api.js";
import {
  buildSupportRequestText,
  fetchRecoverInfo,
  pickRecoveryOwnerCoords,
  recoverWalletFromChain,
  type WalletRecoverInfo,
} from "@/shared/wallet-recover-local.js";
import { unlockRegistryWallet } from "@/shared/wallet-unlock.js";
import { saveWalletSession, shortAddress, type WalletSession } from "@/shared/wallet-session.js";
import { ensureSessionCredential, formatPasskeyError } from "@/shared/webauthn.js";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialEntry?: WalletSession | null;
  onRecovered: () => void;
};

function isLocalRecoveryError(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error) {
    return (error as { code?: string }).code === "local_recovery";
  }
  return false;
}

export function isUnlockRecoveryError(error: unknown): boolean {
  if (isLocalRecoveryError(error)) return true;
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: string }).code;
    return code === "wrong_wallet" || code === "passkey_missing";
  }
  return false;
}

export function LocalRecoverySheet({ open, onOpenChange, initialEntry, onRecovered }: Props) {
  const { t } = useLocale();
  const [address, setAddress] = useState(initialEntry?.address ?? "");
  const [chainId, setChainId] = useState(initialEntry?.chainId ?? "11155111");
  const [chains, setChains] = useState<{ chainId: string; networkLabel: string }[]>([]);
  const [info, setInfo] = useState<WalletRecoverInfo | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [supportText, setSupportText] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAddress(initialEntry?.address ?? "");
    setChainId(initialEntry?.chainId ?? "11155111");
    setInfo(null);
    setStatus(null);
    setSupportText(null);
    void fetchWalletConfig().then((cfg) => {
      setChains(cfg.chains.map((c) => ({ chainId: c.chainId, networkLabel: c.networkLabel })));
      if (!initialEntry?.chainId && cfg.chainId) setChainId(cfg.chainId);
    });
  }, [open, initialEntry?.address, initialEntry?.chainId]);

  const lookup = useCallback(async () => {
    if (!address.trim()) {
      setStatus(t("wallet.localRecoveryNeedAddress"));
      return;
    }
    setBusy(true);
    setStatus(null);
    setSupportText(null);
    try {
      const row = await getWalletAccount(address.trim());
      if (row && initialEntry) {
        setStatus(t("wallet.localRecoveryDbFound"));
        setInfo({
          wallet: address.toLowerCase(),
          chainId,
          inDb: true,
          deployed: row.deployedChains.includes(chainId),
          ownersOnChain: [],
          balanceUsd: "0",
          hasFunds: false,
          account: {
            address: row.address,
            ownerQx: row.ownerQx,
            ownerQy: row.ownerQy,
            deployedChains: row.deployedChains,
          },
        });
        return;
      }
      const recovered = await fetchRecoverInfo(address.trim(), chainId);
      setInfo(recovered);
      if (recovered.inDb) {
        setStatus(t("wallet.localRecoveryDbFound"));
      }
    } catch (error) {
      setStatus(formatPasskeyError(error));
    } finally {
      setBusy(false);
    }
  }, [address, chainId, initialEntry, t]);

  useEffect(() => {
    if (open && initialEntry?.address) void lookup();
  }, [open, initialEntry?.address, lookup]);

  const retryDbUnlock = async () => {
    if (!initialEntry) return;
    setBusy(true);
    setStatus(null);
    try {
      const prepared = await ensureSessionCredential(initialEntry);
      await unlockRegistryWallet(prepared);
      onRecovered();
      onOpenChange(false);
    } catch (error) {
      setStatus(formatPasskeyError(error));
    } finally {
      setBusy(false);
    }
  };

  const recoverFromChain = async () => {
    const entry = initialEntry;
    const { ownerQx, ownerQy, canRecoverFromChain } = pickRecoveryOwnerCoords({
      accountOwner: info?.account,
      registryEntry: entry,
      ownersOnChain: info?.ownersOnChain,
    });
    if (!canRecoverFromChain) {
      setStatus(t("wallet.localRecoveryNeedKeys"));
      return;
    }
    setBusy(true);
    setStatus(t("wallet.sendSigning"));
    try {
      const prepared = entry ? await ensureSessionCredential(entry) : null;
      const result = await recoverWalletFromChain({
        walletAddress: address.trim(),
        chainId,
        ownerQx,
        ownerQy,
        credentialId: prepared?.credentialId,
        label: entry?.label,
      });
      if (entry || result.credentialId) {
        saveWalletSession({
          ...(entry ?? {
            address: result.account.address,
            chainId,
            salt: result.account.salt,
            qx: result.account.ownerQx,
            qy: result.account.ownerQy,
            rawId: "",
            label: t("wallet.defaultDevice"),
          }),
          address: result.account.address,
          salt: result.account.salt,
          qx: result.account.ownerQx,
          qy: result.account.ownerQy,
          credentialId: result.credentialId || prepared?.credentialId || entry?.credentialId || "",
        });
      }
      onRecovered();
      onOpenChange(false);
    } catch (error) {
      setStatus(formatPasskeyError(error));
    } finally {
      setBusy(false);
    }
  };

  const showSupport = () => {
    const chainLabel = chains.find((c) => c.chainId === chainId)?.networkLabel;
    setSupportText(
      buildSupportRequestText({
        walletAddress: address.trim(),
        chainId,
        chainLabel,
        problem:
          "Passkey works on device but server has no wallet record; wallet not deployed on-chain.",
      })
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t("wallet.localRecoveryTitle")}</SheetTitle>
          <SheetDescription>{t("wallet.localRecoveryLede")}</SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="recovery-address">{t("wallet.recoverWalletLabel")}</Label>
            <Input
              id="recovery-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="0x…"
              className="font-mono"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="recovery-chain">{t("wallet.localRecoveryChain")}</Label>
            <select
              id="recovery-chain"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={chainId}
              onChange={(e) => setChainId(e.target.value)}
            >
              {chains.map((c) => (
                <option key={c.chainId} value={c.chainId}>
                  {c.networkLabel} ({c.chainId})
                </option>
              ))}
            </select>
          </div>

          <Button type="button" variant="secondary" disabled={busy} onClick={() => void lookup()}>
            {t("wallet.localRecoveryLookup")}
          </Button>

          {info?.inDb && initialEntry && (
            <div className="rounded-lg border p-4 space-y-2">
              <p className="text-sm">{t("wallet.localRecoveryDbFound")}</p>
              <Button type="button" disabled={busy} onClick={() => void retryDbUnlock()}>
                {t("wallet.localRecoveryRetryPasskey")}
              </Button>
            </div>
          )}

          {info && !info.inDb && info.deployed && (
            <div className="rounded-lg border p-4 space-y-2">
              <p className="text-sm">{t("wallet.localRecoveryDeployed")}</p>
              <p className="text-xs text-muted-foreground font-mono">{shortAddress(info.wallet)}</p>
              <Button type="button" disabled={busy} onClick={() => void recoverFromChain()}>
                {t("wallet.localRecoveryFromChain")}
              </Button>
            </div>
          )}

          {info && !info.deployed && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 space-y-2">
              <p className="text-sm">{t("wallet.localRecoveryUndeployed")}</p>
              {info.hasFunds && (
                <p className="text-sm text-muted-foreground">{t("wallet.localRecoveryUndeployedFunds")}</p>
              )}
              <Button type="button" variant="outline" onClick={showSupport}>
                {t("wallet.localRecoverySupportCta")}
              </Button>
            </div>
          )}

          {supportText && (
            <div className="space-y-2">
              <Label>{t("wallet.localRecoverySupportCopy")}</Label>
              <textarea
                readOnly
                className="min-h-[120px] w-full rounded-md border bg-muted p-3 font-mono text-xs"
                value={supportText}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => void navigator.clipboard.writeText(supportText)}
              >
                {t("wallet.localRecoveryCopy")}
              </Button>
            </div>
          )}

          {status && <p className="text-sm text-destructive">{status}</p>}
        </div>
      </SheetContent>
    </Sheet>
  );
}
