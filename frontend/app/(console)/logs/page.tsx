import { FileText } from "lucide-react";
import { ComingSoon } from "@/components/layout/coming-soon";

export default function LogsPage() {
  return (
    <ComingSoon
      icon={<FileText />}
      phase={5}
      title="Logs"
      description="A unified timeline of control-center events and job output."
      features={[
        "Audit log of power actions and config changes",
        "Live tail of job stdout / stderr",
        "Server connectivity history",
        "Filter by server, job and severity",
      ]}
    />
  );
}
