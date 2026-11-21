# Kanso — "Dispatch Console" redesign (0.3.0)

Date: 2026-11-22. Status: agreed with the user (direction A + UX package 1–8).
Russian original: `docs/redesign.md`.

## Goal

Radical redesign of the web board plus human-friendly UX: the tool should look like
a dispatch console for agent tasks, not another dark kanban.

## Visual language

Tactical Telemetry / CRT terminal (industrial brutalism, dark archetype).

- Substrate `#0a0a0a`, surfaces `#0f0f0f`–`#1a1a1a`, lines `#262626`/`#3a3a3a`.
- White-phosphor text `#eaeaea`; secondary `#c2c2c2`, `#9a9a9a`, `#7a7a7a` (contrast ≥ 4.5).
- Single accent: hazard red `#ff2a2a`. Terminal green `#4af626` is used in exactly
  one place: the active lease indicator.
- No border radius. Visible compartmentalization: 1px borders, column separators
  via `grid gap: 1px` over a line-colored background.
- Typography: Geist Mono dominates (metadata, nav, buttons, column headers,
  uppercase, tracking 0.08–0.12em, 10–11px). Geist Sans for task titles and body.
  Macro type: brand and empty board use Geist 800 uppercase, clamp(), leading ≤ 0.95.
- Textures: CRT scanlines and SVG grain as fixed pointer-events-none overlays.
  Hard offset shadows (no blur) on the drag ghost and dialogs only. No backdrop blur.
- ASCII framing: `[ + ]`, `×`, `≡`, `→`, `✓`, `>` prompt in search. SVG icons removed.
- Hazard stripes (45deg red/transparent) are semantic: expired lease,
  needs_decision, canceled column.
- Column status squares: outlined; "In progress" filled red with a pulse;
  "Done" filled gray. Project/label colors stay (functional encoding).
- z-index scale: drop 40, toast 50, overlay 60, ghost 1000.
- Motion: transform/opacity only, 160–380ms, stepped lease blink;
  everything disabled under prefers-reduced-motion. View transitions and moveBefore kept.

## Preserved

IA (sidebar + columns + drawer), all test seams, RU/EN i18n key parity,
drag&drop with ghost and Alt+arrows, SSE, closedby=any + fallback, card map focus preservation.

## UX package

1. **Command palette** `Ctrl/Cmd+K`: create task, jump to project, filters
   (label, priority, leased), sort, density, language, help, reset filters.
   dialog + listbox, arrows/Enter/Esc, aria-activedescendant. "Menu" button in the toolbar.
2. **Filters and sort**: toolbar above the board with label/priority selects, a
   "Leased" toggle, sort select (manual/priority/updated/created), "Reset".
   Sort and density persist in localStorage. Clicking a card label sets the filter.
3. **Hotkeys**: `/` search, `N`/`C` new task, `?` help, `Ctrl+K` palette,
   arrows move focus across cards, `Enter` opens the drawer, `1–5` set the focused
   card's status, `Alt`+arrows move (existing). Shortcut cheat-sheet dialog.
4. **Lease as telemetry**: green square + `T-MM:SS` countdown on the card (1s tick),
   expiry turns red with hazard stripes. Drawer shows owner, countdown, touched paths.
5. **Onboarding**: empty board with macro headline, CTA, CLI hint, hotkey row;
   meaningful empty-column hints; help on `?`.
6. **Inline editing**: double-click a card title (or drawer title) → input,
   Enter/blur saves via PATCH, Esc cancels. Priority is a native select on the card.
   Drawer gets a priority select and label toggles (PATCH).
7. **Toasts + undo**: "Cancel task" in the drawer → canceled + toast with "Undo"
   (move back). Errors are inline toasts, never alert().
8. **Density**: COMPACT/COMFORT toggle in the toolbar, body class, persisted.

## Boundaries

No dependencies, bundler, or frameworks. Backend unchanged (PATCH already supports
title/body/priority/labels/branch; DELETE is forbidden, cancel = canceled status).
New strings live only in web/locales/{ru,en}.json with identical key sets.

## Acceptance

- `npm test` green (including key parity and version).
- Browser: palette, filters, sort, hotkeys, lease countdown, inline edit,
  cancel undo, density, RU/EN, drag&drop, mobile layout, reduced motion.
- Text contrast ≥ 4.5:1, visible focus rings, zero radius, single accent.
- semgrep clean. Docs and CHANGELOG updated.