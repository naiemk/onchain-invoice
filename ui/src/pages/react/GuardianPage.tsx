import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { PageHero } from "@/components/PageHero";
import { PageCard } from "@/components/PageSplit";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useLocale } from "@/providers/LocaleProvider";
import {
  approveGuardianRequest,
  clearGuardianSession,
  fetchGuardianMe,
  fetchGuardianNonce,
  guardianLogin,
  listGuardianRecoveryRequests,
  loadGuardianSession,
  rejectGuardianRequest,
  saveGuardianSession,
  type RecoveryRequestPublic,
} from "@/shared/wallet-recovery-api.js";
import { shortKey } from "@/shared/wallet-ui.js";

type EthProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

function ethereum(): EthProvider | null {
  const w = window as Window & { ethereum?: EthProvider };
  return w.ethereum ?? null;
}

function shortAddr(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

type Filter = "awaiting" | "progress" | "archive";

export function GuardianPage() {
  const { t } = useLocale();
  const [address, setAddress] = useState<string | null>(null);
  const [requests, setRequests] = useState<RecoveryRequestPublic[]>([]);
  const [filter, setFilter] = useState<Filter>("awaiting");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<RecoveryRequestPublic | null>(null);

  const loadRequests = useCallback(
    async (f: Filter) => {
      setLoading(true);
      try {
        const statusParam =
          f === "awaiting" ? "awaiting_guardian" : f === "progress" ? "queued,on_chain" : "archive";
        const { requests: list } = await listGuardianRecoveryRequests(statusParam);
        setRequests(list);
        setStatus("");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
        setRequests([]);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    const token = loadGuardianSession();
    if (!token) return;
    void (async () => {
      try {
        const me = await fetchGuardianMe();
        setAddress(me.address);
        await loadRequests("awaiting");
      } catch {
        clearGuardianSession();
      }
    })();
  }, [loadRequests]);

  const connect = async () => {
    const provider = ethereum();
    if (!provider) {
      setStatus(t("guardian.noMetamask"));
      return;
    }
    setLoading(true);
    setStatus(t("guardian.connecting"));
    try {
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      const addr = accounts[0];
      if (!addr) throw new Error(t("guardian.noAccount"));
      const { nonce, message } = await fetchGuardianNonce(addr);
      const signature = (await provider.request({
        method: "personal_sign",
        params: [message, addr],
      })) as string;
      const login = await guardianLogin({ address: addr, signature, message, nonce });
      saveGuardianSession(login.token);
      setAddress(login.address);
      setStatus("");
      await loadRequests("awaiting");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const signOut = () => {
    clearGuardianSession();
    setAddress(null);
    setRequests([]);
    setDetail(null);
  };

  if (!address) {
    return (
      <div className="mx-auto max-w-lg px-4 py-10 md:px-8">
        <PageHero breadcrumb="GUARDIAN" title={t("guardian.title")} lede={t("guardian.lede")} className="mb-6" />
        <PageCard className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("guardian.connectHint")}</p>
          <Button onClick={() => void connect()} disabled={loading}>
            {t("guardian.connect")}
          </Button>
          {status && (
            <Alert>
              <AlertDescription>{status}</AlertDescription>
            </Alert>
          )}
        </PageCard>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 md:px-8">
      <PageHero
        breadcrumb="GUARDIAN"
        title={t("guardian.title")}
        lede={t("guardian.signedIn", { address: shortAddr(address) })}
        className="mb-8"
      />
      <Card>
        <CardHeader>
          <div className="flex flex-wrap gap-2">
            {(["awaiting", "progress", "archive"] as const).map((f) => (
              <Button
                key={f}
                variant={filter === f ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setFilter(f);
                  void loadRequests(f);
                }}
              >
                {f === "awaiting"
                  ? t("guardian.filterAwaiting")
                  : f === "progress"
                    ? t("guardian.filterProgress")
                    : t("guardian.filterArchive")}
              </Button>
            ))}
            <Button variant="outline" size="sm" onClick={() => void loadRequests(filter)} disabled={loading}>
              {t("guardian.refresh")}
            </Button>
            <Button variant="ghost" size="sm" onClick={signOut}>
              {t("guardian.signOut")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}
          {status && !loading && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{status}</AlertDescription>
            </Alert>
          )}
          {requests.length === 0 && !loading ? (
            <p className="text-sm text-muted-foreground">{t("guardian.empty")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("guardian.colWallet")}</TableHead>
                  <TableHead>{t("guardian.colEmail")}</TableHead>
                  <TableHead>{t("guardian.colDevice")}</TableHead>
                  <TableHead>{t("guardian.colStatus")}</TableHead>
                  <TableHead>{t("guardian.colCreated")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{shortAddr(r.walletAddress)}</TableCell>
                    <TableCell>{r.email}</TableCell>
                    <TableCell className="text-xs">
                      {r.deviceLabel ?? "—"}{" "}
                      <span className="font-mono text-muted-foreground">{shortKey(r.newQx)}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{r.status}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">{new Date(r.createdAt).toLocaleString()}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setDetail(r)}>
                          {t("guardian.detail")}
                        </Button>
                        {r.status === "awaiting_guardian" && (
                          <>
                            <Button
                              size="sm"
                              onClick={() =>
                                void approveGuardianRequest(r.id).then(() => loadRequests(filter))
                              }
                            >
                              {t("guardian.approve")}
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                if (!window.confirm(t("guardian.rejectConfirm"))) return;
                                void rejectGuardianRequest(r.id).then(() => loadRequests(filter));
                              }}
                            >
                              {t("guardian.reject")}
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {detail && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>{t("guardian.detailTitle")}</CardTitle>
            <CardDescription className="font-mono text-xs">{detail.id}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="text-muted-foreground">{t("guardian.colWallet")}: </span>
              <span className="font-mono">{detail.walletAddress}</span>
            </p>
            <p>
              <span className="text-muted-foreground">{t("guardian.colEmail")}: </span>
              {detail.email}
            </p>
            <Button variant="secondary" size="sm" onClick={() => setDetail(null)}>
              {t("common.close")}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
