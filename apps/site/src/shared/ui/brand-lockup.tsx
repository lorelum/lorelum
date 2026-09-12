import { appName } from "@/shared/brand/config";

/** Official Lorelum horizontal brand lockup with an explicit dark-theme variant. */
export function BrandLockup({ suffix, className }: { suffix?: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 leading-none ${className ?? ""}`}>
      <span className="sr-only">{appName}</span>
      <img
        src="/brand/lorelum-horizontal-light.svg"
        alt=""
        aria-hidden="true"
        width={403.32}
        height={96}
        className="block h-5 w-auto shrink-0 dark:hidden"
      />
      <img
        src="/brand/lorelum-horizontal-dark.svg"
        alt=""
        aria-hidden="true"
        width={403.32}
        height={96}
        className="hidden h-5 w-auto shrink-0 dark:block"
      />
      {suffix ? (
        <span className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-fd-muted-foreground">
          / {suffix}
        </span>
      ) : null}
    </span>
  );
}
