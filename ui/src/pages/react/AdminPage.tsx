import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Surface } from "@/components/Surface";
import { useLocale } from "@/providers/LocaleProvider";
import { localizeError } from "@/i18n/errors.js";
import { apiUrl } from "@/shared/site.js";
import type { AdminStats } from "@/shared/types.js";

export function AdminPage() {
  const { t } = useLocale();
  const savedKey = localStorage.getItem("tc.adminKey") ?? "";
  const [unlocked, setUnlocked] = useState(Boolean(savedKey && sessionStorage.getItem("tc.adminUnlocked")));
  const [key, setKey] = useState(savedKey);
  const [status, setStatus] = useState(unlocked ? t("admin.enterKey") : "");
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(false);

  const unlock = useCallback(async () => {
    setLoading(true);
    setStatus("");
    try {
      const response = await fetch(apiUrl("/api/admin/stats"), { headers: { "x-api-key": key } });
      if (!response.ok) throw new Error("Invalid admin key");
      localStorage.setItem("tc.adminKey", key);
      sessionStorage.setItem("tc.adminUnlocked", "1");
      setUnlocked(true);
      setStatus(t("admin.enterKey"));
    } catch (error) {
      setStatus(localizeError(error));
    } finally {
      setLoading(false);
    }
  }, [key, t]);

  const loadStats = useCallback(async () => {
    setLoading(true);
    localStorage.setItem("tc.adminKey", key);
    try {
      const response = await fetch(apiUrl("/api/admin/stats"), { headers: { "x-api-key": key } });
      const body = (await response.json()) as AdminStats & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Stats request failed");
      setStats(body);
      setStatus(t("admin.statsLoaded"));
    } catch (error) {
      setStatus(localizeError(error));
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [key, t]);

  if (!unlocked) {
    return (
      <div className="mx-auto max-w-lg px-4 py-10 md:px-8">
        <header className="mb-6 space-y-1.5">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("admin.eyebrow")}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{t("admin.restrictedTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("admin.restrictedLede")}</p>
        </header>
        <Surface className="space-y-4 p-5">
          <div className="space-y-2">
            <Label htmlFor="admin-key">{t("admin.keyLabel")}</Label>
            <Input
              id="admin-key"
              type="password"
              placeholder="ADMIN_API_KEY"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </div>
          <Button onClick={() => void unlock()} disabled={loading}>
            {t("admin.unlock")}
          </Button>
          {status && (
            <Alert variant="destructive">
              <AlertDescription>{status}</AlertDescription>
            </Alert>
          )}
        </Surface>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 md:px-8">
      <header className="mb-6 space-y-1.5">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("admin.eyebrow")}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{t("admin.overviewTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("admin.overviewLede")}</p>
      </header>
      <Surface className="mb-6 space-y-4 p-5">
        <div className="max-w-md space-y-2">
          <Label htmlFor="admin-key">{t("admin.keyLabel")}</Label>
          <p className="text-sm text-muted-foreground">{t("admin.keyHint")}</p>
          <Input
            id="admin-key"
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoComplete="off"
          />
        </div>
        <Button onClick={() => void loadStats()} disabled={loading}>
          {t("admin.loadStats")}
        </Button>
        {status && <p className="text-sm text-muted-foreground">{status}</p>}
      </Surface>
      {stats && (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            {[
              { label: t("admin.feesCollected"), value: stats.fees },
              { label: t("admin.gasSpent"), value: stats.gas },
              { label: t("admin.inFlight"), value: String(stats.inFlight) },
            ].map(({ label, value }) => (
              <Surface key={label} className="p-4">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-1 font-mono text-xl font-semibold">{value}</p>
              </Surface>
            ))}
          </div>
          <Surface className="p-5">
            <h2 className="mb-3 text-sm font-semibold">{t("admin.byMerchant")}</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("admin.colTo")}</TableHead>
                  <TableHead>{t("admin.colCount")}</TableHead>
                  <TableHead>{t("admin.colPaid")}</TableHead>
                  <TableHead>{t("admin.colSwept")}</TableHead>
                  <TableHead>{t("admin.colFees")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.byTo.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground">
                      {t("admin.noActivity")}
                    </TableCell>
                  </TableRow>
                ) : (
                  stats.byTo.map((row) => (
                    <TableRow key={row.to}>
                      <TableCell className="max-w-[200px] truncate font-mono text-xs">{row.to}</TableCell>
                      <TableCell>{row.count}</TableCell>
                      <TableCell className="font-mono text-xs">{row.amountPaid}</TableCell>
                      <TableCell className="font-mono text-xs">{row.amountSwept}</TableCell>
                      <TableCell className="font-mono text-xs">{row.feeCollected}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Surface>
        </>
      )}
    </div>
  );
}
