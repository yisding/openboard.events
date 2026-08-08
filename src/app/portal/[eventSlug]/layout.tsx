import { PortalProvider } from "@/features/portal/portal-context";
import { PortalShell } from "@/features/portal/portal-shell";

export default async function Layout({ children, params }: { children: React.ReactNode; params: Promise<{ eventSlug: string }> }) {
  const { eventSlug } = await params;
  return <PortalProvider eventSlug={eventSlug}><PortalShell>{children}</PortalShell></PortalProvider>;
}
