import { Star } from 'lucide-react';
import { gitConfig } from '@/shared/config/git';

const starCount = 14;

/** Official GitHub mark; brand icons are not substituted with generic icons. */
export function GitHubLink() {
  const href = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={`GitHub, ${starCount} stars`}
      className="landing-navbar__github-link"
    >
      <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true">
        <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.72-1.55-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18.92-.26 1.91-.39 2.89-.39.98 0 1.97.13 2.89.39 2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.66.41.35.78 1.05.78 2.12 0 1.53-.01 2.76-.01 3.14 0 .31.21.67.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5z" />
      </svg>
      <span className="landing-navbar__github-stars inline-flex items-center gap-1 border-l pl-2" aria-hidden="true">
        <Star className="size-3.5 fill-current text-current" />
        <span className="min-w-4 font-mono text-xs tabular-nums">{starCount}</span>
      </span>
    </a>
  );
}
