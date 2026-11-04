"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useApi, apiPatch, apiDelete } from "@/lib/client";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, Button, Label, Select, Switch, Input } from "@/components/ui";
import { Loader2 } from "lucide-react";

const TIMEZONES = ["UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Asia/Tokyo", "Australia/Sydney"];

export default function SettingsPage() {
  const router = useRouter();
  const { data, loading, refresh } = useApi<any>("/api/settings");
  const [prefs, setPrefs] = useState<any>(null);
  const [saved, setSaved] = useState(false);
  const [confirm, setConfirm] = useState("");

  useEffect(() => { if (data?.preferences) setPrefs(data.preferences); }, [data]);

  async function update(patch: any) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    await apiPatch("/api/settings", patch);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function deleteAccount() {
    if (confirm !== "DELETE") return;
    await apiDelete("/api/me", { confirm: "DELETE" });
    router.push("/");
    router.refresh();
  }

  if (loading || !prefs) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="max-w-2xl">
      <PageHeader title="Settings" description="Preferences, notifications and account." action={saved ? <span className="text-sm text-success">Saved</span> : undefined} />

      <Card className="mb-5"><CardContent className="space-y-4 p-5">
        <h3 className="font-semibold">Preferences</h3>
        <div>
          <Label>Timezone</Label>
          <Select value={prefs.timezone} onChange={(e) => update({ timezone: e.target.value })} className="mt-1 max-w-xs">
            {TIMEZONES.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
          <p className="mt-1 text-xs text-muted-foreground">Used for scheduling windows, allowed days/hours and the calendar.</p>
        </div>
      </CardContent></Card>

      <Card className="mb-5"><CardContent className="space-y-3 p-5">
        <h3 className="font-semibold">Notifications</h3>
        {[
          { k: "notifyOnPublish", label: "When a post is published" },
          { k: "notifyOnFailure", label: "When a publish fails" },
          { k: "notifyOnApproval", label: "When a post needs approval" },
          { k: "notifyOnDisconnect", label: "When an account disconnects" },
          { k: "emailNotifications", label: "Also send email (requires SMTP configured)" },
        ].map((n) => (
          <label key={n.k} className="flex items-center justify-between text-sm">
            {n.label}
            <Switch checked={!!prefs[n.k]} onCheckedChange={(v) => update({ [n.k]: v })} />
          </label>
        ))}
      </CardContent></Card>

      <Card className="border-destructive/40"><CardContent className="space-y-3 p-5">
        <h3 className="font-semibold text-destructive">Danger zone</h3>
        <p className="text-sm text-muted-foreground">Deleting your account removes all accounts, automations, assets and jobs. This cannot be undone. Type <strong>DELETE</strong> to confirm.</p>
        <div className="flex gap-2">
          <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="DELETE" className="max-w-[160px]" />
          <Button variant="destructive" disabled={confirm !== "DELETE"} onClick={deleteAccount}>Delete account</Button>
        </div>
      </CardContent></Card>
    </div>
  );
}
