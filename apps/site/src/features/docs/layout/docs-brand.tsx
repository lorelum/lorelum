import { Link } from "@tanstack/react-router";
import { BrandLockup } from "@/shared/ui/brand-lockup";

/**
 * The docs brand, rendered through fumadocs' `nav.title`.
 *
 * That slot accepts a component, which is what makes an accurate active state
 * possible here: the default title link marks itself active by prefix, so on
 * every `/zh/docs/**` page the brand to `/zh` was announced as `aria-current=
 * "page"` — and, in the sidebar, tinted as a current entry by `docs.css`. The
 * page the reader is on is `/zh/docs/…`, not `/zh`.
 */
export function DocsBrand({ href, className }: { href?: string; className?: string }) {
  return (
    <Link to={href ?? "/"} activeOptions={{ exact: true }} className={className}>
      <BrandLockup />
    </Link>
  );
}
