import { PageHeader } from "@/components/page-header";
import { AutomationBuilder } from "@/components/automation-builder";

export default function NewAutomationPage() {
  return (
    <div>
      <PageHeader title="New automation" description="Define when to detect and where to cross-post." />
      <AutomationBuilder />
    </div>
  );
}
