"use client";

import { useState } from "react";
import { useApi, apiPatch } from "@/lib/client";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, Button, Tabs, TabsList, TabsTrigger } from "@/components/ui";
import { PlatformIcon } from "@/components/platform-icon";
import { StatusBadge } from "@/components/status-badge";
import { formatRelative } from "@/lib/utils";
import { Check, X, RotateCw, Loader2, ExternalLink } from "lucide-react";

const TABS = [
  { k: "upcoming", label: "Upcoming" },
  { k: "processing", label: "Processing" },
  { k: "awaiting_asset", label: "Awaiting asset" },
  { k: "awaiting_approval", label: "Awaiting approval" },
  { k: "published", label: "Published" },
  { k: "failed", label: "Failed" },
];

export default function QueuePage() {
  const [tab, setTab] = useState("upcoming");
  const { data, loading, refresh } = useApi<any>(`/api/jobs?tab=${tab}`);
  const jobs = data?.jobs ?? [];
  const [busy, setBusy] = useState<string | null>(null);

  async function act(id: string, action: string, extra?: any) {
    setBusy(id);
    try { await apiPatch(`/api/jobs/${id}`, { action, ...extra }); refresh(); }
    catch (e) { alert((e as Error).message); }
    finally { setBusy(null); }
  }

  return (
    <div>
      <PageHeader title="Publishing queue" description="Every publish reflects real database and provider state." />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 flex-wrap">
          {TABS.map((t) => <TabsTrigger key={t.k} value={t.k}>{t.label}</TabsTrigger>)}
        </TabsList>
      </Tabs>

      {loading && !data ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : jobs.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Nothing here.</CardContent></Card>
      ) : (
        <div className="space-y-2.5">
          {jobs.map((j: any) => (
            <Card key={j.id}>
              <CardContent className="flex flex-wrap items-center gap-4 p-4">
                <PlatformIcon platform={j.destinationPlatform} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    @{j.destinationAccount?.username ?? "—"}
                    {j.automation?.name && <span className="ml-2 text-xs text-muted-foreground">· {j.automation.name}</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{j.resolvedCaption || j.detectedPost?.caption || "No caption"}</p>
                  {j.lastError && <p className="truncate text-xs text-destructive">{j.lastError}</p>}
                </div>
                <div className="text-right text-xs text-muted-foreground">{formatRelative(j.scheduledAt ?? j.publishedAt ?? j.createdAt)}</div>
                <StatusBadge status={j.status} />
                <div className="flex items-center gap-1">
                  {j.publishedUrl && <a href={j.publishedUrl} target="_blank" rel="noreferrer"><Button variant="ghost" size="icon"><ExternalLink className="h-4 w-4" /></Button></a>}
                  {j.status === "PENDING_APPROVAL" && (
                    <Button size="sm" className="gap-1.5" disabled={busy === j.id} onClick={() => act(j.id, "approve")}><Check className="h-3.5 w-3.5" /> Approve</Button>
                  )}
                  {j.status === "FAILED" && (
                    <Button size="sm" variant="outline" className="gap-1.5" disabled={busy === j.id} onClick={() => act(j.id, "retry")}><RotateCw className="h-3.5 w-3.5" /> Retry</Button>
                  )}
                  {["SCHEDULED", "QUEUED", "PENDING_APPROVAL", "AWAITING_ASSET", "FAILED"].includes(j.status) && (
                    <Button size="icon" variant="ghost" title="Cancel" disabled={busy === j.id} onClick={() => act(j.id, "cancel")}><X className="h-4 w-4 text-destructive" /></Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
