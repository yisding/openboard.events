import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/shared/ui/toast";
import { KonamiListener } from "@/shared/ui/konami";
import { ConsoleGreeting } from "@/shared/ui/console-greeting";
import { HistoryPositionTracker } from "@/shared/ui/app/unsaved-work-guard";

// Archivo ships a 100-900 weight axis, which the type scale in globals.css
// relies on: without a variable face every intermediate weight snaps to the
// nearest one the system font happens to have. next/font self-hosts the file
// at build time, so there is no request to a font CDN at runtime and no CSP
// entry to maintain.
const archivo = Archivo({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: { default: "Openboard", template: "%s · Openboard" },
  description: "The calm command center for exceptional event programs.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={archivo.variable}>
      <body>
        <ToastProvider><HistoryPositionTracker /><KonamiListener /><ConsoleGreeting />{children}</ToastProvider>
      </body>
    </html>
  );
}
