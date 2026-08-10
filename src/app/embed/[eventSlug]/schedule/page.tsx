import { redirect } from "next/navigation";

/**
 * Legacy embed route: superseded by five embeddable content types
 * (`sessions`, `agenda`, `itinerary`, `speakers`, `gallery`). "/schedule" was
 * previously the bare shell backed by the `schedule_itinerary` content type
 * (see M33), and `/itinerary` is the M53 surface that still reads that exact
 * content type — redirecting here, not to `/agenda`, is what keeps an
 * already-placed iframe's admin-configured kill switch and style pointed at
 * the same config row instead of silently reading a different, freshly
 * defaulted one. The style knobs (`accent`/`theme`/`header`) also travel on
 * the query string, so they must ride along on the redirect too, or a host
 * page's already-placed iframe reverts to unstyled defaults.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ eventSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { eventSlug } = await params;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const v of Array.isArray(value) ? value : [value]) if (v !== undefined) query.append(key, v);
  }
  const qs = query.toString();
  redirect(`/embed/${eventSlug}/itinerary${qs ? `?${qs}` : ""}`);
}
