import { redirect } from "next/navigation";

/**
 * Legacy embed route: superseded by five embeddable content types
 * (`sessions`, `agenda`, `itinerary`, `speakers`, `gallery`). "/schedule" was
 * previously the bare shell backed by the `schedule_itinerary` content type
 * (see M33), and `/itinerary` is the M53 surface that still reads that exact
 * content type — redirecting here, not to `/agenda`, is what keeps an
 * already-placed iframe's admin-configured kill switch and style pointed at
 * the same config row instead of silently reading a different, freshly
 * defaulted one. Style now comes from that config row rather than the query
 * string (the caching-regression fix, status.md rev. 11), so forwarding the
 * incoming query string is only for any other param a host page's snippet
 * happens to carry — it is otherwise a harmless no-op.
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
