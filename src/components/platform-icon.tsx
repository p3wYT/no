import { cn } from "@/lib/utils";

type Platform = "TIKTOK" | "INSTAGRAM" | "YOUTUBE";

const CONFIG: Record<Platform, { label: string; bg: string; glyph: React.ReactNode }> = {
  TIKTOK: {
    label: "TikTok",
    bg: "bg-black text-white",
    glyph: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-1/2 w-1/2">
        <path d="M19.3 7.3a5.4 5.4 0 0 1-3.8-1.6 5.4 5.4 0 0 1-1.5-3.1V2h-3.3v12.8a2.6 2.6 0 1 1-2.6-2.6c.26 0 .5.04.74.1V8.9a6 6 0 0 0-.74-.05A5.9 5.9 0 1 0 14 14.7V9.1a8.7 8.7 0 0 0 5.3 1.8V7.3z" />
      </svg>
    ),
  },
  INSTAGRAM: {
    label: "Instagram",
    bg: "bg-gradient-to-br from-[#f58529] via-[#dd2a7b] to-[#8134af] text-white",
    glyph: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-1/2 w-1/2">
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  YOUTUBE: {
    label: "YouTube",
    bg: "bg-[#ff0000] text-white",
    glyph: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-1/2 w-1/2">
        <path d="M23 12s0-3.1-.4-4.6a2.4 2.4 0 0 0-1.7-1.7C19.4 5.3 12 5.3 12 5.3s-7.4 0-8.9.4A2.4 2.4 0 0 0 1.4 7.4C1 8.9 1 12 1 12s0 3.1.4 4.6a2.4 2.4 0 0 0 1.7 1.7c1.5.4 8.9.4 8.9.4s7.4 0 8.9-.4a2.4 2.4 0 0 0 1.7-1.7C23 15.1 23 12 23 12zM9.8 15.3V8.7l6 3.3-6 3.3z" />
      </svg>
    ),
  },
};

export function PlatformIcon({ platform, className, size = "md" }: { platform: Platform; className?: string; size?: "sm" | "md" | "lg" }) {
  const c = CONFIG[platform];
  const dim = size === "sm" ? "h-6 w-6" : size === "lg" ? "h-11 w-11" : "h-9 w-9";
  return (
    <span className={cn("inline-flex items-center justify-center rounded-lg", dim, c.bg, className)} title={c.label} aria-label={c.label}>
      {c.glyph}
    </span>
  );
}

export function platformLabel(platform: Platform) {
  return CONFIG[platform].label;
}
