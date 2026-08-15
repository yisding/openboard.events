import { apiV1ErrorResponse, checkV1RateLimit, corsPreflight, data, notFoundResponse, publicEventDto, resolvePublicEvent } from "../../_lib";

export const dynamic = "force-dynamic";

export function OPTIONS() { return corsPreflight(); }

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    await checkV1RateLimit("event", request);
    const { slug } = await params;
    const event = await resolvePublicEvent(slug);
    return event ? data(publicEventDto(event)) : notFoundResponse();
  } catch (error) {
    return apiV1ErrorResponse(error, request);
  }
}
