import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { SPEAKERS_DEEPLINK_PARAMS } from "@/shared/contracts";
import type { DashboardOverview } from "../index";

export function MissingAssetsAlert({ eventId, missing }: { eventId: string; missing: DashboardOverview["speakerTracking"]["missingAssets"] }) {
  if (missing.speakers === 0) return null;
  const missingParam = SPEAKERS_DEEPLINK_PARAMS.missing[2];
  return <Link className="dashboard-missing-alert" href={`/events/${eventId}/speakers?missing=${missingParam}`}>
    <AlertTriangle size={19} />
    <span><b>{missing.speakers} accepted {missing.speakers === 1 ? "speaker is" : "speakers are"} missing a bio or headshot</b> ({missing.bios} {missing.bios === 1 ? "bio" : "bios"}, {missing.headshots} {missing.headshots === 1 ? "headshot" : "headshots"})</span>
    <ArrowRight size={17} />
  </Link>;
}
