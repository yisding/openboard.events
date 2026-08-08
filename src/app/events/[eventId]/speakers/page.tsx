import type { Metadata } from "next";
import { SpeakersPage } from "@/features/portal/speakers-page";

export const metadata: Metadata = { title: "Speakers" };
export default function Page(){return <SpeakersPage/>}
