import { PortalExitLinks } from "@/features/portal/components/portal-exit-links";
import { Brand } from "@/shared/ui/brand";
import { LostCompass } from "@/shared/ui/lost-compass";

/**
 * The portal's own 404. The global one's only exit is "/", which drops a
 * signed-in speaker onto the marketing site and leaves them to remember the
 * portal URL; this one leads back into the event they were already working in.
 */
export default function PortalNotFound() {
  return (
    <main className="not-found">
      <Brand dark />
      <LostCompass />
      <span>404</span>
      <h1>That page isn’t in this portal.</h1>
      <p>The link may have changed, or the organizers haven’t published this page yet.</p>
      <PortalExitLinks />
    </main>
  );
}
