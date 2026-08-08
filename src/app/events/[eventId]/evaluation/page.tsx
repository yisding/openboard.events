import type { Metadata } from "next";
import { EvaluationPage } from "@/features/evaluation/evaluation-page";

export const metadata: Metadata = { title: "Evaluation" };
export default async function Page({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return <EvaluationPage eventId={eventId} />;
}
