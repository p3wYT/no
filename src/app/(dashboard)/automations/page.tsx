"use client";

import Link from "next/link";
import { useApi, apiPost, apiPatch, apiDelete } from "@/lib/client";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, Button, Switch, Badge } from "@/components/ui";
import { PlatformIcon } from "@/components/platform-icon";
import { formatRelative } from "@/lib/utils";
import { Plus, ArrowRight, Copy, Trash2, Loader2, History, Workflow } from "lucide-react";

const MODE_LABEL: Record<string, string> = {
  IMMEDIATE: "Immediately", FIXED_DELAY: "Fixed delay", SCHEDULED_WINDOW: "Time window",
  SPECIFIC_TIME: "Specific time", QUEUE: "Queue",
};

export default function AutomationsPage() {
  const { data, loading, refresh } = useApi<any>("/api/automations");
  const automations = data?.automations ?? [];

  async function toggle(id: string, enabled: boolean) { await apiPatch(`/api/automations/${id}`, { enabled }); refresh(); }
  async function duplicate(id: string) { await apiPost(`/api/automations/${id}/duplicate`); refresh(); }
  async function remove(id: string) { if (!confirm("Delete this automation?")) return; await apiDelete(`/api/automations/${id}`); refresh(); }
  async function backfill(id: string) {
    if (!confirm("Queue historical videos for this automation? This is the only way old content is processed.")) return;
    const r = await apiPost<{ queued: number }>(`/api/automations/${id}/backfill`);
    alert(`Queued ${r.queued} historical post(s).`);
    refresh();
  }

  return (
    <div>
      <PageHeader
        title="Automations"
        description="Rules that cross-post new videos automatically."
        action={<Link href="/automations/new"><Button className="gap-2"><Plus className="h-4 w-4" /> New automation</Button></Link>}
      />

      {loading && !data ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : automations.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <Workflow className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No automations yet. Create your first rule to start cross-posting.</p>
          <Link href="/automations/new"><Button className="gap-2"><Plus className="h-4 w-4" /> New automation</Button></Link>
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {automations.map((a: any) => (
            <Card key={a.id}>
              <CardContent className="flex flex-wrap items-center gap-4 p-4">
                <div className="flex items-center gap-2">
                  <PlatformIcon platform={a.sourcePlatform} size="sm" />
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  <div className="flex -space-x-1">
                    {a.targets.map((t: any) => <PlatformIcon key={t.id} platform={t.platform} size="sm" className="ring-2 ring-card" />)}
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <Link href={`/automations/${a.id}`} className="font-medium hover:underline">{a.name}</Link>
                  <p className="text-xs text-muted-foreground">
                    @{a.sourceAccount?.username ?? "source"} · {MODE_LABEL[a.scheduleMode]} ·{" "}
                    {a.executionMode === "AUTOMATIC" ? "Automatic" : "Approval required"} · Last run {formatRelative(a.lastRunAt)}
                  </p>
                </div>
                <Badge variant="outline">{a._count?.publishJobs ?? 0} jobs</Badge>
                <Switch checked={a.enabled} onCheckedChange={(v) => toggle(a.id, v)} />
                <div className="flex items-center gap-0.5">
                  <Button variant="ghost" size="icon" title="Backfill history" onClick={() => backfill(a.id)}><History className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" title="Duplicate" onClick={() => duplicate(a.id)}><Copy className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" title="Delete" onClick={() => remove(a.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
