"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, apiPost, apiPatch, useApi } from "@/lib/client";
import { Card, CardContent, Button, Input, Label, Select, Switch, Textarea, Badge } from "@/components/ui";
import { PlatformIcon, platformLabel } from "@/components/platform-icon";
import { ArrowRight, Loader2, Sparkles, Plus, Check } from "lucide-react";

type Platform = "TIKTOK" | "INSTAGRAM" | "YOUTUBE";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface TargetState {
  accountId: string;
  platform: Platform;
  captionMode: "KEEP_ORIGINAL" | "CUSTOM" | "TEMPLATE";
  template: string;
  addHashtags: string;
  removeHashtags: string;
  prefix: string;
  suffix: string;
  visibility: "public" | "unlisted" | "private";
  extraDelaySec: number;
}

function splitTags(s: string): string[] {
  return s.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);
}

export function AutomationBuilder({ automationId }: { automationId?: string }) {
  const router = useRouter();
  const { data: accountsData } = useApi<any>("/api/accounts");
  const accounts = accountsData?.accounts ?? [];

  const [name, setName] = useState("New automation");
  const [enabled, setEnabled] = useState(false);
  const [sourceAccountId, setSourceAccountId] = useState("");
  const [executionMode, setExecutionMode] = useState<"AUTOMATIC" | "APPROVAL_REQUIRED">("APPROVAL_REQUIRED");
  const [scheduleMode, setScheduleMode] = useState<"IMMEDIATE" | "FIXED_DELAY" | "SCHEDULED_WINDOW" | "SPECIFIC_TIME" | "QUEUE">("IMMEDIATE");
  const [delayMinutes, setDelayMinutes] = useState(0);
  const [windowStart, setWindowStart] = useState(9);
  const [windowEnd, setWindowEnd] = useState(21);
  const [specificAt, setSpecificAt] = useState("");
  const [queueSpacing, setQueueSpacing] = useState(60);
  const [targets, setTargets] = useState<TargetState[]>([]);

  // Conditions
  const [minDur, setMinDur] = useState<string>("");
  const [maxDur, setMaxDur] = useState<string>("");
  const [includeKw, setIncludeKw] = useState("");
  const [excludeKw, setExcludeKw] = useState("");
  const [onlyVertical, setOnlyVertical] = useState(false);
  const [allowedDays, setAllowedDays] = useState<number[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(!automationId);

  // Load existing automation for edit.
  useEffect(() => {
    if (!automationId) return;
    api(`/api/automations/${automationId}`).then(({ automation: a }: any) => {
      setName(a.name); setEnabled(a.enabled); setSourceAccountId(a.sourceAccountId);
      setExecutionMode(a.executionMode); setScheduleMode(a.scheduleMode);
      setDelayMinutes(Math.round((a.delaySeconds ?? 0) / 60));
      if (a.scheduleConfig?.window) { setWindowStart(a.scheduleConfig.window.startHour); setWindowEnd(a.scheduleConfig.window.endHour); }
      if (a.scheduleConfig?.specific) setSpecificAt(a.scheduleConfig.specific.at.slice(0, 16));
      if (a.scheduleConfig?.queue) setQueueSpacing(a.scheduleConfig.queue.spacingMinutes);
      const c = a.conditions ?? {};
      setMinDur(c.minDurationSec != null ? String(c.minDurationSec) : "");
      setMaxDur(c.maxDurationSec != null ? String(c.maxDurationSec) : "");
      setIncludeKw((c.includeKeywords ?? []).join(", "));
      setExcludeKw((c.excludeKeywords ?? []).join(", "));
      setOnlyVertical(!!c.onlyVertical);
      setAllowedDays(c.allowedDays ?? []);
      setTargets((a.targets ?? []).map((t: any) => ({
        accountId: t.accountId, platform: t.platform, captionMode: t.captionMode,
        template: t.captionConfig?.template ?? "", addHashtags: (t.captionConfig?.addHashtags ?? []).join(", "),
        removeHashtags: (t.captionConfig?.removeHashtags ?? []).join(", "), prefix: t.captionConfig?.prefix ?? "",
        suffix: t.captionConfig?.suffix ?? "", visibility: t.visibility, extraDelaySec: t.extraDelaySec ?? 0,
      })));
      setLoaded(true);
    }).catch((e) => setError(e.message));
  }, [automationId]);

  const sourceAccount = accounts.find((a: any) => a.id === sourceAccountId);
  const destCandidates = accounts.filter((a: any) => a.id !== sourceAccountId);

  function toggleTarget(acc: any) {
    setTargets((prev) => {
      const exists = prev.find((t) => t.accountId === acc.id);
      if (exists) return prev.filter((t) => t.accountId !== acc.id);
      return [...prev, {
        accountId: acc.id, platform: acc.platform, captionMode: "KEEP_ORIGINAL",
        template: "", addHashtags: "", removeHashtags: "", prefix: "", suffix: "",
        visibility: "public", extraDelaySec: 0,
      }];
    });
  }
  function updateTarget(id: string, patch: Partial<TargetState>) {
    setTargets((prev) => prev.map((t) => (t.accountId === id ? { ...t, ...patch } : t)));
  }

  function buildPayload() {
    const conditions: any = {};
    if (minDur) conditions.minDurationSec = Number(minDur);
    if (maxDur) conditions.maxDurationSec = Number(maxDur);
    if (splitTags(includeKw).length) conditions.includeKeywords = splitTags(includeKw);
    if (splitTags(excludeKw).length) conditions.excludeKeywords = splitTags(excludeKw);
    if (onlyVertical) conditions.onlyVertical = true;
    if (allowedDays.length) conditions.allowedDays = allowedDays;

    const scheduleConfig: any = {};
    if (scheduleMode === "SCHEDULED_WINDOW") scheduleConfig.window = { startHour: windowStart, endHour: windowEnd };
    if (scheduleMode === "SPECIFIC_TIME" && specificAt) scheduleConfig.specific = { at: new Date(specificAt).toISOString() };
    if (scheduleMode === "QUEUE") scheduleConfig.queue = { spacingMinutes: queueSpacing };

    return {
      name, enabled, sourceAccountId,
      sourcePlatform: sourceAccount?.platform,
      executionMode, scheduleMode,
      delaySeconds: scheduleMode === "FIXED_DELAY" ? delayMinutes * 60 : 0,
      scheduleConfig: Object.keys(scheduleConfig).length ? scheduleConfig : undefined,
      conditions: Object.keys(conditions).length ? conditions : undefined,
      targets: targets.map((t) => ({
        accountId: t.accountId, platform: t.platform, captionMode: t.captionMode,
        visibility: t.visibility, extraDelaySec: t.extraDelaySec,
        captionConfig: {
          template: t.template || undefined,
          addHashtags: splitTags(t.addHashtags),
          removeHashtags: splitTags(t.removeHashtags),
          prefix: t.prefix || undefined,
          suffix: t.suffix || undefined,
        },
      })),
    };
  }

  async function save() {
    setError(null);
    if (!sourceAccountId) { setError("Choose a source account"); return; }
    if (targets.length === 0) { setError("Add at least one destination"); return; }
    setSaving(true);
    try {
      const payload = buildPayload();
      if (automationId) await apiPatch(`/api/automations/${automationId}`, payload);
      else await apiPost("/api/automations", payload);
      router.push("/automations");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  if (!loaded) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-5">
      {/* Name + enable */}
      <Card><CardContent className="flex flex-wrap items-center gap-4 p-5">
        <div className="flex-1">
          <Label htmlFor="name">Automation name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
        </div>
        <label className="flex items-center gap-2 pt-5 text-sm"><Switch checked={enabled} onCheckedChange={setEnabled} /> Enabled</label>
      </CardContent></Card>

      {/* WHEN */}
      <Card><CardContent className="p-5">
        <div className="mb-3 flex items-center gap-2"><Badge variant="primary">WHEN</Badge><span className="text-sm text-muted-foreground">a new video is detected on…</span></div>
        {accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Connect an account first.</p>
        ) : (
          <Select value={sourceAccountId} onChange={(e) => { setSourceAccountId(e.target.value); setTargets([]); }}>
            <option value="">Select source account…</option>
            {accounts.map((a: any) => <option key={a.id} value={a.id}>{platformLabel(a.platform)} · @{a.username ?? a.providerAccountId}</option>)}
          </Select>
        )}
      </CardContent></Card>

      {/* THEN - destinations */}
      <Card><CardContent className="p-5">
        <div className="mb-3 flex items-center gap-2"><Badge variant="primary">THEN</Badge><span className="text-sm text-muted-foreground">cross-post to…</span></div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {destCandidates.map((acc: any) => {
            const selected = targets.some((t) => t.accountId === acc.id);
            return (
              <button key={acc.id} type="button" onClick={() => toggleTarget(acc)}
                className={`flex items-center gap-2 rounded-lg border p-3 text-left transition-colors ${selected ? "border-primary bg-primary/5" : "hover:bg-secondary"}`}>
                <PlatformIcon platform={acc.platform} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">@{acc.username ?? acc.providerAccountId}</p>
                  <p className="text-xs text-muted-foreground">{platformLabel(acc.platform)}</p>
                </div>
                {selected ? <Check className="h-4 w-4 text-primary" /> : <Plus className="h-4 w-4 text-muted-foreground" />}
              </button>
            );
          })}
          {destCandidates.length === 0 && <p className="text-sm text-muted-foreground">Connect another account to use as a destination.</p>}
        </div>

        {targets.map((t) => (
          <DestinationConfig key={t.accountId} target={t} onChange={(p) => updateTarget(t.accountId, p)} />
        ))}
      </CardContent></Card>

      {/* Timing */}
      <Card><CardContent className="space-y-4 p-5">
        <h3 className="font-semibold">Timing & execution</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Execution</Label>
            <Select value={executionMode} onChange={(e) => setExecutionMode(e.target.value as any)} className="mt-1">
              <option value="APPROVAL_REQUIRED">Require approval before posting</option>
              <option value="AUTOMATIC">Post automatically</option>
            </Select>
          </div>
          <div>
            <Label>Schedule</Label>
            <Select value={scheduleMode} onChange={(e) => setScheduleMode(e.target.value as any)} className="mt-1">
              <option value="IMMEDIATE">Immediately</option>
              <option value="FIXED_DELAY">After a fixed delay</option>
              <option value="SCHEDULED_WINDOW">Within a daily time window</option>
              <option value="SPECIFIC_TIME">At a specific time</option>
              <option value="QUEUE">Add to a spaced queue</option>
            </Select>
          </div>
        </div>
        {scheduleMode === "FIXED_DELAY" && (
          <div><Label>Delay (minutes)</Label><Input type="number" min={0} value={delayMinutes} onChange={(e) => setDelayMinutes(Number(e.target.value))} className="mt-1 w-40" /></div>
        )}
        {scheduleMode === "SCHEDULED_WINDOW" && (
          <div className="flex gap-4">
            <div><Label>From (hour)</Label><Input type="number" min={0} max={23} value={windowStart} onChange={(e) => setWindowStart(Number(e.target.value))} className="mt-1 w-28" /></div>
            <div><Label>To (hour)</Label><Input type="number" min={1} max={24} value={windowEnd} onChange={(e) => setWindowEnd(Number(e.target.value))} className="mt-1 w-28" /></div>
          </div>
        )}
        {scheduleMode === "SPECIFIC_TIME" && (
          <div><Label>Publish at</Label><Input type="datetime-local" value={specificAt} onChange={(e) => setSpecificAt(e.target.value)} className="mt-1 w-64" /></div>
        )}
        {scheduleMode === "QUEUE" && (
          <div><Label>Spacing between posts (minutes)</Label><Input type="number" min={1} value={queueSpacing} onChange={(e) => setQueueSpacing(Number(e.target.value))} className="mt-1 w-40" /></div>
        )}
      </CardContent></Card>

      {/* Conditions */}
      <Card><CardContent className="space-y-4 p-5">
        <h3 className="font-semibold">Conditions & filters <span className="font-normal text-muted-foreground">(optional)</span></h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><Label>Min duration (sec)</Label><Input type="number" min={0} value={minDur} onChange={(e) => setMinDur(e.target.value)} className="mt-1" /></div>
          <div><Label>Max duration (sec)</Label><Input type="number" min={0} value={maxDur} onChange={(e) => setMaxDur(e.target.value)} className="mt-1" /></div>
          <div><Label>Must include keywords</Label><Input value={includeKw} onChange={(e) => setIncludeKw(e.target.value)} placeholder="anime, edit" className="mt-1" /></div>
          <div><Label>Exclude keywords</Label><Input value={excludeKw} onChange={(e) => setExcludeKw(e.target.value)} placeholder="sponsored" className="mt-1" /></div>
        </div>
        <label className="flex items-center gap-2 text-sm"><Switch checked={onlyVertical} onCheckedChange={setOnlyVertical} /> Only vertical videos</label>
        <div>
          <Label>Only on days</Label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {DAYS.map((d, i) => (
              <button key={d} type="button" onClick={() => setAllowedDays((prev) => prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i])}
                className={`rounded-md border px-2.5 py-1 text-xs ${allowedDays.includes(i) ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary"}`}>{d}</button>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">None selected = any day.</p>
        </div>
      </CardContent></Card>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/automations")}>Cancel</Button>
        <Button onClick={save} disabled={saving} className="gap-2">{saving && <Loader2 className="h-4 w-4 animate-spin" />}Save automation</Button>
      </div>
    </div>
  );
}

function DestinationConfig({ target, onChange }: { target: TargetState; onChange: (p: Partial<TargetState>) => void }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  async function runPreview() {
    setPreviewing(true);
    try {
      const r = await apiPost<any>("/api/preview-caption", {
        platform: target.platform, mode: target.captionMode,
        config: {
          template: target.template || undefined,
          addHashtags: splitTags(target.addHashtags),
          removeHashtags: splitTags(target.removeHashtags),
          prefix: target.prefix || undefined, suffix: target.suffix || undefined,
        },
      });
      setPreview(r.caption.text + (r.title ? `\n\nTitle: ${r.title}` : ""));
    } finally { setPreviewing(false); }
  }

  return (
    <div className="mt-3 rounded-lg border bg-secondary/30 p-4">
      <div className="mb-3 flex items-center gap-2">
        <PlatformIcon platform={target.platform} size="sm" />
        <span className="text-sm font-medium">{platformLabel(target.platform)} caption & options</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Caption mode</Label>
          <Select value={target.captionMode} onChange={(e) => onChange({ captionMode: e.target.value as any })} className="mt-1">
            <option value="KEEP_ORIGINAL">Keep original</option>
            <option value="CUSTOM">Custom text</option>
            <option value="TEMPLATE">Template with variables</option>
          </Select>
        </div>
        <div>
          <Label>Visibility</Label>
          <Select value={target.visibility} onChange={(e) => onChange({ visibility: e.target.value as any })} className="mt-1">
            <option value="public">Public</option>
            <option value="unlisted">Unlisted</option>
            <option value="private">Private</option>
          </Select>
        </div>
      </div>
      {(target.captionMode === "CUSTOM" || target.captionMode === "TEMPLATE") && (
        <div className="mt-3">
          <Label>{target.captionMode === "TEMPLATE" ? "Template" : "Caption"}</Label>
          <Textarea value={target.template} onChange={(e) => onChange({ template: e.target.value })} className="mt-1"
            placeholder={target.captionMode === "TEMPLATE" ? "{{original_caption}} via @{{source_username}} #reels" : "Your caption…"} />
          {target.captionMode === "TEMPLATE" && (
            <p className="mt-1 text-xs text-muted-foreground">Variables: {"{{original_caption}}"}, {"{{title}}"}, {"{{source_username}}"}, {"{{source_platform}}"}, {"{{date}}"}</p>
          )}
        </div>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div><Label>Add hashtags</Label><Input value={target.addHashtags} onChange={(e) => onChange({ addHashtags: e.target.value })} placeholder="reels, viral" className="mt-1" /></div>
        <div><Label>Remove hashtags</Label><Input value={target.removeHashtags} onChange={(e) => onChange({ removeHashtags: e.target.value })} placeholder="tiktok" className="mt-1" /></div>
        <div><Label>Prefix</Label><Input value={target.prefix} onChange={(e) => onChange({ prefix: e.target.value })} className="mt-1" /></div>
        <div><Label>Suffix</Label><Input value={target.suffix} onChange={(e) => onChange({ suffix: e.target.value })} className="mt-1" /></div>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <div className="flex-1"><Label>Stagger delay (sec, on top of schedule)</Label><Input type="number" min={0} value={target.extraDelaySec} onChange={(e) => onChange({ extraDelaySec: Number(e.target.value) })} className="mt-1 w-40" /></div>
        <Button type="button" variant="outline" size="sm" className="mt-5 gap-1.5" onClick={runPreview} disabled={previewing}>
          {previewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Preview
        </Button>
      </div>
      {preview && <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-background p-3 text-xs text-muted-foreground">{preview}</pre>}
    </div>
  );
}
