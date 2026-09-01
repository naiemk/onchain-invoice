import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import QRCode from "qrcode";
import { ArrowUpRight, Copy, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageCard, PageSplit } from "@/components/PageSplit";
import { StatusBadge } from "@/components/StatusBadge";
import { ExplorerLink } from "@/components/ExplorerLink";
import { useLocale } from "@/providers/LocaleProvider";
import { copyText } from "@/shared/dom.js";
import { deploymentMode } from "@/shared/networks.js";
import { loadWalletSession } from "@/shared/wallet-session.js";
import { shortAddress } from "@/shared/wallet-session.js";
import { WalletFrame } from "./WalletFrame";

export function ReceivePage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const session = loadWalletSession();
  const [qrUrl, setQrUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [requestAmount, setRequestAmount] = useState("");
  const mode = deploymentMode();

  useEffect(() => {
    if (!session) {
      navigate("/wallet", { replace: true });
      return;
    }
    void QRCode.toDataURL(session.address, { margin: 2, width: 280 }).then(setQrUrl).catch(() => setQrUrl(""));
  }, [session, navigate]);

  if (!session) return null;

  const copyAddress = async () => {
    await copyText(session.address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const shareAddress = async () => {
    if (navigator.share) {
      await navigator.share({ title: t("wallet.receiveTitle"), text: session.address });
    } else {
      await copyAddress();
    }
  };

  return (
    <WalletFrame
      current="receive"
      title={t("wallet.receivePageTitle")}
      lede={t("wallet.receivePageLede")}
    >
      <PageSplit>
        <PageCard className="flex flex-col items-center text-center">
          {qrUrl ? (
            <img src={qrUrl} alt={t("wallet.receiveQrAlt")} className="h-56 w-56 rounded-lg" width={224} height={224} />
          ) : (
            <div className="flex h-56 w-56 items-center justify-center rounded-lg bg-muted" aria-busy="true" />
          )}
          <StatusBadge tone="available" className="mt-4">
            {t("wallet.merchantWalletPill", { mode: mode === "testnet" ? t("common.testnet") : t("common.mainnet") })}
          </StatusBadge>
        </PageCard>

        <PageCard className="space-y-6">
          <div className="space-y-2">
            <Label>{t("wallet.receiveAddressLabel")}</Label>
            <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 font-mono text-sm">
              {shortAddress(session.address)}
              <ExplorerLink chainId={session.chainId} value={session.address} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => void copyAddress()}>
                <Copy className="h-3.5 w-3.5" />
                {copied ? t("wallet.addressCopied") : t("wallet.copy")}
              </Button>
              <Button type="button" size="sm" onClick={() => void shareAddress()}>
                <Share2 className="h-3.5 w-3.5" />
                {t("wallet.shareAddress")}
              </Button>
            </div>
          </div>

          <div className="border-t border-border pt-6">
            <Label htmlFor="request-amount">{t("wallet.requestAmountLabel")}</Label>
            <Input
              id="request-amount"
              className="mt-2"
              inputMode="decimal"
              placeholder="0.00 USDC"
              value={requestAmount}
              onChange={(e) => setRequestAmount(e.target.value)}
            />
          </div>

          <Button asChild variant="secondary" size="sm">
            <Link to="/wallet/deposit">
              {t("wallet.depositCta")}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </PageCard>
      </PageSplit>
    </WalletFrame>
  );
}
