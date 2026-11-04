import { Badge } from "@/components/ui";

const MAP: Record<string, { label: string; variant: "default" | "primary" | "success" | "warning" | "destructive" }> = {
  PENDING_APPROVAL: { label: "Awaiting approval", variant: "warning" },
  AWAITING_ASSET: { label: "Awaiting source video", variant: "warning" },
  SCHEDULED: { label: "Scheduled", variant: "primary" },
  QUEUED: { label: "Queued", variant: "primary" },
  PROCESSING: { label: "Processing", variant: "default" },
  UPLOADING: { label: "Uploading", variant: "default" },
  PUBLISHING: { label: "Publishing", variant: "default" },
  PUBLISHED: { label: "Published", variant: "success" },
  DRAFT_HANDOFF: { label: "Draft / handoff", variant: "warning" },
  FAILED: { label: "Failed", variant: "destructive" },
  CANCELLED: { label: "Cancelled", variant: "default" },
  // account statuses
  CONNECTED: { label: "Connected", variant: "success" },
  LIMITED: { label: "Limited", variant: "warning" },
  TOKEN_EXPIRED: { label: "Reconnect needed", variant: "destructive" },
  REVOKED: { label: "Revoked", variant: "destructive" },
  ERROR: { label: "Error", variant: "destructive" },
};

export function StatusBadge({ status }: { status: string }) {
  const c = MAP[status] ?? { label: status, variant: "default" as const };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}
