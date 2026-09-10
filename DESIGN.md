---
version: alpha
name: Lorelum
description: A precise, luminous design system for engineering knowledge infrastructure.
colors:
  primary: "#35B88F"
  brand-deep: "#137C65"
  brand-light: "#65D5A5"
  light-background: "#F8F9FA"
  light-foreground: "#202326"
  light-surface: "#FFFFFF"
  light-surface-raised: "#F0F1F2"
  light-surface-sunken: "#E9ECEF"
  light-muted-foreground: "#656C73"
  light-border: "#DFE2E5"
  light-border-strong: "#B4BCC4"
  light-primary: "#168263"
  light-primary-foreground: "#FFFFFF"
  light-primary-hover: "#127457"
  light-primary-pressed: "#0F644C"
  light-accent: "#EEF0F2"
  light-accent-foreground: "#176E55"
  light-destructive: "#B43939"
  light-destructive-foreground: "#FFFFFF"
  dark-background: "#141618"
  dark-foreground: "#F0F2F4"
  dark-surface: "#1C1F22"
  dark-surface-raised: "#262A2E"
  dark-surface-sunken: "#101214"
  dark-muted-foreground: "#A4ACB4"
  dark-border: "#363C42"
  dark-border-strong: "#59636D"
  dark-primary-foreground: "#10251E"
  dark-primary-hover: "#48C39C"
  dark-primary-pressed: "#2FAA83"
  dark-accent: "#2A2E33"
  dark-accent-foreground: "#F0F2F4"
  dark-destructive: "#F29E9E"
  dark-destructive-foreground: "#351619"
  success-light: "#246C46"
  success-dark: "#89D3A5"
  warning-light: "#845615"
  warning-dark: "#E6BC74"
  info-light: "#355F9B"
  info-dark: "#A6C5F2"
typography:
  display:
    fontFamily: Bricolage Grotesque
    fontSize: 3.5rem
    fontWeight: 600
    lineHeight: 3.75rem
    letterSpacing: 0em
  headline:
    fontFamily: Bricolage Grotesque
    fontSize: 2.5rem
    fontWeight: 600
    lineHeight: 2.75rem
    letterSpacing: 0em
  title:
    fontFamily: Bricolage Grotesque
    fontSize: 1.5rem
    fontWeight: 600
    lineHeight: 2rem
    letterSpacing: 0em
  title-sm:
    fontFamily: Bricolage Grotesque
    fontSize: 1.125rem
    fontWeight: 600
    lineHeight: 1.5rem
    letterSpacing: 0em
  body:
    fontFamily: Manrope
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.625rem
    letterSpacing: 0em
  body-sm:
    fontFamily: Manrope
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.25rem
    letterSpacing: 0em
  label:
    fontFamily: Manrope
    fontSize: 0.875rem
    fontWeight: 500
    lineHeight: 1.25rem
    letterSpacing: 0em
  caption:
    fontFamily: Manrope
    fontSize: 0.75rem
    fontWeight: 500
    lineHeight: 1rem
    letterSpacing: 0em
  code:
    fontFamily: JetBrains Mono
    fontSize: 0.8125rem
    fontWeight: 400
    lineHeight: 1.25rem
    letterSpacing: 0em
rounded:
  detail: 0.375rem
  control: 0.75rem
  panel: 1.25rem
  stage: 2rem
  full: 9999px
spacing:
  inline: 0.5rem
  related: 0.75rem
  control: 1rem
  group: 1.5rem
  panel: 2rem
  block: 3rem
  section: 6rem
  content-width: 75rem
components:
  button-primary:
    backgroundColor: "{colors.light-primary}"
    textColor: "{colors.light-primary-foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: 1rem
    height: 2.5rem
  button-primary-hover:
    backgroundColor: "{colors.light-primary-hover}"
  button-primary-pressed:
    backgroundColor: "{colors.light-primary-pressed}"
  button-primary-dark:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.dark-primary-foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: 1rem
    height: 2.5rem
  button-primary-dark-hover:
    backgroundColor: "{colors.dark-primary-hover}"
  button-primary-dark-pressed:
    backgroundColor: "{colors.dark-primary-pressed}"
  button-ghost:
    textColor: "{colors.light-foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: 0.75rem
    height: 2.5rem
  button-ghost-hover:
    backgroundColor: "{colors.light-accent}"
    textColor: "{colors.light-accent-foreground}"
  badge:
    backgroundColor: "{colors.light-surface-raised}"
    textColor: "{colors.light-foreground}"
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
    padding: 0.5rem
    height: 1.5rem
  separator:
    backgroundColor: "{colors.light-border}"
    size: 1px
