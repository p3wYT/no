import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { Shell } from "@/components/shell";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <Shell user={{ name: user.name, email: user.email }}>{children}</Shell>;
}
