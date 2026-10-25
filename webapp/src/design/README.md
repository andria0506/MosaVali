# MosaVali design system

Tokens live in `tailwind.config.js`. You can see them rendered at `/design`.

## Principles
- **One idea per screen.** One big number, a short explanation, then details.
- **Colors carry meaning.** `accent` (green) means safe, protected or on track. `caution` (amber) means above your risk capacity or needs attention. There is no red: normal market moves are not alarming.
- **Mostly black and white.** Landing pages use `paper` with dark `night` sections and devices. App screens use `night` surfaces (`night-1` cards, `night-3` tracks).

## Type
- FiraGO, with Noto Sans Georgian and system sans as fallbacks. Self-hosted through @fontsource, so it works offline in the PWA.
- Display sizes are light (300) with tight tracking. On `:lang(ka)`, leading opens to 1.14 so Georgian ascenders and descenders don't collide.
- Never use `uppercase` on Georgian, because it turns Mkhedruli into Mtavruli. The CSS neutralises it under `:lang(ka)`.
- No automatic hyphenation. Buttons and cards wrap whole words (`text-balance`).
- Figures use `.num` (tabular numbers). Money comes from `useI18n().money()`, which gives "6 300 ₾" in Georgian and "₾6,300" in English.

## Layout
- Design at 390px first. Tap targets are at least 44px (`min-h-tap`).
- Cards use `rounded-card` (24px) or `rounded-card-lg` (32px), with a 1px `line-night` border on dark.
- Sections are separated by `py-section`. The page width is `max-w-page` (1280px).
- Motion is limited to `animate-fade-up` / `<Reveal>` and the hero's scroll-linked phone stage. All of it respects `prefers-reduced-motion`.
