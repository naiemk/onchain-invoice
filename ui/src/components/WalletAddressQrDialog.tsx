import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLocale } from "@/providers/LocaleProvider";

export function WalletAddressQrDialog({ address }: { address: string }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [qrUrl, setQrUrl] = useState("");

  useEffect(() => {
    if (!open) return;
    void QRCode.toDataURL(address, { margin: 2, width: 280 }).then(setQrUrl).catch(() => setQrUrl(""));
  }, [open, address]);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8"
        aria-label={t("wallet.showAddressQr")}
        onClick={() => setOpen(true)}
      >
        <QrCode className="h-3.5 w-3.5" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("wallet.addressQrTitle")}</DialogTitle>
            <DialogDescription className="font-mono text-xs break-all">{address}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-center">
            {qrUrl ? (
              <img
                src={qrUrl}
                alt={t("wallet.receiveQrAlt")}
                className="h-56 w-56 rounded-lg"
                width={224}
                height={224}
              />
            ) : (
              <div className="flex h-56 w-56 items-center justify-center rounded-lg bg-muted" aria-busy="true" />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
