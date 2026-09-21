import { useRef } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { i18n } from "@/shared/i18n/config";
import { BrandLockup } from "@/shared/ui/brand-lockup";
import { GitHubLink } from "./github-link";
import { LandingPrimaryNavigation } from "./landing-primary-navigation";
import { isCurrentDestination } from "./navigation-destination";
import { LanguageToggle } from "@/shared/ui/language-toggle";
import { ThemeToggle } from "@/shared/ui/theme-toggle";
import { useLandingNavbarMorph } from "./use-landing-navbar-morph";
import "./landing-navbar.css";

const heroId = "landing-hero";

interface LandingNavbarProps {
  readonly lang: string;
  /**
   * Render the site-wide language control (default `true`).
   *
   * It swaps the locale prefix of the current path, so it cannot know whether
   * the target page exists. A blog article does know: it renders its own
   * translation entry only when the other locale actually publishes the post,
   * and the article page therefore turns this control off rather than offer a
   * URL that answers 404.
   */
  readonly withLanguageToggle?: boolean;
}

/**
 * Three-zone product navigation: brand, primary destinations, and utilities.
 * The feature-local morph hook owns its Hero-driven scroll behavior.
 */
export function LandingNavbar({ lang, withLanguageToggle = true }: LandingNavbarProps) {
  const homePath = lang === i18n.defaultLanguage ? "/" : `/${lang}`;
  const { pathname } = useLocation();
  // The brand leads home, so it states the home destination — from the pathname,
  // like the primary navigation, so `/en` and `/` answer the same way.
  const onHome = isCurrentDestination(pathname, "home", i18n.languages);
  const navRef = useRef<HTMLElement>(null);
  useLandingNavbarMorph(navRef, heroId);

  return (
    <nav
      ref={navRef}
      className="landing-navbar fixed inset-x-0 top-0 z-50"
      aria-label="Main navigation"
    >
      <div className="landing-navbar__panel">
        <div className="landing-navbar__surface" aria-hidden="true" />
        <div className="landing-navbar__content mx-auto grid h-full w-full max-w-[1400px] grid-cols-[1fr_auto_1fr] items-center px-4 sm:px-6">
          <div className="justify-self-start">
            <Link
              to={homePath}
              activeOptions={{ exact: true }}
              aria-current={onHome ? "page" : undefined}
              className="inline-flex h-9 items-center rounded-lg text-fd-foreground transition-opacity hover:opacity-75"
            >
              <BrandLockup />
            </Link>
          </div>

          <LandingPrimaryNavigation lang={lang} />

          <div className="flex items-center justify-self-end gap-1">
            {withLanguageToggle ? <LanguageToggle lang={lang} /> : null}
            <ThemeToggle lang={lang} />
            <GitHubLink />
          </div>
        </div>
      </div>
    </nav>
  );
}
