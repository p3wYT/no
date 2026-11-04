"use client";

import { useState, useMemo } from "react";
import { useApi } from "@/lib/client";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, Button } from "@/components/ui";
import { PlatformIcon } from "@/components/platform-icon";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function CalendarPage() {
  const { data, loading } = useApi<any>("/api/jobs");
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });

  const byDay = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const j of (data?.jobs ?? [])) {
      const when = j.scheduledAt ?? j.publishedAt;
      if (!when) continue;
      const key = new Date(when).toDateString();
      (map[key] ??= []).push(j);
    }
    return map;
  }, [data]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));

  return (
    <div>
      <PageHeader
        title="Calendar"
        description="Scheduled and published posts across all platforms."
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setCursor(new Date(year, month - 1, 1))}><ChevronLeft className="h-4 w-4" /></Button>
            <span className="w-36 text-center text-sm font-medium">{cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
            <Button variant="outline" size="icon" onClick={() => setCursor(new Date(year, month + 1, 1))}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        }
      />

      {loading && !data ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <Card><CardContent className="p-3">
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((w) => <div key={w} className="px-1 py-2 text-center text-xs font-medium text-muted-foreground">{w}</div>)}
            {cells.map((date, i) => {
              const items = date ? byDay[date.toDateString()] ?? [] : [];
              const isToday = date && date.toDateString() === new Date().toDateString();
              return (
                <div key={i} className={`min-h-[84px] rounded-lg border p-1.5 ${!date ? "border-transparent" : "bg-background"} ${isToday ? "border-primary" : ""}`}>
                  {date && <div className="mb-1 text-xs text-muted-foreground">{date.getDate()}</div>}
                  <div className="space-y-1">
                    {items.slice(0, 3).map((j: any) => (
                      <div key={j.id} className="flex items-center gap-1 rounded bg-secondary px-1 py-0.5 text-[10px]" title={`${j.destinationPlatform} @${j.destinationAccount?.username ?? ""}`}>
                        <PlatformIcon platform={j.destinationPlatform} size="sm" className="!h-3 !w-3 !rounded-sm" />
                        <span className="truncate">{new Date(j.scheduledAt ?? j.publishedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                    ))}
                    {items.length > 3 && <div className="px-1 text-[10px] text-muted-foreground">+{items.length - 3} more</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent></Card>
      )}
    </div>
  );
}
