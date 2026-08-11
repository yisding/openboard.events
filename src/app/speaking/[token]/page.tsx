import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getSpeakerShareData, verifySpeakerShareToken } from "@/features/portal/server/share";
import { SpeakerSharePage } from "@/features/portal/components/home/speaker-share-page";
import { getEnv } from "@/shared/lib/env";

export const dynamic = "force-dynamic";

/**
 * M59 — the "I'm speaking!" share page. Public, tokenized, no portal session
 * required: the whole point is a link a speaker pastes somewhere their
 * audience is not signed in. `cache()` dedupes the DB read `generateMetadata`
 * and the page body both need for the same request.
 */
const resolve = cache(async (token: string) => {
  const claims = await verifySpeakerShareToken(token);
  if (!claims) return null;
  return getSpeakerShareData(claims.eventId, claims.contactId);
});

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const data = await resolve(token);
  if (!data) return { title: "Speaker share link" };
  const title = `${data.speakerName} is speaking at ${data.eventName}`;
  const description = `"${data.submissionTitle}" — ${data.eventName}`;
  const base = getEnv().APP_BASE_URL;
  const imageUrl = data.headshotUrl ? new URL(data.headshotUrl, base).toString() : undefined;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "profile",
      ...(imageUrl ? { images: [{ url: imageUrl, width: 400, height: 400, alt: data.speakerName }] } : {}),
    },
    twitter: {
      card: imageUrl ? "summary" : "summary_large_image",
      title,
      description,
      ...(imageUrl ? { images: [imageUrl] } : {}),
    },
  };
}

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await resolve(token);
  if (!data) notFound();
  return <SpeakerSharePage data={data} />;
}
