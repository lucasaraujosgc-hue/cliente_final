import { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";

function formatLeft(total: number) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

interface RateLimitNoticeProps {
  /** Epoch ms when the client may try again. */
  until: number;
  /** Called once the countdown reaches zero. */
  onExpire: () => void;
}

// Shown on the login screens after the server's rate limiter returns 429.
// Ticks every second and clears itself (via onExpire) when the wait is over.
export function RateLimitNotice({ until, onExpire }: RateLimitNoticeProps) {
  const [left, setLeft] = useState(() =>
    Math.max(0, Math.ceil((until - Date.now()) / 1000)),
  );
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setLeft(seconds);
      if (seconds <= 0) onExpireRef.current();
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [until]);

  if (left <= 0) return null;

  return (
    <div
      role="alert"
      className="mt-6 flex items-start gap-3 rounded-lg border border-warn/30 bg-warn-wash px-3.5 py-3 text-sm"
    >
      <Clock className="mt-0.5 size-4 shrink-0 text-warn" strokeWidth={2} />
      <div className="min-w-0">
        <p className="font-semibold text-ink">Limite de tentativas atingido</p>
        <p className="mt-0.5 text-muted">
          Muitas tentativas de acesso. Você poderá tentar de novo em{" "}
          <span className="font-semibold tabular-nums text-ink">
            {formatLeft(left)}
          </span>
          .
        </p>
      </div>
    </div>
  );
}

// Parses a 429 response body into an epoch-ms deadline. Falls back to 15 min
// when the server didn't send a usable `retryAfter`.
export function lockUntilFrom(retryAfter: unknown): number {
  const seconds = Number(retryAfter);
  return Date.now() + (seconds > 0 ? seconds : 15 * 60) * 1000;
}
