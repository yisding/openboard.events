import Link from "next/link";

export function Brand({ dark = false, compact = false, decorative = false }: { dark?: boolean; compact?: boolean; decorative?: boolean }) {
  const className = dark ? "brand brand-dark" : "brand";
  const content = (
    <>
      <span className="brand-mark"><i /><i /><i /></span>
      {!compact && <span>openboard</span>}
    </>
  );
  if (decorative) {
    return <span className={className} aria-hidden="true">{content}</span>;
  }
  return (
    <Link href="/" className={className} aria-label="Openboard home">
      {content}
    </Link>
  );
}
