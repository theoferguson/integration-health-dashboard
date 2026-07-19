/** Points string for a sparkline polyline, values mapped left→right, min→bottom. */
export function sparklinePoints(values: number[], width: number, height: number): string {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1; // flat series -> a centered line, not a divide-by-zero
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  return values
    .map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / range) * height).toFixed(1)}`)
    .join(' ');
}

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
}

/** Tiny inline-SVG trend line. Inherits color via currentColor. Renders nothing for <2 points. */
export function Sparkline({ values, width = 84, height = 24 }: SparklineProps) {
  if (values.length < 2) return null;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        points={sparklinePoints(values, width, height)}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        className="opacity-70"
      />
    </svg>
  );
}
