import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { Button } from "@/components/ui";
import { PlatformIcon } from "@/components/platform-icon";
import { ArrowRight, Zap, CalendarClock, Shuffle, ShieldCheck } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function LandingPage() {
  const user = await getSessionUser();
  if (user) redirect("/overview");

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2 font-semibold">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Shuffle className="h-4 w-4" />
          </div>
          RepostFlow
        </div>
        <nav className="flex items-center gap-3">
          <Link href="/login"><Button variant="ghost" size="sm">Log in</Button></Link>
          <Link href="/signup"><Button size="sm">Get started</Button></Link>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-6">
        <section className="py-20 text-center">
          <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground">
            <Zap className="h-3.5 w-3.5 text-primary" /> Cloud-native cross-posting that runs without your computer on
          </div>
          <h1 className="mx-auto max-w-3xl text-balance text-5xl font-bold tracking-tight sm:text-6xl">
            Post once. <span className="text-primary">Everywhere</span>, automatically.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-balance text-lg text-muted-foreground">
            Connect TikTok, Instagram and YouTube. RepostFlow detects every new video and cross-posts it with your own
            captions, timing and rules — all server-side, 24/7.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link href="/signup"><Button size="lg" className="gap-2">Start automating <ArrowRight className="h-4 w-4" /></Button></Link>
            <Link href="/login"><Button size="lg" variant="outline">I have an account</Button></Link>
          </div>
          <div className="mt-12 flex items-center justify-center gap-3">
            <PlatformIcon platform="TIKTOK" size="lg" />
            <ArrowRight className="h-5 w-5 text-muted-foreground" />
            <PlatformIcon platform="INSTAGRAM" size="lg" />
            <PlatformIcon platform="YOUTUBE" size="lg" />
          </div>
        </section>

        <section className="grid gap-5 pb-24 sm:grid-cols-3">
          {[
            { icon: Shuffle, title: "Any-to-any routing", body: "TikTok → Reels + Shorts, YouTube → Instagram, and every permitted pairing — with built-in loop protection." },
            { icon: CalendarClock, title: "Precise scheduling", body: "Immediate, fixed delay, time windows, queues and staggered per-platform posting. Timezone & DST aware." },
            { icon: ShieldCheck, title: "Honest & compliant", body: "Official OAuth only. Encrypted tokens. Accurate 'approval required' states — never faked success." },
          ].map((f) => (
            <div key={f.title} className="rounded-xl border bg-card p-6">
              <f.icon className="mb-3 h-6 w-6 text-primary" />
              <h3 className="font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t py-8 text-center text-sm text-muted-foreground">
        RepostFlow — automated cross-platform video publishing.
      </footer>
    </div>
  );
}
