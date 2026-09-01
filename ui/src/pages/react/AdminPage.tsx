import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
        <header className="mb-8 space-y-2">
          <p className="text-sm font-medium uppercase tracking-wider text-primary">{t("admin.eyebrow")}</p>
          <h1 className="text-3xl font-semibold tracking-tight">{t("admin.restrictedTitle")}</h1>
          <p className="text-muted-foreground">{t("admin.restrictedLede")}</p>
        </header>
        <Card>
          <CardContent className="space-y-4 pt-6">
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
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 md:px-8">
      <header className="mb-8 space-y-2">
        <p className="text-sm font-medium uppercase tracking-wider text-primary">{t("admin.eyebrow")}</p>
        <h1 className="text-3xl font-semibold tracking-tight">{t("admin.overviewTitle")}</h1>
        <p className="text-muted-foreground">{t("admin.overviewLede")}</p>
      </header>
      <Card className="mb-8">
        <CardContent className="space-y-4 pt-6">
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
        </CardContent>
      </Card>
      {stats && (
        <>
          <div className="mb-8 grid gap-4 sm:grid-cols-3">
            {[
              { label: t("admin.feesCollected"), value: stats.fees },
              { label: t("admin.gasSpent"), value: stats.gas },
              { label: t("admin.inFlight"), value: String(stats.inFlight) },
            ].map(({ label, value }) => (
              <Card key={label}>
                <CardHeader className="pb-2">
                  <CardDescription>{label}</CardDescription>
                  <CardTitle className="font-mono text-2xl">{value}</CardTitle>
                </CardHeader>
              </Card>
            ))}
          </div>
          <Card>
            <CardHeader>
              <CardTitle>{t("admin.byMerchant")}</CardTitle>
            </CardHeader>
            <CardContent>
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
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
