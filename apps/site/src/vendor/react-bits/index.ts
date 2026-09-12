/**
 * Barrel for the vendored React Bits animated components.
 *
 * Everything under this directory is third-party source copied from
 * reactbits.dev (MIT + Commons Clause) and lightly adapted to the site's
 * Fumadocs/Tailwind v4 theme. See each file's license header and
 * `apps/site/THIRD_PARTY_NOTICE.md` for provenance.
 *
 * Landing code should import these components through this barrel (or through
 * the `components/landing` wrappers) rather than reaching into individual
 * files, so a future upgrade or swap of the animation library touches exactly
 * one place. Components that carry an SSR/fine-pointer "safety gate" live in
 * `components/landing` under `motion-aware-*` names — prefer those when the
 * component is meant to be used in content that must stay readable without JS
 * or on touch devices.
 */

export { default as Aurora } from './aurora';
export { default as CountUp } from './count-up';
export { default as DecryptedText } from './decrypted-text';
export { default as LogoLoop, type LogoItem, type LogoLoopProps } from './logo-loop';
export { default as ScrollFloat } from './scroll-float';
export { default as SpecularButton, type SpecularButtonProps } from './specular-button';
export { default as SpotlightCard } from './spotlight-card';
export { default as TextType } from './text-type';
export { default as VariableProximity } from './variable-proximity';
