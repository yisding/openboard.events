"use client";

import Link from "next/link";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#f7faf9", color: "#102e29", fontFamily: "Arial, sans-serif" }}>
        <main role="alert" aria-labelledby="global-error-title" style={{ minHeight: "100vh", display: "grid", placeContent: "center", justifyItems: "center", gap: 18, padding: 24, textAlign: "center", boxSizing: "border-box" }}>
          <Link href="/" aria-label="Openboard home" style={{ color: "#102e29", fontSize: 20, fontWeight: 700, textDecoration: "none" }}><span aria-hidden style={{ color: "#00a878" }}>◆</span> openboard</Link>
          <div>
            <p style={{ color: "#087356", fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>Temporary problem</p>
            <h1 id="global-error-title" style={{ margin: "8px 0", fontSize: 30 }}>Openboard needs a fresh start</h1>
            <p style={{ maxWidth: 520, margin: 0, color: "#55706a", lineHeight: 1.6 }}>The application shell could not finish loading. Try again, or return home and start from a clean page.</p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
            <button type="button" onClick={reset} style={{ minHeight: 42, padding: "0 18px", border: 0, borderRadius: 8, background: "#00a878", color: "#fff", font: "inherit", fontWeight: 700, cursor: "pointer" }}>Try again</button>
            <Link href="/" style={{ minHeight: 40, padding: "0 18px", border: "1px solid #bdd0cb", borderRadius: 8, color: "#102e29", display: "inline-flex", alignItems: "center", textDecoration: "none", fontWeight: 700 }}>Openboard home</Link>
          </div>
        </main>
      </body>
    </html>
  );
}
