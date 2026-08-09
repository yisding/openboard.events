import { PortalRouteShell } from "@/features/portal/portal-route-shell";

export default async function Layout({ children, params }: { children: React.ReactNode; params: Promise<{ eventSlug: string }> }) {
  const { eventSlug } = await params;
  return <PortalRouteShell eventSlug={eventSlug}>{children}</PortalRouteShell>;
}
