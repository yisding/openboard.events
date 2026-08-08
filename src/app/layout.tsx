import type { Metadata } from "next";
import "./globals.css";
import { DemoProvider } from "@/shared/demo/demo-provider";
import { ToastProvider } from "@/shared/ui/toast";

export const metadata: Metadata = {
  title: { default: "Openboard", template: "%s · Openboard" },
  description: "The calm command center for exceptional event programs.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <DemoProvider>
          <ToastProvider>{children}</ToastProvider>
        </DemoProvider>
      </body>
    </html>
  );
}
