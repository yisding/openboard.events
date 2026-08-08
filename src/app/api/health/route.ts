export const dynamic = "force-dynamic";

export async function GET() {
  const started = performance.now();
  return Response.json({
    ok: true,
    service: "openboard-web",
    sha: "local",
    db: null,
    ms: Math.round(performance.now() - started),
    mode: "demo",
  });
}
