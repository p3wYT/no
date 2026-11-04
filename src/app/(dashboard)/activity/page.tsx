"use client";

import { useApi } from "@/lib/client";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui";
import { formatRelative } from "@/lib/utils";
import { Loader2, Activity } from "lucide-react";

const DOT: Record<string, string> = {
  "post.detected": "bg-primary",
  "asset.matched": "bg-primary",
  "publish.scheduled": "bg-warning",
  "publish.succeeded": "bg-success",
  "publish.failed": "bg-destructive",
  "publish.handoff": "bg-warning",
  "account.connected": "bg-success",
};

export default function ActivityPage() {
  const { data, loading } = useApi<any>("/api/activity");
  const events = data?.events ?? [];

  return (
    <div>
      <PageHeader title="Activity" description="A real-time log produced by the backend — not placeholder data." />
      {loading && !data ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : events.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <Activity className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No activity yet. Connect an account and create an automation to get started.</p>
        </CardContent></Card>
      ) : (
        <Card><CardContent className="p-5">
          <ul className="space-y-4">
            {events.map((e: any) => (
              <li key={e.id} className="flex gap-3">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[e.kind] ?? "bg-muted-foreground"}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{e.message}</p>
                  <p className="text-xs text-muted-foreground">{formatRelative(e.createdAt)}</p>
                </div>
              </li>
            ))}
          </ul>
        </CardContent></Card>
      )}
    </div>
  );
}
