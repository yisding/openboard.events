import { AdminShell } from "@/features/shell/admin-shell";

export default function EventLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
