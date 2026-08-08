import type { Metadata } from "next";
import { TasksAdminPage } from "@/features/portal/tasks-admin-page";

export const metadata: Metadata={title:"Tasks"};export default function Page(){return <TasksAdminPage/>}
