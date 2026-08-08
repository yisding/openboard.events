import { PublicSpeakers } from "@/features/public/public-speakers";
import { parseEmbedOptions } from "../embed-options";

export default async function Page({ params, searchParams }: { params: Promise<{ eventSlug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { eventSlug } = await params;
  return <PublicSpeakers eventSlug={eventSlug} embed embedOptions={parseEmbedOptions(await searchParams)} />;
}
