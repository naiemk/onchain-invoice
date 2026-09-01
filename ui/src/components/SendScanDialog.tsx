import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLocale } from "@/providers/LocaleProvider";
import { parsePaymentQr } from "@/shared/scan-payment.js";

const READER_ID = "send-qr-reader";

type SendScanDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScan: (result: { recipient: string; amount?: string }) => void;
  tokenDecimals?: number;
};

export function SendScanDialog({ open, onOpenChange, onScan, tokenDecimals = 6 }: SendScanDialogProps) {
  const { t } = useLocale();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      void scannerRef.current?.stop().catch(() => undefined);
      scannerRef.current = null;
      return;
    }

    let cancelled = false;
    setError(null);

    void (async () => {
      try {
        const scanner = new Html5Qrcode(READER_ID);
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 8, qrbox: { width: 220, height: 220 } },
          (decoded) => {
            const parsed = parsePaymentQr(decoded, tokenDecimals);
            if (!parsed) {
              setError(t("wallet.sendInvalidRecipient"));
              return;
            }
            void scanner.stop().catch(() => undefined);
            scannerRef.current = null;
            onScan(parsed);
            onOpenChange(false);
          },
          () => undefined
        );
      } catch {
        if (!cancelled) setError(t("wallet.scannerUnavailable"));
      }
    })();

    return () => {
      cancelled = true;
      void scannerRef.current?.stop().catch(() => undefined);
      scannerRef.current = null;
    };
  }, [open, onOpenChange, onScan, tokenDecimals, t]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("wallet.sendScanTitle")}</DialogTitle>
          <DialogDescription>{t("wallet.sendScanHint")}</DialogDescription>
        </DialogHeader>
        <div id={READER_ID} className="overflow-hidden rounded-lg bg-muted" />
        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}

export function SendScanButton({
  onScan,
  tokenDecimals,
  disabled,
}: {
  onScan: (result: { recipient: string; amount?: string }) => void;
  tokenDecimals?: number;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        disabled={disabled}
        aria-label={t("wallet.sendScanTitle")}
        onClick={() => setOpen(true)}
      >
        <ScanLine className="h-4 w-4" />
      </Button>
      <SendScanDialog
        open={open}
        onOpenChange={setOpen}
        onScan={onScan}
        tokenDecimals={tokenDecimals}
      />
    </>
  );
}
