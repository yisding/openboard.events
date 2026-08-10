# M53 — Five public widgets + embed parity

| | |
|---|---|
| **Status** | IN PROGRESS — **MERGED (rev. 11 / PR #94)**, no active claim. All five public/embed surfaces are implemented over M32/M33's published-view queries — Sessions List, Agenda, Schedule Itinerary (anonymous localStorage star/My-Schedule + selected-session ICS export reusing M35's `buildFeed`), Speakers List, and Speaker Gallery — each with a direct `/e/[eventSlug]/**` route and a parity `/embed/[eventSlug]/**` route sharing the same component/query (no second publication predicate); `embeds.filters` widened to all five content types and read live from the DB on every request; the embeds admin page extended with filter/field-visibility controls per surface. No new migration — both `embeds.filters` and the 5-value `embed_content_type` enum pre-existed. Remaining before `DONE`: every named AC is a deployed/browser check not yet performed (search/filter/day/detail interactions, the star/reload/remove/ICS-download round trip through a real browser and calendar client, genuine cross-origin iframe embedding, phone/keyboard passes), and `e2e/public-widgets-parity.spec.ts` (an owned path) was not created. See [`../status.md`](../status.md). |
| **Workstream / executing agent** | WS-E (Agenda + Public/Embeds). |
| **Scheduled** | Post-R3 product-completeness wave. |
| **Size** | XL; split shared data contracts from surfaces/configurator. |
| **Paths owned** | `src/features/embeds/**`, `src/app/(public)/e/**`, `src/app/(embed)/**`, embed admin/API extensions, and `e2e/public-widgets-parity.spec.ts`. |

## Objective

Provide five distinct, anonymous public discovery surfaces—Sessions List, Speakers List, Agenda,
Schedule Itinerary, and Speaker Gallery—plus matching configurable embeds. Every surface uses the
same published DTOs, publication filters, event-timezone rules, and sixty-second freshness contract.

## Dependencies

- **Hard:** M32 published queries/leakage tests, M33 embed shell/header/config behavior, and M35
  calendar builder/export.
- M40's JSON links are additive output; they do not block the HTML surfaces.

## Shared contract additions

- Session speaker references include name, job title, company, headshot, and profile link.
- Speaker session references include title, start/end, room, track, and format.
- Embed content types cover all five surfaces; configs retain enabled/accent/theme/header and add
  content filters and field visibility.
- No surface reads raw sessions/contacts or implements its own publication predicate.

## Surface requirements

1. **Sessions List:** searchable cards, truncated/expandable description, full speaker identity, and
   Track/Format/Location filters.
2. **Speakers List:** surname-sorted searchable compact directory with bio and session detail.
3. **Agenda:** day/time/room structure, day navigation, and reversible detail with parent state
   preserved.
4. **Schedule Itinerary:** chronological day sections, anonymous localStorage stars, exact My
   Schedule filter, reload persistence, and selected-session iCal export.
5. **Speaker Gallery:** surname-sorted searchable photo grid with fallbacks and full profile plus
   session time/room detail.

Each type has a direct share URL, iframe snippet, and functional script snippet. Cross-origin
framing, resize, enable/disable serving, filters, and field visibility are configured through M33's
one config path.

## Acceptance criteria

- Reach five visibly distinct populated surfaces without authentication and exercise each named
  search/filter/day/detail interaction.
- Star two sessions, reload, see exactly two in My Schedule, remove one, and export valid calendar
  data containing only the remaining session.
- Compare one session and speaker across all five surfaces and organizer source: title, people,
  times, room, track, and format agree.
- Draft/unconfirmed/cross-event data remains absent from every direct and embedded surface.
- Generate and render all five embeds in the cross-origin scratch host; field/filter changes appear
  after save and disabled embeds serve the inert state.
- Phone and keyboard passes have no horizontal overflow, trapped focus, or lost return state.

## Guardrails

- One M32 publication-query layer and one component/data contract serve direct pages and embeds.
- Use `eventDayKey`/`formatInZone`; never compute grouping in the visitor's timezone.
- Rich HTML renders only through `RichTextView`; nullable fields use designed fallbacks.
- localStorage itinerary data stores stable session ids only and reconciles removed/unpublished ids.
- Calendar export reuses M35's builder; do not create a second ICS implementation.
