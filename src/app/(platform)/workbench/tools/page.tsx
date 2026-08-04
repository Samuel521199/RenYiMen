import { WorkflowStudio } from "@/components/WorkflowForm/WorkflowStudio";

export default function WorkbenchToolsPage() {
  return (
    <div className="h-full min-h-0 flex-1">
      <WorkflowStudio embedded />
    </div>
  );
}
