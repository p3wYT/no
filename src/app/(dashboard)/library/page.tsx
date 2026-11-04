"use client";

import { useState, useRef } from "react";
import { useApi, api, apiPost, apiDelete } from "@/lib/client";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, Button, Input, Badge, Select } from "@/components/ui";
import { PlatformIcon } from "@/components/platform-icon";
import { StatusBadge } from "@/components/status-badge";
import { formatRelative, formatDuration } from "@/lib/utils";
import { Upload, Trash2, Loader2, Film, Link2, Search } from "lucide-react";

async function sha256Hex(file: File): Promise<string | undefined> {
  try {
    const buf = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch { return undefined; }
}

export default function LibraryPage() {
  const [q, setQ] = useState("");
  const { data, loading, refresh } = useApi<any>(`/api/assets${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  const { data: postsData, refresh: refreshPosts } = useApi<any>("/api/detected-posts?unmatched=1");
  const assets = data?.assets ?? [];
  const unmatched = postsData?.posts ?? [];
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [matchFor, setMatchFor] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadMsg(null);
    try {
      const hash = await sha256Hex(file);
      const init = await apiPost<any>("/api/assets", {
        originalName: file.name, mimeType: file.type || "video/mp4", sizeBytes: file.size,
        contentHash: hash, title: file.name.replace(/\.[^.]+$/, ""),
      });
      if (init.uploadUrl) {
        const put = await fetch(init.uploadUrl, { method: "PUT", headers: { "content-type": file.type || "video/mp4" }, body: file });
        if (!put.ok) throw new Error("Upload to storage failed");
        await apiPost(`/api/assets/${init.asset.id}/complete`, { contentHash: hash });
        setUploadMsg("Uploaded. Probing metadata in the background…");
      } else {
        // Storage not configured — record metadata only.
        await apiPost(`/api/assets/${init.asset.id}/complete`, { contentHash: hash });
        setUploadMsg("Object storage isn't configured, so only metadata was saved. Set S3_* env vars for real uploads.");
      }
      refresh();
    } catch (err) {
      setUploadMsg((err as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function matchAsset(assetId: string, detectedPostId: string) {
    await apiPost(`/api/assets/${assetId}/match`, { detectedPostId });
    setMatchFor(null);
    refresh();
    refreshPosts();
  }

  async function remove(id: string) {
    if (!confirm("Delete this asset?")) return;
    await apiDelete(`/api/assets/${id}`);
    refresh();
  }

  return (
    <div>
      <PageHeader
        title="Video library"
        description="Your original media. Platforms rarely expose downloadable originals, so upload once and reuse."
        action={
          <>
            <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={onFile} />
            <Button className="gap-2" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload video
            </Button>
          </>
        }
      />

      {uploadMsg && <div className="mb-4 rounded-lg border bg-accent/40 px-4 py-2.5 text-sm">{uploadMsg}</div>}

      {unmatched.length > 0 && (
        <Card className="mb-5 border-warning/40">
          <CardContent className="p-4">
            <p className="mb-2 text-sm font-medium">Detected posts awaiting a source video ({unmatched.length})</p>
            <div className="space-y-2">
              {unmatched.slice(0, 5).map((p: any) => (
                <div key={p.id} className="flex items-center gap-3 text-sm">
                  <PlatformIcon platform={p.platform} size="sm" />
                  <span className="min-w-0 flex-1 truncate">{p.title || p.caption || p.providerPostId}</span>
                  {matchFor === p.id ? (
                    <Select className="w-56" onChange={(e) => e.target.value && matchAsset(e.target.value, p.id)} defaultValue="">
                      <option value="">Choose an asset…</option>
                      {assets.map((a: any) => <option key={a.id} value={a.id}>{a.title || a.originalName}</option>)}
                    </Select>
                  ) : (
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setMatchFor(p.id)}><Link2 className="h-3.5 w-3.5" /> Match</Button>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="relative mb-4 max-w-xs">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search library…" className="pl-8" />
      </div>

      {loading && !data ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : assets.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <Film className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No videos yet. Upload your first original.</p>
        </CardContent></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {assets.map((a: any) => (
            <Card key={a.id}>
              <CardContent className="p-4">
                <div className="mb-3 flex aspect-video items-center justify-center rounded-lg bg-secondary">
                  <Film className="h-8 w-8 text-muted-foreground" />
                </div>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{a.title || a.originalName}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDuration(a.durationSec)} · {a.aspectRatio || "—"} · {a.uploadComplete ? "Ready" : "Uploading"}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => remove(a.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
                {a.publishJobs?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {a.publishJobs.slice(0, 4).map((j: any) => (
                      <Badge key={j.id} variant="outline" className="gap-1"><PlatformIcon platform={j.destinationPlatform} size="sm" className="!h-3 !w-3 !rounded-sm" />{j.status}</Badge>
                    ))}
                  </div>
                )}
                <p className="mt-2 text-xs text-muted-foreground">Added {formatRelative(a.createdAt)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
