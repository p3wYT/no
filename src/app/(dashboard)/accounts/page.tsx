"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useApi, apiPost, apiPatch, apiDelete } from "@/lib/client";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, Button, Switch, Select, Badge } from "@/components/ui";
import { PlatformIcon, platformLabel } from "@/components/platform-icon";
import { StatusBadge } from "@/components/status-badge";
import { formatRelative } from "@/lib/utils";
import { RefreshCw, Trash2, Plus, Loader2, AlertTriangle, Info } from "lucide-react";

const PLATFORMS = ["TIKTOK", "INSTAGRAM", "YOUTUBE"] as const;
const INTERVALS = [
  { v: 300, label: "Every 5 minutes" },
  { v: 900, label: "Every 15 minutes" },
  { v: 1800, label: "Every 30 minutes" },
  { v: 3600, label: "Every hour" },
];

export default function AccountsPage() {
  const { data, loading, refresh } = useApi<any>("/api/accounts");
  const params = useSearchParams();
  const [busy, setBusy] = useState<string | null>(null);

  const accounts = data?.accounts ?? [];
  const capabilities: any[] = data?.capabilities ?? [];
  const errorParam = params.get("error");
  const connectedParam = params.get("connected");

  async function check(id: string) {
    setBusy(id);
    try { await apiPost(`/api/accounts/${id}/check`); } finally { setBusy(null); }
  }
  async function toggleMonitoring(id: string, on: boolean) {
    await apiPatch(`/api/accounts/${id}`, { monitoringOn: on });
    refresh();
  }
  async function setInterval(id: string, sec: number) {
    await apiPatch(`/api/accounts/${id}`, { pollIntervalSec: sec });
    refresh();
  }
  async function disconnect(id: string) {
    if (!confirm("Disconnect this account? Its credentials and detected posts will be removed.")) return;
    await apiDelete(`/api/accounts/${id}`);
    refresh();
  }

  return (
    <div>
      <PageHeader title="Connected accounts" description="Authorize platforms with official OAuth. Tokens are encrypted at rest." />

      {connectedParam && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-4 py-2.5 text-sm text-success">
          Connected {connectedParam} successfully.
        </div>
      )}
      {errorParam && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          {errorParam === "not_configured"
            ? `This platform isn't configured on the server yet (missing API credentials). See the setup guide in the README.`
            : `Connection error: ${errorParam.replace(/_/g, " ")}`}
        </div>
      )}

      {/* Capability / connect cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        {capabilities.map((cap) => (
          <Card key={cap.platform}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <PlatformIcon platform={cap.platform} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{platformLabel(cap.platform)}</p>
                  <p className="text-xs text-muted-foreground">
                    {cap.demo ? "Demo mode" : cap.configured ? "Ready to connect" : "Setup required"}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge variant={cap.canDetect ? "success" : "default"}>Detect</Badge>
                <Badge variant={cap.canPublish ? "success" : "warning"}>Publish</Badge>
              </div>
              <ul className="mt-3 space-y-1">
                {cap.notes.map((n: string, i: number) => (
                  <li key={i} className="flex gap-1.5 text-xs text-muted-foreground"><Info className="mt-0.5 h-3 w-3 shrink-0" />{n}</li>
                ))}
              </ul>
              <a href={`/api/connect/${cap.platform.toLowerCase()}`}>
                <Button className="mt-3 w-full gap-2" size="sm" disabled={!cap.configured && !cap.demo} variant={cap.configured || cap.demo ? "default" : "outline"}>
                  <Plus className="h-4 w-4" /> Connect {platformLabel(cap.platform)}
                </Button>
              </a>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Connected accounts list */}
      <h2 className="mb-3 mt-8 text-sm font-semibold text-muted-foreground">Your accounts</h2>
      {loading && !data ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : accounts.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No accounts connected yet. Use the cards above to connect one.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {accounts.map((a: any) => (
            <Card key={a.id}>
              <CardContent className="flex flex-wrap items-center gap-4 p-4">
                <PlatformIcon platform={a.platform} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">@{a.username ?? a.displayName ?? a.providerAccountId}</p>
                    <StatusBadge status={a.status} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Last checked {formatRelative(a.lastCheckedAt)} · Next {formatRelative(a.nextCheckAt)}
                    {a.lastError && <span className="text-destructive"> · {a.lastError}</span>}
                  </p>
                  {a.statusDetail && <p className="mt-0.5 text-xs text-warning">{a.statusDetail}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Monitor</span>
                  <Switch checked={a.monitoringOn} onCheckedChange={(v) => toggleMonitoring(a.id, v)} />
                </div>
                <Select value={a.pollIntervalSec} onChange={(e) => setInterval(a.id, Number(e.target.value))} className="w-40">
                  {INTERVALS.map((i) => <option key={i.v} value={i.v}>{i.label}</option>)}
                </Select>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => check(a.id)} disabled={busy === a.id}>
                  {busy === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Check
                </Button>
                <Button variant="ghost" size="icon" onClick={() => disconnect(a.id)} aria-label="Disconnect"><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
