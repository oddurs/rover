import { INSIGNIA_SVG, WORDMARK_SVG } from "@/lib/insignia";

/**
 * The agency badge, inlined from lib/insignia.ts so the interface and the
 * favicon are the same drawing. The markup is a constant in this repository —
 * nothing user-supplied ever reaches it.
 */
export function Insignia({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      className={`insignia ${className}`}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: INSIGNIA_SVG }}
    />
  );
}

/** The letters alone, for a line of type. Takes its colour from `currentColor`. */
export function Wordmark({ height = 14, className = "" }: { height?: number; className?: string }) {
  return (
    <span
      className={`insignia ${className}`}
      style={{ width: (height * 96) / 26, height }}
      dangerouslySetInnerHTML={{ __html: WORDMARK_SVG }}
    />
  );
}
