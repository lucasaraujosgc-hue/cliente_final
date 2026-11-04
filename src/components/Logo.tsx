import { cn } from "../lib/utils";

type LogoSize = "sm" | "md" | "lg";

interface LogoProps {
  /** Use on dark backgrounds (accountant sidebar / login). */
  onDark?: boolean;
  size?: LogoSize;
  className?: string;
}

const SIZES: Record<LogoSize, { word: string; sub: string }> = {
  sm: { word: "text-lg", sub: "text-[8px]" },
  md: { word: "text-2xl md:text-[26px]", sub: "text-[10px] md:text-[11px]" },
  lg: { word: "text-[30px] md:text-[34px]", sub: "text-[11px] md:text-[12px]" },
};

/**
 * "Vírgula," wordmark — the comma is the brand mark (vírgula = comma).
 * Fraunces bold for the word + comma, tracked uppercase Inter for "Contábil",
 * which is centred under the word. This is the one place Fraunces is used.
 */
export function Logo({ onDark = false, size = "md", className }: LogoProps) {
  const s = SIZES[size];
  return (
    <span
      className={cn("inline-flex flex-col items-center select-none leading-none", className)}
      aria-label="Vírgula Contábil"
    >
      <span className="flex items-baseline">
        <span
          className={cn(
            "font-brand font-bold tracking-tight",
            s.word,
            onDark ? "text-white" : "text-wordmark",
          )}
        >
          Vírgula
        </span>
        <span className={cn("font-brand font-bold leading-none text-wordmark-comma", s.word)}>
          ,
        </span>
      </span>
      <span
        className={cn(
          "font-sans font-normal uppercase leading-none mt-0.5 ml-[0.3em] tracking-[0.3em]",
          s.sub,
          onDark ? "text-white/55" : "text-wordmark-sub",
        )}
      >
        Contábil
      </span>
    </span>
  );
}
