"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui";
import { apiPost, apiPatch, useApi } from "@/lib/client";
import {
  LayoutDashboard, Workflow, Film, ListChecks, Calendar, Plug, Activity,
  Settings, Shuffle, Moon, Sun, Bell, LogOut, Menu, X,
} from "lucide-react";

const NAV = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/automations", label: "Automations", icon: Workflow },
  { href: "/library", label: "Video Library", icon: Film },
  { href: "/queue", label: "Publishing Queue", icon: ListChecks },
  { href: "/calendar", label: "Calendar", icon: Calendar },
  { href: "/accounts", label: "Connected Accounts", icon: Plug },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/settings", label: "Settings", icon: Settings },
];

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);
  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("rf-theme", next ? "dark" : "light"); } catch {}
  }
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}

function NotificationsBell() {
  const { data, refresh } = useApi<{ unread: number; notifications: any[] }>("/api/notifications");
  const [open, setOpen] = useState(false);
  const unread = data?.unread ?? 0;
  async function markAll() {
    await apiPatch("/api/notifications", { all: true });
    refresh();
  }
  return (
    <div className="relative">
      <Button variant="ghost" size="icon" onClick={() => setOpen((o) => !o)} aria-label="Notifications">
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 rounded-xl border bg-popover p-2 shadow-lg">
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-sm font-medium">Notifications</span>
            {unread > 0 && <button onClick={markAll} className="text-xs text-primary hover:underline">Mark all read</button>}
          </div>
          <div className="max-h-80 overflow-auto">
            {(data?.notifications ?? []).length === 0 && <p className="px-2 py-6 text-center text-sm text-muted-foreground">No notifications</p>}
            {(data?.notifications ?? []).slice(0, 15).map((n) => (
              <div key={n.id} className={cn("rounded-lg px-2 py-2 text-sm", !n.readAt && "bg-accent/50")}>
                <p className="font-medium">{n.title}</p>
                {n.body && <p className="text-xs text-muted-foreground">{n.body}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function Shell({ user, children }: { user: { name: string | null; email: string }; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function logout() {
    await apiPost("/api/auth/logout");
    router.push("/login");
    router.refresh();
  }

  const sidebar = (
    <div className="flex h-full flex-col gap-1">
      <div className="flex items-center gap-2 px-3 py-4 font-semibold">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Shuffle className="h-4 w-4" />
        </div>
        RepostFlow
      </div>
      <nav className="flex-1 space-y-1 px-2">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t p-3">
        <div className="mb-2 px-1">
          <p className="truncate text-sm font-medium">{user.name || "Creator"}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </div>
        <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-muted-foreground" onClick={logout}>
          <LogOut className="h-4 w-4" /> Log out
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r bg-card lg:block">{sidebar}</aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 border-r bg-card">{sidebar}</aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center justify-between gap-2 border-b bg-background/80 px-4 backdrop-blur lg:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen((o) => !o)}>
            {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>
          <div className="flex-1" />
          <NotificationsBell />
          <ThemeToggle />
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
