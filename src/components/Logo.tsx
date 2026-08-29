import { cn } from "../lib/utils";

type LogoSize = "sm" | "md" | "lg";

interface LogoProps {
  /** Use on dark backgrounds (accountant sidebar / login). */
  onDark?: boolean;
  size?: LogoSize;
  className?: string;
}

const SIZES: Record<LogoSize, { word: string; sub: string; track: string }> = {
  sm: { word: "text-lg", sub: "text-[8px]", track: "tracking-[0.34em]" },
  md: { word: "text-[26px]", sub: "text-[10px]", track: "tracking-[0.36em]" },
  lg: { word: "text-[34px]", sub: "text-[11px]", track: "tracking-[0.38em]" },
};

/**
 * "Vírgula," wordmark — the comma is the brand mark (vírgula = comma). Fraunces
 * at a calm weight for the word, tracked uppercase sans for "Contábil".
 */
export function Logo({ onDark = false, size = "md", className }: LogoProps) {
  const s = SIZES[size];
  return (
    <span
      className={cn("inline-flex flex-col items-start select-none leading-none", className)}
      aria-label="Vírgula Contábil"
    >
      <span className="flex items-baseline">
        <span
          className={cn(
            "font-serif font-medium",
            s.word,
            onDark ? "text-white" : "text-virgula-primary",
          )}
        >
          Vírgula
        </span>
        <span className={cn("font-serif font-medium leading-none text-gold", s.word)}>,</span>
      </span>
      <span
        className={cn(
          "font-sans font-semibold uppercase leading-none mt-1 ml-[0.15em]",
          s.sub,
          s.track,
          onDark ? "text-white/55" : "text-faint",
        )}
      >
        Contábil
      </span>
    </span>
  );
}
