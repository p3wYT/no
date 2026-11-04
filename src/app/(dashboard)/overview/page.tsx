"use client";

import Link from "next/link";
import { useApi } from "@/lib/client";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui";
import { StatusBadge } from "@/components/status-badge";
import { formatRelative } from "@/lib/utils";
import { Plug, Workflow, Film, CheckCircle2, Clock, XCircle, Loader2 } from "lucide-react";

const STAT_CARDS = [
  { key: "accounts", label: "Connected accounts", icon: Plug, href: "/accounts" },
  { key: "activeAutomations", label: "Active automations", icon: Workflow, href: "/automations" },
  { key: "detected", label: "Videos detected", icon: Film, href: "/library" },
  { key: "published", label: "Published", icon: CheckCircle2, href: "/queue?tab=published" },
  { key: "pending", label: "Pending", icon: Clock, href: "/queue" },
  { key: "failed", label: "Failed", icon: XCircle, href: "/queue?tab=failed" },
] as const;

export default function OverviewPage() {
  const { data, loading } = useApi<any>("/api/overview");
  const stats = data?.stats ?? {};

  return (
    <div>
      <PageHeader title="Overview" description="Everything happening across your connected platforms." />

      {loading && !data ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {STAT_CARDS.map((c) => (
              <Link key={c.key} href={c.href}>
                <Card className="transition-colors hover:border-primary/40">
                  <CardContent className="p-4">
                    <c.icon className="mb-2 h-4 w-4 text-muted-foreground" />
                    <div className="text-2xl font-semibold">{stats[c.key] ?? 0}</div>
                    <div className="text-xs text-muted-foreground">{c.label}</div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          {stats.processing > 0 && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border bg-accent/40 px-4 py-2.5 text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              {stats.processing} job{stats.processing === 1 ? "" : "s"} processing in the background right now.
            </div>
          )}

          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            <Card>
              <CardContent className="p-5">
                <h3 className="mb-3 font-semibold">Upcoming posts</h3>
                {(data?.upcoming ?? []).length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">No posts scheduled yet.</p>
                ) : (
                  <ul className="space-y-2.5">
                    {data.upcoming.map((j: any) => (
                      <li key={j.id} className="flex items-center justify-between gap-3 text-sm">
                        <div className="min-w-0">
                          <span className="font-medium">{j.destinationAccount?.platform}</span>
                          <span className="ml-1 text-muted-foreground">@{j.destinationAccount?.username ?? "—"}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{formatRelative(j.scheduledAt)}</span>
                          <StatusBadge status={j.status} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5">
                <h3 className="mb-3 font-semibold">Recent activity</h3>
                {(data?.recentActivity ?? []).length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">No activity yet.</p>
                ) : (
                  <ul className="space-y-2.5">
                    {data.recentActivity.map((e: any) => (
                      <li key={e.id} className="flex items-start justify-between gap-3 text-sm">
                        <span className="min-w-0">{e.message}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{formatRelative(e.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
