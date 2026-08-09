import { corsPreflight, data, notFoundResponse, publicEventDto, resolvePublicEvent } from "../../_lib";

export const dynamic = "force-dynamic";

export function OPTIONS() { return corsPreflight(); }

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await resolvePublicEvent(slug);
  return event ? data(publicEventDto(event)) : notFoundResponse();
}
