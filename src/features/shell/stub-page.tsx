import type { LucideIcon } from "lucide-react";
import { EmptyState, PageHeader } from "@/shared/ui/ui-kit";

export function StubPage({ icon: Icon, title, description, milestone }: { icon: LucideIcon; title: string; description: string; milestone: string }) {
  return <div className="stub-page">
    <PageHeader title={title} description={description} />
    <div className="panel"><EmptyState icon={<Icon size={22} />} title={`${title} is under construction`} description={`This workspace ships with milestone ${milestone}. The route is reserved now so the shell never dead-ends.`} /></div>
  </div>;
}
