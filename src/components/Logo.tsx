import { cn } from "../lib/utils";

type LogoSize = "sm" | "md" | "lg";

interface LogoProps {
  /** Use on dark backgrounds (accountant sidebar / login). */
  onDark?: boolean;
  size?: LogoSize;
  className?: string;
}

const SIZES: Record<LogoSize, { word: string; sub: string }> = {
  sm: { word: "text-xl", sub: "text-[9px]" },
  md: { word: "text-2xl md:text-[28px]", sub: "text-[10px] md:text-[11px]" },
  lg: { word: "text-3xl md:text-[34px]", sub: "text-[11px] md:text-[12px]" },
};

/**
 * "Vírgula," wordmark — the comma is the brand mark (vírgula = comma). Serif
 * (Fraunces) for the word, tracked uppercase sans for "Contábil". Replaces the
 * old lucide Calculator icon lockup.
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
            "font-serif font-bold tracking-tight",
            s.word,
            onDark ? "text-white" : "text-virgula-primary dark:text-white",
          )}
        >
          Vírgula
        </span>
        <span className={cn("font-serif font-bold leading-none text-virgula-accent", s.word)}>
          ,
        </span>
      </span>
      <span
        className={cn(
          "font-sans font-normal uppercase tracking-[0.3em] leading-none mt-0.5 ml-[0.2em]",
          s.sub,
          onDark ? "text-slate-400" : "text-virgula-muted dark:text-slate-400",
        )}
      >
        Contábil
      </span>
    </span>
  );
}
