import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLocale } from "@/providers/LocaleProvider";

const TOTAL_STEPS = 3;

export function CreateDisclaimerWizard({
  open,
  onOpenChange,
  onComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}) {
  const { t } = useLocale();
  const [step, setStep] = useState(1);

  const finish = () => {
    setStep(1);
    onOpenChange(false);
    onComplete();
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) setStep(1);
    onOpenChange(next);
  };

  const titles = [
    t("wallet.createDisclaimerStep1Title"),
    t("wallet.createDisclaimerStep2Title"),
    t("wallet.createDisclaimerStep3Title"),
  ];
  const bodies = [
    t("wallet.createDisclaimerStep1Body"),
    t("wallet.createDisclaimerStep2Body"),
    t("wallet.createDisclaimerStep3Body"),
  ];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{titles[step - 1]}</DialogTitle>
          <DialogDescription>
            {t("wallet.createDisclaimerProgress", { current: step, total: TOTAL_STEPS })}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm leading-relaxed text-muted-foreground">{bodies[step - 1]}</p>
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          {step < TOTAL_STEPS ? (
            <Button
              type="button"
              variant="ghost"
              data-testid="wallet-create-disclaimer-skip"
              onClick={() => setStep(TOTAL_STEPS)}
            >
              {t("wallet.createDisclaimerSkip")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            {step > 1 && (
              <Button type="button" variant="secondary" onClick={() => setStep((s) => s - 1)}>
                {t("wallet.createDisclaimerBack")}
              </Button>
            )}
            {step < TOTAL_STEPS ? (
              <Button type="button" data-testid="wallet-create-disclaimer-next" onClick={() => setStep((s) => s + 1)}>
                {t("wallet.createDisclaimerNext")}
              </Button>
            ) : (
              <Button type="button" data-testid="wallet-create-disclaimer-finish" onClick={finish}>
                {t("wallet.createDisclaimerFinish")}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
