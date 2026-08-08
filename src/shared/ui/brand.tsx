import Link from "next/link";

export function Brand({ dark = false, compact = false }: { dark?: boolean; compact?: boolean }) {
  return (
    <Link href="/" className={`brand ${dark ? "brand-dark" : ""}`} aria-label="Openboard home">
      <span className="brand-mark"><i /><i /><i /></span>
      {!compact && <span>openboard</span>}
    </Link>
  );
}
