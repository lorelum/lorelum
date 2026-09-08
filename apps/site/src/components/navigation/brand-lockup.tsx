import { appName } from '@/lib/shared';

/** A single-colour mark for Lorelum's retrievable layers of context. */
export function BrandLockup({
  suffix,
  className,
}: {
  suffix?: string;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <svg viewBox="0 0 24 24" className="size-5 shrink-0" aria-hidden="true">
        <path d="M4.5 5.5 12 2l7.5 3.5L12 9 4.5 5.5Z" fill="currentColor" opacity="0.35" />
        <path d="M4.5 10.25 12 6.75l7.5 3.5L12 13.75l-7.5-3.5Z" fill="currentColor" opacity="0.65" />
        <path d="M4.5 15 12 11.5l7.5 3.5L12 18.5 4.5 15Z" fill="currentColor" />
      </svg>
      <span className="font-display text-[15px] font-semibold tracking-[-0.02em]">{appName}</span>
      {suffix ? (
        <span className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-fd-muted-foreground">
          / {suffix}
        </span>
      ) : null}
    </span>
  );
}
