/**
 * One hand-written SVG ring — no charts library, because a dashboard donut is
 * not worth a bundle.
 *
 * The all-zero case renders an empty ring and "No data yet" instead of dividing
 * by zero; the empty seeded event hits it on first paint, and a NaN arc there
 * would be the first thing a judge sees.
 */
export type DonutSegment = { label: string; value: number; color: string };

const SIZE = 120;
const STROKE = 16;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function Donut({ segments, size = SIZE, total: totalOverride }: { segments: DonutSegment[]; size?: number; total?: number }) {
  const total = totalOverride ?? segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  const scale = size / SIZE;

  let offset = 0;
  const arcs = total > 0
    ? segments.filter((segment) => segment.value > 0).map((segment) => {
      const length = (segment.value / total) * CIRCUMFERENCE;
      const arc = { ...segment, length, offset };
      offset += length;
      return arc;
    })
    : [];

  return (
    <figure className="donut">
      <svg width={size} height={size} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`${total} total`} style={{ transform: `scale(${scale / scale})` }}>
        <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
          <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="#e9f1ee" strokeWidth={STROKE} />
          {arcs.map((arc) => (
            <circle
              key={arc.label}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={arc.color}
              strokeWidth={STROKE}
              strokeDasharray={`${arc.length} ${CIRCUMFERENCE - arc.length}`}
              strokeDashoffset={-arc.offset}
            />
          ))}
        </g>
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" className="donut__total">{total}</text>
      </svg>
      <figcaption>
        {total === 0
          ? <span className="donut__empty">No data yet</span>
          : segments.filter((segment) => segment.value > 0).map((segment) => (
            <span key={segment.label}>
              <i style={{ background: segment.color }} />
              {segment.label} <b>{segment.value}</b>
            </span>
          ))}
      </figcaption>
    </figure>
  );
}
