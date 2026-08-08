import type { Metadata } from "next";
import { AbstractsPage } from "@/features/submissions/abstracts-page";

export const metadata: Metadata = { title: "Abstracts" };
export default function Page() { return <AbstractsPage />; }
