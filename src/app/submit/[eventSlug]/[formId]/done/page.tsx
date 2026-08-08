import { SubmissionSuccess } from "@/features/forms/submission-success";

export default async function Page({ params, searchParams }: { params: Promise<{ eventSlug: string; formId: string }>; searchParams: Promise<{ code?: string }> }) {
  const route = await params; const query = await searchParams;
  return <SubmissionSuccess eventSlug={route.eventSlug} formId={route.formId} code={query.code ?? "SESS-NEW"} />;
}
