import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/features/auth";
import { getEvent } from "@/features/events";
import { getSpeakerFilterCounts, listContacts, type ContactFilters } from "@/features/portal";
import { SpeakersAdminView } from "@/features/portal/components/speakers-admin/speakers-admin-view";
import { parseSpeakerMissing } from "@/features/portal/speaker-deep-links";
import { contactIdSchema, eventIdSchema, SPEAKERS_DEEPLINK_PARAMS } from "@/shared/contracts";
import { pageNumberFrom } from "@/shared/lib/page-query";

export const metadata: Metadata = { title: "Speakers" };
export const dynamic = "force-dynamic";

function firstOf(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isConfirmationParam(value: string | undefined): value is ContactFilters["confirmation"] & string {
  return value !== undefined && (SPEAKERS_DEEPLINK_PARAMS.confirmation as readonly string[]).includes(value);
}

function isSortParam(value: string | undefined): value is NonNullable<ContactFilters["sort"]> {
  return value !== undefined && (SPEAKERS_DEEPLINK_PARAMS.sort as readonly string[]).includes(value);
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { eventId: rawEventId } = await params;
  const query = await searchParams;
  const requestedContact = firstOf(query.contactId);
  const requestedMissing = firstOf(query.missing);
  const missing = parseSpeakerMissing(requestedMissing);

  const eventId = eventIdSchema.parse(rawEventId);
  // The role is enforced here, not only in the layout: a client-side navigation
  // between sibling segments re-renders the page without re-running the layout,
  // so a reviewer already inside `/review` would otherwise soft-navigate into
  // the roster and join names back to codes (M50's closed reviewer surface).
  await requireAdmin(eventId, "organizer");

  // M38's dashboard links a specific speaker with `?contactId=` to open what
  // used to be a client-side drawer; that speaker now has its own route, and
  // this keeps the dashboard's existing links working without touching them.
  if (requestedContact) {
    const parsedContact = contactIdSchema.safeParse(requestedContact);
    if (parsedContact.success) redirect(`/events/${eventId}/speakers/${parsedContact.data}`);
  }

  const sortParam = firstOf(query.sort);
  const confirmationParam = firstOf(query.confirmation);
  const q = firstOf(query.q) ?? "";
  const page = pageNumberFrom(firstOf(query.page));

  const filters: ContactFilters = {
    ...(q ? { q } : {}),
    accepted: firstOf(query.accepted) === SPEAKERS_DEEPLINK_PARAMS.accepted[0],
    ...(missing ? { missing } : {}),
    ...(isConfirmationParam(confirmationParam) ? { confirmation: confirmationParam } : {}),
    sort: isSortParam(sortParam) ? sortParam : "name",
    dir: firstOf(query.dir) === "desc" ? "desc" : "asc",
    page,
    pageSize: 25,
  };

  // The flow drawer renders task due dates, and every rendered time in the
  // product is drawn in the *event's* zone — same read the speaker profile
  // page makes for the same reason.
  const [{ rows, total }, filterCounts, event] = await Promise.all([
    listContacts(eventId, filters),
    getSpeakerFilterCounts(eventId, {
      ...(filters.q ? { q: filters.q } : {}),
      ...(filters.confirmation ? { confirmation: filters.confirmation } : {}),
    }),
    getEvent(eventId),
  ]);

  return (
    <SpeakersAdminView
      eventId={eventId}
      timezone={event?.timezone ?? "America/Los_Angeles"}
      rows={rows}
      total={total}
      filterCounts={filterCounts}
      page={filters.page ?? 1}
      pageSize={filters.pageSize ?? 25}
      q={filters.q ?? ""}
      accepted={filters.accepted ?? false}
      missing={filters.missing ?? null}
      confirmation={filters.confirmation ?? null}
      sort={filters.sort ?? "name"}
      dir={filters.dir ?? "asc"}
    />
  );
}
