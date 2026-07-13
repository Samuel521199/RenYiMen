import { WorkflowStudio } from "@/components/WorkflowForm/WorkflowStudio";

export default function WorkbenchToolsPage() {
  return (
    <div className="min-h-full flex-1">
      <WorkflowStudio embedded />
    </div>
  );
}
