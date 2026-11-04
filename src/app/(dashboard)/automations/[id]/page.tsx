import { PageHeader } from "@/components/page-header";
import { AutomationBuilder } from "@/components/automation-builder";

export default async function EditAutomationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div>
      <PageHeader title="Edit automation" description="Update routing, timing, captions and conditions." />
      <AutomationBuilder automationId={id} />
    </div>
  );
}
