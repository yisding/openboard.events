import type { Metadata } from "next";
import { EvaluationPage } from "@/features/evaluation/evaluation-page";

export const metadata: Metadata = { title: "Evaluation" };
export default function Page(){return <EvaluationPage/>}
