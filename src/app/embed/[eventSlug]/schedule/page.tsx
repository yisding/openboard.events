import { PublicSchedule } from "@/features/public/public-schedule";
import { parseEmbedOptions } from "../embed-options";

export default async function Page({ params, searchParams }: { params: Promise<{ eventSlug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { eventSlug } = await params;
  return <PublicSchedule eventSlug={eventSlug} embed embedOptions={parseEmbedOptions(await searchParams)} />;
}
