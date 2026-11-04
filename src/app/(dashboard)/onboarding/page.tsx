"use client";

import Link from "next/link";
import { useApi } from "@/lib/client";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, Button, Badge } from "@/components/ui";
import { CheckCircle2, Circle, Plug, Film, Workflow, ArrowRight, Loader2 } from "lucide-react";

export default function OnboardingPage() {
  const { data, loading } = useApi<any>("/api/overview");
  const s = data?.stats ?? {};

  const steps = [
    { done: (s.accounts ?? 0) > 0, icon: Plug, title: "Connect a platform", body: "Authorize TikTok, Instagram and/or YouTube with official OAuth. Review each account's real publishing capabilities.", href: "/accounts", cta: "Connect accounts" },
    { done: (s.detected ?? 0) > 0 || true, icon: Film, title: "Set up your media library", body: "Platforms rarely expose downloadable originals, so upload your source videos once. They're matched to detected posts automatically.", href: "/library", cta: "Open library" },
    { done: (s.automations ?? 0) > 0, icon: Workflow, title: "Create your first automation", body: "Pick a source, choose destinations, set timing and captions, preview it, then enable it. Only new content is processed — no surprise backfill.", href: "/automations/new", cta: "Build automation" },
  ];

  return (
    <div className="max-w-2xl">
      <PageHeader title="Welcome to RepostFlow 👋" description="Three steps to fully automated cross-posting." />
      {loading && !data ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="space-y-3">
          {steps.map((step, i) => (
            <Card key={i} className={step.done ? "border-success/40" : ""}>
              <CardContent className="flex items-start gap-4 p-5">
                {step.done ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-success" /> : <Circle className="mt-0.5 h-5 w-5 text-muted-foreground" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <step.icon className="h-4 w-4 text-primary" />
                    <h3 className="font-semibold">{step.title}</h3>
                    {step.done && <Badge variant="success">Done</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
                  <Link href={step.href}><Button variant={step.done ? "outline" : "default"} size="sm" className="mt-3 gap-1.5">{step.cta} <ArrowRight className="h-3.5 w-3.5" /></Button></Link>
                </div>
              </CardContent>
            </Card>
          ))}
          <div className="pt-2 text-center">
            <Link href="/overview" className="text-sm text-primary hover:underline">Skip to dashboard →</Link>
          </div>
        </div>
      )}
    </div>
  );
}
