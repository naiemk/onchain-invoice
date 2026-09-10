import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Mail, ShieldX, Smartphone } from "lucide-react";
import { useLocale } from "@/providers/LocaleProvider";
import { fetchWalletRecovery } from "@/shared/wallet-recovery-api.js";
import { loadWalletSession } from "@/shared/wallet-session.js";
import { EmailAttachWizard } from "./EmailAttachWizard";
import { LostDeviceRecoveryDialog } from "./LostDeviceRecoveryDialog";

type Modal = "email" | "cancel" | null;

export function RecoveryOptions() {
  const { t } = useLocale();
  const session = loadWalletSession();
  const [modal, setModal] = useState<Modal>(null);
  const [hasActive, setHasActive] = useState(false);

  useEffect(() => {
    if (!session?.address) return;
    void fetchWalletRecovery(session.address)
      .then((rec) => setHasActive(Boolean(rec.request)))
      .catch(() => setHasActive(false));
  }, [session?.address, modal]);

  return (
    <div className="space-y-2">
      {session ? (
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left hover:bg-muted/40"
          onClick={() => setModal("email")}
        >
          <Mail className="h-5 w-5 shrink-0 text-emphasis" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{t("wallet.recoverMenuEmailTitle")}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{t("wallet.recoverMenuEmailBody")}</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      ) : null}

      <Link
        to="/wallet/recover"
        className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left hover:bg-muted/40"
      >
        <Smartphone className="h-5 w-5 shrink-0 text-emphasis" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{t("wallet.recoverFromOtherTitle")}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{t("wallet.recoverFromOtherBody")}</span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Link>

      {session && hasActive ? (
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left hover:bg-muted/40"
          onClick={() => setModal("cancel")}
        >
          <ShieldX className="h-5 w-5 shrink-0 text-emphasis" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{t("wallet.recoverMenuCancelTitle")}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{t("wallet.recoverMenuCancelBody")}</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      ) : null}

      <EmailAttachWizard
        open={modal === "email"}
        onOpenChange={(open) => !open && setModal(null)}
        session={session}
        onDone={() => setModal(null)}
      />
      <LostDeviceRecoveryDialog
        open={modal === "cancel"}
        onOpenChange={(open) => !open && setModal(null)}
      />
    </div>
  );
}
