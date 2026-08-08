import type { Metadata } from "next";
import { FormsPage } from "@/features/forms/forms-page";

export const metadata: Metadata = { title: "Forms" };
export default function Page() { return <FormsPage />; }