---

# Lorelum Design

## Overview

Lorelum should feel like serious infrastructure made visible: precise enough for repeated engineering work, yet luminous enough to make knowledge retrieval feel active rather than archival. The visual center of gravity is calm, structured, and premium. Expression comes from controlled light, directional flow, material depth, and exact alignment, not from decorative noise or generic AI motifs.

The approved mark moves from lower left to upper right. That direction suggests knowledge being retrieved, assembled, and handed to an agent at the moment of action. Preserve its geometry and use the same sense of directed momentum in diagrams and motion without turning every surface into an arrow.

## Colors

Neutral surfaces carry reading, comparison, and dense product work. Lorelum green identifies the brand and the primary action. It must not replace success, warning, error, or information semantics.

Light and dark themes are optically paired, not mechanically inverted. Light mode uses the deeper `light-primary` so white labels remain legible. Dark mode uses the brighter `primary` with a near-black green label. Hover and pressed values are explicit because changing opacity produces inconsistent contrast over different surfaces.

Gradients and emitted light may use `brand-deep`, `primary`, and `brand-light`, moving along the lower-left to upper-right axis. Keep text and small controls on solid semantic colors; gradients belong to brand moments, data flow, and large atmospheric fields.

## Typography

**Bricolage Grotesque** gives display and title text a recognizable editorial silhouette. **Manrope** carries UI and long-form reading with open counters and restrained geometry. **JetBrains Mono** is reserved for code, identifiers, terminal output, and measurements.

Use display type only where the product or a literal offer is the primary first-viewport signal. Product panels, cards, documentation, and navigation use title, body, label, and caption roles at their defined sizes. Do not shrink operational text to create density; reduce surrounding space instead.

## Layout

Layouts use a restrained eight-pixel rhythm with a four-pixel half-step only for optical correction. The named spacing roles describe relationships rather than arbitrary sizes: `inline` separates tightly coupled details, `related` separates siblings, `control` is control padding, `group` binds a local group, and larger roles divide panels, blocks, and sections.

Content is fluid until the 75rem reading stage. Fixed-format controls, grids, and visualizations need stable dimensions or aspect ratios so state changes do not shift the layout. On small screens, preserve readable type and interaction targets before preserving multi-column composition.

## Elevation & Depth

Depth comes first from tonal surfaces, then from blur and restrained shadow. Contact shadow anchors a control, lift shadow separates a panel, and overlay shadow belongs to transient layers. Avoid stacking several elevation signals on one object.

Glass is a presentation material, not the default container. It requires enough surface density to preserve contrast, and blur strength is independent from opacity. Lorelum glass has no decorative white rim. Gradients, texture, glow, and flowing light should strengthen hierarchy or direction; they must not compete with content.

## Shapes

The shape language balances engineered alignment with softened impact. Controls use the `control` radius, bounded panels use `panel`, and immersive stages may use `stage`. Pills are reserved for compact statuses, segmented choices, and truly capsule-shaped controls.

Do not wrap every section in a card or place cards inside cards. Large sections are full-width bands or unframed layouts. Repeated entities, modals, and genuinely bounded tools may use cards. Logo geometry is never stretched, rounded again, redrawn, or placed on an arbitrary decorative tile.

## Components

Buttons use semantic variants and explicit interaction states. Primary buttons identify the main command; secondary and outline buttons preserve hierarchy; ghost buttons serve compact utilities such as navbar controls. Icon-only buttons use familiar symbols, remain circular or square according to context, and always expose an accessible name.

Badges describe state or category and remain visually quieter than actions. Separators clarify structure but should not compensate for weak spacing. Components may accept layout classes from consumers, but their color, typography, radius, focus treatment, and state behavior remain system-owned.

Interactive components show a visible keyboard focus ring, use a pointer cursor when enabled, and retain sufficient target size and spacing on touch screens. Motion gives feedback quickly and may use a longer emphasized curve only for meaningful layout transitions.

## Do's and Don'ts

- Do use neutral hierarchy for most of the interface and reserve green for brand identity, primary action, focus, and directional emphasis.
- Do validate normal text and control labels at WCAG AA contrast in both themes.
- Do use optical alignment when strict geometry feels visibly off-center.
- Do keep page-specific animation and expressive materials subordinate to content and interaction.
- Don't add eyebrow labels, floating dots, ornamental microcopy, or section numbers merely to make a composition look designed.
- Don't use decorative white borders on glass, nested cards, gradient text for body copy, or several competing ambient backgrounds.
- Don't mix icon families, redraw familiar interface symbols, or pair an icon with redundant text in compact utility controls.
- Don't use raw palette values in product components when a semantic role exists.
