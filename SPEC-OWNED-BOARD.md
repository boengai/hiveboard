# HiveBoard: Owned Board — Technical Spec

> **Branch:** `feat/owned-board`
> **Status:** Draft → **Validated**
> **Date:** 2026-03-18 (validated: 2026-03-20)

## Overview

Replace the GitHub Projects V2 dependency with a **standalone Kanban board** that HiveBoard owns. The board becomes the primary interface — users create tasks on the board UI, and HiveBoard dispatches agents directly. GitHub is still the code host (PRs are created there), but the board, task state, and orchestration are fully self-contained.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Browser (localhost:5173)                           │
│  React + Vite + TanStack Router + Tailwind + Zustand │
│  ┌───────────┐ ┌──────────┐ ┌────────────────────┐ │
│  │ Board View│ │Task Drawer│ │ Agent Logs Viewer  │ │
│  └───────────┘ └──────────┘ └────────────────────┘ │
│         │  GraphQL + SSE (subscriptions)              │
└─────────┼───────────────────────────────────────────┘
          │
┌─────────▼───────────────────────────────────────────┐
│  API Server (localhost:8080)                         │
│  Bun + GraphQL Yoga                                  │
│  ┌──────────┐ ┌────────────┐ ┌───────────────────┐ │
│  │ Resolvers│ │Orchestrator│ │ GitHub PR Client   │ │
│  └──────────┘ └────────────┘ └───────────────────┘ │
│         │            │                               │
│  ┌──────▼────────────▼──────┐                       │
│  │    Bun SQLite (local)    │                       │
│  │  tmp/database/hiveboard.db │                       │
│  └──────────────────────────┘                       │
└─────────────────────────────────────────────────────┘
```

## Monorepo Structure (Bun Workspaces)

```
hiveboard/
├── package.json              # root — workspaces: ["packages/*"]
├── packages/
│   ├── api/                  # GraphQL API server
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.ts          # entry — starts GraphQL Yoga server
│   │   │   ├── schema/
│   │   │   │   ├── typeDefs.ts   # GraphQL SDL
│   │   │   │   └── resolvers.ts  # Query/Mutation/Subscription resolvers
│   │   │   ├── db/
│   │   │   │   ├── schema.ts     # SQLite table definitions (CREATE TABLE)
│   │   │   │   ├── migrate.ts    # Auto-migration on startup
│   │   │   │   ├── client.ts     # Bun SQLite singleton
│   │   │   │   └── ulid.ts       # ULID generation helper
│   │   │   ├── orchestrator/     # (moved from src/orchestrator/)
│   │   │   ├── agent/            # (moved from src/agent/)
│   │   │   ├── workspace/        # (moved from src/workspace/)
│   │   │   ├── github/           # slimmed — PR creation only
│   │   │   └── pubsub.ts         # in-memory pub/sub for subscriptions
│   │   └── tsconfig.json
│   └── web/                  # React frontend
│       ├── package.json
│       ├── index.html
│       ├── vite.config.ts
│       ├── src/
│       │   ├── main.tsx              # Entry: LazyMotion + RouterProvider + StrictMode
│       │   ├── App.tsx               # Root layout shell (header, main outlet)
│       │   ├── routes.tsx            # TanStack Router route tree definition
│       │   ├── index.css             # Tailwind directives + OKLCH design tokens
│       │   ├── components/
│       │   │   ├── common/           # Reusable UI primitives
│       │   │   │   ├── button/       # Button.tsx + barrel
│       │   │   │   ├── card/         # Card.tsx
│       │   │   │   ├── drawer/       # Single-component API wrapping vaul (direction="right")
│       │   │   │   ├── dialog/       # Wraps Radix Dialog (confirmations only)
│       │   │   │   ├── dropdown-menu/ # Wraps Radix DropdownMenu
│       │   │   │   ├── input/        # TextInput, TextAreaInput, SelectInput, SwitchInput
│       │   │   │   ├── form/         # FieldForm.tsx (universal form field controller)
│       │   │   │   ├── badge/        # Badge.tsx
│       │   │   │   ├── tabs/         # Animated tabs (Radix + Motion)
│       │   │   │   ├── markdown/     # MarkdownEditor + MarkdownPreview
│       │   │   │   ├── toast/        # Toast notification system
│       │   │   │   ├── sidebar/      # Slide-over navigation drawer
│       │   │   │   ├── output/       # CodeOutput.tsx (read-only log display)
│       │   │   │   ├── table/        # DataCellTable.tsx
│       │   │   │   ├── icon/         # Hand-rolled SVG icon components
│       │   │   │   └── error-boundary/
│       │   │   └── feature/          # Feature-specific components
│       │   │       ├── board/        # Board.tsx, Column.tsx, TaskCard.tsx
│       │   │       ├── task/         # TaskDrawer.tsx, TaskTimeline.tsx, TaskComments.tsx
│       │   │       └── agent/        # AgentLogStream.tsx, AgentStatusBadge.tsx
│       │   ├── constants/
│       │   │   └── route.ts          # ROUTE_PATH constants
│       │   ├── hooks/
│       │   │   ├── persist/          # Zustand stores WITH localStorage persistence
│       │   │   ├── state/            # Zustand stores WITHOUT persistence (ephemeral)
│       │   │   ├── useCopyToClipboard.ts
│       │   │   ├── useDebounce.ts
│       │   │   └── useDebounceCallback.ts
│       │   ├── pages/
│       │   │   └── home/index.tsx    # Board view (maps to `/`)
│       │   ├── store/
│       │   │   └── boardStore.ts     # Main Zustand board store
│       │   ├── graphql/
│       │   │   ├── client.ts         # graphql-request client
│       │   │   ├── queries.ts
│       │   │   ├── mutations.ts
│       │   │   └── subscriptions.ts
│       │   ├── types/
│       │   │   ├── components/       # Props types mirror component structure
│       │   │   ├── hooks/            # Store types
│       │   │   └── utils/
│       │   └── utils/
│       │       ├── tailwind-variants.ts  # Configured tv() and cnMerge()
│       │       └── validation.ts
│       └── tsconfig.json
├── src/                      # existing code (kept for migration, eventually removed)
├── WORKFLOW.md
└── tsconfig.json
```

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Runtime | Bun | Already used, native SQLite, fast |
| Monorepo | Bun workspaces | Zero config, built-in |
| API framework | GraphQL Yoga | Bun-native, subscriptions via SSE/WS built-in |
| Database | Bun SQLite (`bun:sqlite`) | Zero dependency, embedded, fast |
| Frontend build | Vite | Fast HMR, Bun-compatible |
| Routing | TanStack Router | Type-safe, file-based routing |
| State | Zustand | Lightweight, minimal boilerplate |
| Styling | Tailwind CSS v4 | Utility-first, fast |
| Theme | Linear-minimal + Bee palette | Clean, minimal UI with honey/amber accents |
| IDs | ULID (`ulid` package) | Time-sortable, no collision risk, works as TEXT PK |
| Drag & drop | @dnd-kit/core | Lightweight, accessible |
| GraphQL client | graphql-request + graphql-sse | Lightweight fetch client + SSE subscriptions |
| Real-time | GraphQL Subscriptions (SSE) | Built into Yoga, no extra server |

## Frontend Reference

> HiveBoard adopts its structure, styling system, component patterns, and tooling — adapted
> from `pnpm` to `bun` and from standalone app to monorepo workspace (`packages/web`).

### Reference Tech Stack

| Dependency | Version | Notes |
|------------|---------|-------|
| React | 19.2.4 | |
| Vite | 7.x | With `@tailwindcss/vite` plugin (not PostCSS) |
| TypeScript | 5.9.x | Strict mode |
| Tailwind CSS | 4.x | CSS-first config (v4), NOT JS config file |
| TanStack Router | 1.x | `@tanstack/react-router` with `lazyRouteComponent()` |
| Zustand | 5.x | Client + server state, with `zustand/middleware/persist` for localStorage |
| Motion | 12.x | `motion/react` (formerly Framer Motion) |
| Radix UI | latest | Raw primitives: dialog, dropdown-menu, select, switch, checkbox, tabs, toast, etc. |
| tailwind-variants | 3.x | `tv()` variant system — replaces `cva()` / shadcn pattern |
| vaul | 1.x | Drawer component — built on Radix Dialog, touch-friendly, direction support |
| @dnd-kit/core | latest | Drag-and-drop primitives (DndContext, useDroppable) |
| @dnd-kit/sortable | latest | Sortable list within columns (useSortable, SortableContext) |
| @dnd-kit/utilities | latest | CSS utilities for drag transforms |
| graphql-request | 7.x | Lightweight GraphQL fetch client (no cache layer — Zustand handles state) |
| graphql-sse | latest | SSE-based GraphQL subscription client (pairs with Yoga SSE transport) |
| react-markdown | latest | Render markdown preview (GFM support) |
| remark-gfm | latest | GitHub Flavored Markdown plugin (tables, task lists, strikethrough) |
| rehype-highlight | latest | Syntax highlighting in code blocks |

**NOT used** (divergence from common React setups):
- No shadcn/ui — we build our own components on Radix + tailwind-variants
- No TanStack Query — Zustand + graphql-request is sufficient; no need for separate cache layer
- No ESLint / Prettier — use Biome
- No icon library — hand-rolled SVG icon components
- No Context API for state — Zustand only
- No urql — graphql-request is simpler (no normalization/cache), subscriptions handled by graphql-sse

### Directory Structure Convention

```
packages/web/src/
├── main.tsx                        # Entry: LazyMotion + RouterProvider + StrictMode
├── App.tsx                         # Root layout shell (sidebar, header, main outlet)
├── routes.tsx                      # TanStack Router route tree definition
├── index.css                       # Tailwind directives + OKLCH design tokens
├── components/
│   ├── common/                     # Reusable UI primitives (our component library)
│   │   ├── button/
│   │   │   ├── Button.tsx          # tv() variants: size, color, block
│   │   │   └── index.ts           # Barrel re-export
│   │   ├── card/Card.tsx
│   │   ├── drawer/
│   │   │   ├── Drawer.tsx          # Single-component API wrapping vaul (same pattern as Dialog)
│   │   │   └── index.ts           # Re-exports: Drawer
│   │   ├── dialog/Dialog.tsx       # Wraps Radix Dialog (for confirmation dialogs, NOT for task views)
│   │   ├── dropdown-menu/          # Wraps Radix DropdownMenu
│   │   ├── input/                  # TextInput, TextAreaInput, SelectInput, SwitchInput
│   │   ├── form/FieldForm.tsx      # Universal form field controller (switches on type)
│   │   ├── badge/Badge.tsx
│   │   ├── tabs/Tabs.tsx           # Animated tabs (Radix + Motion)
│   │   ├── markdown/
│   │   │   ├── MarkdownEditor.tsx  # Write/Preview tabs (GitHub-style), textarea + rendered preview
│   │   │   ├── MarkdownPreview.tsx # react-markdown + remark-gfm + rehype-highlight renderer
│   │   │   └── index.ts
│   │   ├── toast/                  # Toast notification system
│   │   ├── sidebar/                # Slide-over navigation drawer
│   │   ├── output/CodeOutput.tsx   # Read-only code/log display
│   │   ├── table/DataCellTable.tsx
│   │   ├── icon/                   # Hand-rolled SVG icon components
│   │   └── error-boundary/
│   └── feature/                    # Feature-specific components (self-contained)
│       ├── board/                  # Board.tsx, Column.tsx, TaskCard.tsx
│       ├── task/                   # TaskDrawer.tsx (unified create + view), TaskTimeline.tsx, TaskComments.tsx
│       └── agent/                  # AgentLogStream.tsx, AgentStatusBadge.tsx
├── constants/
│   └── route.ts                    # ROUTE_PATH constants
├── hooks/
│   ├── persist/                    # Zustand stores WITH localStorage persistence
│   │   └── usePersistSettings.ts
│   ├── state/                      # Zustand stores WITHOUT persistence (ephemeral)
│   │   ├── useSidebarStore.ts
│   │   └── useToast.ts
│   ├── useCopyToClipboard.ts
│   ├── useDebounce.ts
│   └── useDebounceCallback.ts
├── pages/
│   └── home/index.tsx              # Board view (maps to `/`)
├── store/
│   └── boardStore.ts               # Main Zustand board store
├── graphql/
│   ├── client.ts
│   ├── queries.ts
│   ├── mutations.ts
│   └── subscriptions.ts
├── types/
│   ├── components/common/          # Props types mirror component structure
│   ├── hooks/                      # Store types
│   └── utils/
├── utils/
│   ├── tailwind-variants.ts        # Configured tv() and cnMerge() exports
│   └── validation.ts
└── (styles live in root src/index.css — no separate styles/ dir)
```

**Key rules:**
1. **Barrel exports everywhere** — every directory has an `index.ts` re-exporting
2. **Types separated** — all types live under `src/types/`, mirroring `src/` structure
3. **Named exports only** — `export const Button`, never `export default`
4. **One component per file** — `Button.tsx` contains only `Button`
5. **Feature components are self-contained** — manage own state, use common components

### Variant System — `tailwind-variants` (`tv()`)

> Replaces shadcn/ui's `cva()` + `cn()` pattern. Same concept, better Tailwind merge.

**Setup** (`src/utils/tailwind-variants.ts`):
```typescript
import { createTV, cnMerge as cnMergeFn, type TVConfig } from 'tailwind-variants'

const twMergeConfig: TVConfig = {
  twMerge: true,
  twMergeConfig: {
    extend: {
      classGroups: {
        'font-size': [
          { text: [{ body: ['xs', 'sm', 'lg', 'xl'], heading: ['1', '2', '3', '4', '5', '6'] }] },
        ],
      },
    },
  },
}

export const cnMerge = (...classes: Array<string>) => cnMergeFn(classes)(twMergeConfig)
export const tv = createTV(twMergeConfig)
```

**Component pattern** (example: Button):
```typescript
import { tv } from '@/utils/tailwind-variants'

const buttonVariants = tv({
  base: 'inline-flex items-center justify-center rounded-sm font-medium transition-colors',
  variants: {
    size: {
      small:   'h-8 px-3 text-body-sm',
      default: 'h-10 px-4 text-body-sm',
      large:   'h-12 px-6 text-body-lg',
    },
    color: {
      default:   'bg-gray-800 text-gray-100 hover:bg-gray-700',
      primary:   'bg-primary-600 text-white hover:bg-primary-500',
      secondary: 'bg-secondary-600 text-white hover:bg-secondary-500',
      error:     'bg-error-600 text-white hover:bg-error-500',
      success:   'bg-success-600 text-white hover:bg-success-500',
    },
    block: {
      true: 'w-full',
    },
  },
  defaultVariants: { size: 'default', color: 'default' },
})

export const Button = ({ size, color, block, className, ...props }: ButtonProps) => (
  <motion.button
    className={buttonVariants({ size, color, block, className })}
    whileHover={{ y: -2 }}
    whileTap={{ scale: 0.98 }}
    {...props}
  />
)
```

### Theme / Design Tokens (CSS-first, Tailwind v4)

> **Design philosophy:** Linear.app-inspired minimal UI — clean surfaces, subtle borders,
> generous whitespace, restrained color use. The accent palette is **Bee-themed**: honey gold
> and amber tones as primary, with warm neutrals instead of cold grays.
>

**`src/index.css` — Full theme:**
```css
@import 'tailwindcss';

/* ══════════════════════════════════════════════
   HiveBoard Theme — Linear-minimal + Bee palette
   ══════════════════════════════════════════════ */

/* ── Reset defaults ── */
@theme {
  --color-*: initial;
  --text-*: initial;
  --shadow-*: initial;
  --breakpoint-*: initial;
}

/* ── Typography ── */
@theme {
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;

  --text-heading-1: 2.25rem;
  --text-heading-2: 1.875rem;
  --text-heading-3: 1.5rem;
  --text-heading-4: 1.25rem;
  --text-heading-5: 1.125rem;
  --text-heading-6: 1rem;
  --text-body-xl: 1.25rem;
  --text-body-lg: 1.125rem;
  --text-body: 0.875rem;      /* 14px — Linear-style base */
  --text-body-sm: 0.8125rem;  /* 13px */
  --text-body-xs: 0.75rem;    /* 12px */
}

/* ── Bee Palette (OKLCH) ── */
@theme {
  /*
   * Neutrals — warm-tinted grays (slight yellow undertone, hue 80)
   * Linear uses near-pure grays; ours lean warm to match the honey accent.
   */
  --color-gray-50:  oklch(0.98 0.005 80);
  --color-gray-100: oklch(0.93 0.008 80);
  --color-gray-200: oklch(0.85 0.010 80);
  --color-gray-300: oklch(0.75 0.012 80);
  --color-gray-400: oklch(0.64 0.012 80);
  --color-gray-500: oklch(0.55 0.012 80);
  --color-gray-600: oklch(0.45 0.010 80);
  --color-gray-700: oklch(0.35 0.008 80);
  --color-gray-800: oklch(0.24 0.006 80);
  --color-gray-850: oklch(0.19 0.005 80);
  --color-gray-900: oklch(0.15 0.005 80);
  --color-gray-950: oklch(0.11 0.004 80);

  /*
   * Primary — Honey / Amber (hue ~85)
   * The "bee" accent. Used for primary buttons, active states, selected items.
   */
  --color-honey-50:  oklch(0.97 0.04 85);
  --color-honey-100: oklch(0.93 0.08 85);
  --color-honey-200: oklch(0.87 0.13 85);
  --color-honey-300: oklch(0.80 0.16 85);
  --color-honey-400: oklch(0.75 0.17 85);   /* primary accent */
  --color-honey-500: oklch(0.68 0.16 85);   /* hover / pressed */
  --color-honey-600: oklch(0.58 0.14 80);
  --color-honey-700: oklch(0.48 0.12 78);
  --color-honey-800: oklch(0.38 0.09 75);
  --color-honey-900: oklch(0.28 0.06 75);
  --color-honey-glow: oklch(0.75 0.17 85 / 0.15);  /* subtle glow for focus rings */

  /*
   * Semantic colors — muted to keep Linear-minimal feel
   */
  --color-success-400: oklch(0.72 0.15 165);  /* green — implement badge, success */
  --color-success-500: oklch(0.62 0.14 165);
  --color-error-400:   oklch(0.68 0.18 25);   /* red — failed, delete */
  --color-error-500:   oklch(0.58 0.17 25);
  --color-info-400:    oklch(0.70 0.14 240);   /* blue — running, links */
  --color-info-500:    oklch(0.60 0.13 240);
  --color-warning-400: oklch(0.78 0.15 70);    /* amber — queued, revise */
  --color-warning-500: oklch(0.68 0.14 70);
  --color-purple-400:  oklch(0.68 0.16 310);   /* purple — research badge */
  --color-purple-500:  oklch(0.58 0.15 310);
  --color-teal-400:    oklch(0.72 0.12 195);   /* teal — implement-e2e badge */
  --color-teal-500:    oklch(0.62 0.11 195);
}

/* ── Surfaces & Borders (Linear-style layering) ── */
@theme {
  /*
   * Linear uses very subtle surface layering with near-invisible borders.
   * 3 surface levels: page → raised → overlay
   */
  --color-surface-page:    var(--color-gray-950);   /* app background */
  --color-surface-raised:  var(--color-gray-900);   /* cards, columns, panels */
  --color-surface-overlay: var(--color-gray-850);   /* dropdowns, dialogs, hover */
  --color-surface-inset:   oklch(0.09 0.004 80);    /* input backgrounds */

  --color-border-default:  var(--color-gray-800);   /* subtle — like Linear */
  --color-border-hover:    var(--color-gray-700);   /* on hover */
  --color-border-active:   var(--color-honey-400);  /* focused / selected */

  --color-text-primary:    var(--color-gray-100);   /* headings, primary text */
  --color-text-secondary:  var(--color-gray-400);   /* descriptions, timestamps */
  --color-text-tertiary:   var(--color-gray-500);   /* placeholders, disabled */
  --color-text-on-accent:  var(--color-gray-950);   /* text on honey buttons */
}

/* ── Shadows (Linear-style: very subtle, blurred) ── */
@theme {
  --shadow-xs:  0 1px 2px oklch(0 0 0 / 0.2);
  --shadow-sm:  0 2px 4px oklch(0 0 0 / 0.2);
  --shadow-md:  0 4px 8px oklch(0 0 0 / 0.24);
  --shadow-lg:  0 8px 16px oklch(0 0 0 / 0.28);
  --shadow-xl:  0 16px 32px oklch(0 0 0 / 0.32);
  --shadow-glow-honey: 0 0 12px var(--color-honey-glow);
}

/* ── Breakpoints ── */
@theme {
  --breakpoint-tablet: 48rem;
  --breakpoint-laptop: 80rem;
  --breakpoint-desktop: 120rem;
}

/* ── Border Radius (Linear uses small, consistent radii) ── */
@theme {
  --radius-sm: 4px;
  --radius-md: 6px;     /* cards, buttons */
  --radius-lg: 8px;     /* dialogs, drawers */
  --radius-full: 9999px; /* pills, avatars */
}

/* ── Base Styles ── */
:root {
  color-scheme: dark;
  font-size: 14px;      /* Linear-style compact base */
}

body {
  font-family: var(--font-sans);
  background-color: var(--color-surface-page);
  color: var(--color-text-primary);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* ── Reduced Motion ── */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

### Design Principles (Linear-minimal)

1. **Restrained color** — Nearly monochrome surfaces. Honey accent used sparingly: primary buttons, active/selected states, focus rings. Most UI is gray-on-gray
2. **Subtle borders** — 1px borders at `border-default` (barely visible). Heavier borders only on hover/focus
3. **No heavy shadows** — Flat cards with border separation. Shadows only on floating elements (dropdowns, drawers, dialogs)
4. **Compact density** — 14px base font, tight line-heights, small padding. Information-dense like Linear
5. **Generous whitespace between sections** — Tight within components, spacious between them
6. **Muted semantic colors** — Success/error/info are desaturated (OKLCH chroma ~0.15). Not loud. Badges use soft backgrounds with slightly brighter text
7. **Honey accent hierarchy** — `honey-400` for primary actions, `honey-500` for hover, `honey-glow` for focus ring, `honey-100` for subtle highlights on selected rows

### Action Badge Colors (mapped to Bee palette)

| Action | Badge BG | Badge Text | Rationale |
|--------|----------|------------|-----------|
| plan | `info-400/15%` | `info-400` | Blue — thinking, planning |
| research | `purple-400/15%` | `purple-400` | Purple — exploration |
| implement | `success-400/15%` | `success-400` | Green — building |
| implement-e2e | `teal-400/15%` | `teal-400` | Teal — testing variant |
| revise | `warning-400/15%` | `warning-400` | Amber — revision needed |

### Agent Status Indicators

| Status | Indicator | Color |
|--------|-----------|-------|
| idle | Small gray dot | `gray-600` |
| queued | Pulsing amber dot | `honey-400` (pulse animation) |
| running | Spinning loader | `info-400` |
| success | Checkmark | `success-400` |
| failed | X mark | `error-400` |

### Drawer Convention (vaul)

> All slide-over panels use **vaul** (`direction="right"`) instead of custom drawer implementations.
> vaul is built on `@radix-ui/react-dialog` — inherits focus trapping, ESC close, aria attributes.
> Both **create task** and **view/edit task** use the same `TaskDrawer` component in different modes.

**Base Drawer wrapper** (`components/common/drawer/Drawer.tsx`):

Single-component API — consumers import only `<Drawer>`, never individual primitives.

```typescript
import { Drawer as VaulDrawer } from 'vaul'
import { m } from 'motion/react'

import type { CompVariant, DrawerProps, DrawerVariants } from '@/types'
import { tv } from '@/utils'

const overlayVariants = tv({
  base: 'fixed inset-0 z-40 bg-black/40 backdrop-blur-xs',
})

const contentVariants: CompVariant<DrawerVariants> = tv({
  base: [
    'fixed z-50 flex h-full flex-col bg-surface-raised border-l border-border-default outline-none',
    'data-[vaul-drawer-direction=right]:inset-y-0 data-[vaul-drawer-direction=right]:right-0',
  ],
  variants: {
    size: {
      default: 'w-[480px] max-w-[90vw]',   // task drawer
      narrow:  'w-[360px] max-w-[85vw]',   // settings, etc.
      wide:    'w-[640px] max-w-[95vw]',   // agent logs expanded
    },
  },
  defaultVariants: { size: 'default' },
})

export const Drawer = ({
  children,
  description,
  injected,
  onAfterClose,
  size = 'default',
  title,
  trigger,
}: DrawerProps) => {
  const contentClassName = contentVariants({ size })

  const handleOpenChange = (open: boolean) => {
    injected?.setOpen(open)
    if (!open) {
      onAfterClose?.()
    }
  }

  return (
    <VaulDrawer.Root direction="right" onOpenChange={handleOpenChange} open={injected?.open}>
      {trigger && <VaulDrawer.Trigger asChild>{trigger}</VaulDrawer.Trigger>}
      <VaulDrawer.Portal>
        <VaulDrawer.Overlay className={overlayVariants()} />
        <VaulDrawer.Content className={contentClassName}>
          <div className="flex w-full shrink-0 items-center gap-3 border-b border-border-default px-4 py-3">
            <VaulDrawer.Close asChild>
              <m.button
                className="size-3 shrink-0 rounded-full bg-error-400"
                transition={{ duration: 0.15, ease: 'easeOut' }}
                whileHover={{ opacity: 0.8, scale: 1.15 }}
                whileTap={{ scale: 0.9 }}
              >
                <span className="sr-only">Close</span>
              </m.button>
            </VaulDrawer.Close>
            <VaulDrawer.Title className="grow truncate text-body-sm text-text-secondary">
              {title}
            </VaulDrawer.Title>
            <VaulDrawer.Description className="hidden">
              {description ?? title}
            </VaulDrawer.Description>
          </div>
          <div data-vaul-no-drag className="flex size-full grow flex-col overflow-y-auto p-4">
            {children}
          </div>
        </VaulDrawer.Content>
      </VaulDrawer.Portal>
    </VaulDrawer.Root>
  )
}
```

**Usage** — consumers only import `Drawer`:
```tsx
<Drawer title="Create Task" injected={{ open, setOpen }}>
  <TaskForm />
</Drawer>

<Drawer title="View Task" size="wide" trigger={<button>Open</button>}>
  <TaskDetail />
</Drawer>
```

**Scrollable content**: The inner content area already has `data-vaul-no-drag` + `overflow-y-auto`,
so scrollable children work out of the box without extra wrappers.

**Unified TaskDrawer modes**:
- `mode="create"` — empty form, title input auto-focused, "Create Task" primary button
- `mode="view"` — read-only by default, Edit button to toggle inputs, Save/Cancel buttons
- Both modes share the same `<Drawer>` shell, passing different `title` and `children`

### Animation Convention (Motion)

All interactive components use `motion/react`:

```typescript
import { motion, AnimatePresence, LazyMotion, domAnimation } from 'motion/react'

// Root: wrap app in LazyMotion for tree shaking
<LazyMotion features={domAnimation}>
  <App />
</LazyMotion>

// Interactive elements:
<motion.button whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }} />

// Card entrance:
<motion.div
  initial={{ opacity: 0, scale: 0.97 }}
  animate={{ opacity: 1, scale: 1 }}
  transition={{ duration: 0.2 }}
/>

// Mount/unmount (drawer, dialog):
<AnimatePresence>
  {isOpen && (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 300 }}
    />
  )}
</AnimatePresence>
```

### Zustand Store Convention

**Ephemeral store** (no persistence):
```typescript
// src/hooks/state/useSidebarStore.ts
import { create } from 'zustand'

interface SidebarState {
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
}

export const useSidebarStore = create<SidebarState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
}))
```

**Persisted store** (localStorage):
```typescript
// src/hooks/persist/usePersistSettings.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const usePersistSettings = create<SettingsState>()(
  persist(
    (set) => ({
      backgroundAnimation: true,
      setBackgroundAnimation: (v: boolean) => set({ backgroundAnimation: v }),
    }),
    { name: 'hiveboard-settings' }
  )
)
```

### Form Pattern — Universal `FieldForm`

Single component that renders the correct input based on `type` prop:

```typescript
export const FieldForm = ({ label, ...props }: FieldFormProps) => (
  <fieldset className={fieldsetStyles({ grow: props.type === 'textarea' || props.type === 'code' })}>
    {label && <label className="shrink-0 pl-2 text-gray-100">{label}</label>}
    <InputController {...props} />
  </fieldset>
)

// InputController switches on type:
// 'code' → CodeMirror editor
// 'select' → Radix Select
// 'switch' → Radix Switch
// 'textarea' → TextAreaInput
// 'text' | default → TextInput
```

### Routing Convention (TanStack Router)

```typescript
// src/routes.tsx
import { createRouter, createRootRoute, createRoute, lazyRouteComponent } from '@tanstack/react-router'
import { App } from './App'

const rootRoute = createRootRoute({ component: App })

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: lazyRouteComponent(() => import('./pages/home'), 'HomePage'),
})

// For HiveBoard — only 1 route needed:
// '/' → Board view (all interaction via drawers/dialogs, no page navigation)

export const router = createRouter({
  routeTree: rootRoute.addChildren([homeRoute]),
  defaultPreload: 'intent',   // preload on hover
})
```

### Code Style Rules (extracted from oxfmt/oxlint → apply to Biome)

> Configure Biome to match these rules.


**Formatting:**
- No semicolons (`"semicolons": "asNeeded"` in Biome)
- Single quotes (`"quoteStyle": "single"`)
- Print width: 120
- Tab width: 2 (spaces)
- Trailing commas: all

**Linting (enforce in `biome.json`):**
- `noExplicitAny: "error"` — strict no `any`
- `useArrayType: "generic"` — use `Array<T>` not `T[]`
- `noConsole: "warn"` — warn on `console.log` left in code
- `useExhaustiveDependencies: "warn"` — React hooks deps
- `useSelfClosingElements: "error"` — `<div />` not `<div></div>`
- `noUnusedVariables: "error"`, `noUnusedParameters: "error"`
- Import sorting: ascending, case-insensitive, `@/` grouped as internal
- `useSortedExports: "error"` — exports must be alphabetically sorted
- `useSortedKeys: "error"` — object keys must be alphabetically sorted
- `sortJsxProps: "on"` (assist) — JSX/component props sorted alphabetically

**Equivalent scripts (adapted for Bun):**
```json
{
  "scripts": {
    "lint": "bunx biome lint .",
    "lint:fix": "bunx biome lint --fix .",
    "fmt": "bunx biome check --fix .",
    "fmt:check": "bunx biome check .",
    "tsc": "bunx tsc --noEmit"
  }
}
```

### Lazy Loading Convention

All feature components and heavy common components use `React.lazy()` with named export mapping:

```typescript
// Named export → default export mapping for React.lazy
const TaskDrawer = lazy(() =>
  import('@/components/feature/task/TaskDrawer').then(({ TaskDrawer }) => ({ default: TaskDrawer }))
)

const AgentLogStream = lazy(() =>
  import('@/components/feature/agent/AgentLogStream').then(({ AgentLogStream }) => ({ default: AgentLogStream }))
)

// Usage with Suspense boundary
<Suspense fallback={<LoadingSkeleton />}>
  <TaskDrawer />
</Suspense>
```

**Rule:** Components always use `export const Foo` (named), never `export default`. The `React.lazy()` wrapper handles the conversion.

### Type Organization Convention

Types live in a **separate `src/types/` directory** mirroring the source tree — NOT co-located:

```
src/types/
├── components/
│   └── common/
│       ├── button.ts       # ButtonProps, ButtonVariants
│       ├── card.ts         # CardProps
│       ├── dialog.ts       # DialogProps, DialogVariants
│       ├── input.ts        # TextInputProps, SelectInputProps, etc.
│       └── badge.ts        # BadgeProps, BadgeVariants
├── hooks/
│   ├── persist.ts          # PersistSettings, PersistFeatureLayout
│   └── state.ts            # SidebarState, ToastState
├── constants/
│   └── route.ts            # RoutePath
└── utils/
    ├── tailwind-variants.ts  # CompVariant<T> helper type
    └── validation.ts         # Validator types
```

**`CompVariant<T>`** — generic type helper for tailwind-variants return values:
```typescript
import type { TVReturnType } from 'tailwind-variants'
export type CompVariant<T> = TVReturnType<T>
```

## Database Schema (Bun SQLite)

> **IDs**: All primary keys use **ULID** (Universally Unique Lexicographically Sortable Identifier)
> generated in application code via the `ulid` package. ULIDs are time-sortable, 26-char
> Crockford base32 strings (e.g., `01HYX3KPQR4V8WNM0TGBZ5J6`). IDs are generated in
> `packages/api/src/db/ulid.ts` and passed explicitly on INSERT — no `DEFAULT` expression needed.

```sql
-- Users
CREATE TABLE users (
  id           TEXT PRIMARY KEY,  -- ULID
  username     TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'member',  -- 'admin' | 'member'
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Boards (future: multi-board support)
CREATE TABLE boards (
  id         TEXT PRIMARY KEY,  -- ULID
  name       TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Columns within a board
CREATE TABLE columns (
  id         TEXT PRIMARY KEY,  -- ULID
  board_id   TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tasks (replaces GitHub Issues as source of truth)
CREATE TABLE tasks (
  id             TEXT PRIMARY KEY,  -- ULID
  board_id       TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  column_id      TEXT NOT NULL REFERENCES columns(id),
  title          TEXT NOT NULL,
  body           TEXT NOT NULL DEFAULT '',
  position       REAL NOT NULL DEFAULT 0,  -- fractional positioning (see Position Strategy)
  -- action dispatch
  action         TEXT,          -- 'plan' | 'research' | 'implement' | 'implement-e2e' | 'revise' | NULL
  target_repo    TEXT,          -- 'owner/repo'
  -- agent state
  agent_status   TEXT NOT NULL DEFAULT 'idle',  -- 'idle' | 'queued' | 'running' | 'success' | 'failed'
  agent_output   TEXT,
  agent_error    TEXT,
  retry_count    INTEGER NOT NULL DEFAULT 0,
  -- github link
  pr_url         TEXT,
  pr_number      INTEGER,
  -- archive
  archived       INTEGER NOT NULL DEFAULT 0,   -- 0 = active, 1 = archived
  archived_at    TEXT,
  -- audit
  created_by     TEXT NOT NULL REFERENCES users(id),
  updated_by     TEXT NOT NULL REFERENCES users(id),
  -- timestamps
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Task comments
CREATE TABLE task_comments (
  id         TEXT PRIMARY KEY,  -- ULID
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  parent_id  TEXT REFERENCES task_comments(id) ON DELETE CASCADE,  -- NULL = top-level, set = reply
  body       TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Task activity timeline (like GitHub issue timeline)
-- Every meaningful change to a task is recorded here.
-- actor = 'SYSTEM' for orchestrator/agent actions, user id for human actions.
CREATE TABLE task_events (
  id         TEXT PRIMARY KEY,  -- ULID
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor      TEXT NOT NULL,    -- user id (ULID) or 'SYSTEM'
  type       TEXT NOT NULL,    -- event type (see below)
  data       TEXT,             -- JSON payload with event-specific details
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Event types & data payloads:
--   'created'          {}
--   'moved'            {"from_column": "Backlog", "to_column": "In Progress"}
--   'status_changed'   {"from": "idle", "to": "running"}
--   'action_set'       {"action": "implement"}
--   'action_cleared'   {"action": "implement"}
--   'assigned'         {"target_repo": "owner/repo"}
--   'comment_added'    {"comment_id": "..."}
--   'pr_opened'        {"pr_url": "...", "pr_number": 42}
--   'archived'         {}
--   'unarchived'       {}
--   'agent_started'    {"action": "implement", "retry": 0}
--   'agent_succeeded'  {"action": "implement", "duration_ms": 12345}
--   'agent_failed'     {"action": "implement", "error": "..."}
--   'title_changed'    {"from": "old title", "to": "new title"}
--   'body_changed'     {}

-- Agent run history
CREATE TABLE agent_runs (
  id          TEXT PRIMARY KEY,  -- ULID
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  action      TEXT NOT NULL,
  status      TEXT NOT NULL,   -- 'running' | 'success' | 'failed'
  output      TEXT,
  error       TEXT,
  started_at  TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);
```

### Position Strategy (fractional indexing)

Task positions within a column use `REAL` (floating-point) values with an initial spacing of **1024**:

- **New task** appended to column: `position = max_position_in_column + 1024` (or `0` if column is empty)
- **Insert between** two cards: `position = (prev_position + next_position) / 2`
- **Move to top**: `position = first_position - 1024`
- **Re-index trigger**: When the gap between two adjacent positions is < `1.0`, batch re-index the entire column: assign positions `0, 1024, 2048, ...` to all cards in current sort order. This is handled inside the `moveTask` mutation within the same transaction
- **Why REAL**: Avoids needing to shift all subsequent positions on every insert. Re-index is rare (requires ~10 consecutive inserts between the same two cards)

**Default seed on first run:**
- 1 user: `queen-bee` (role: admin, display_name: "Queen Bee") — ULID generated once at seed time
- 1 board: "HiveBoard" (created_by: queen-bee) — ULID generated once at seed time
- 5 columns: Backlog (0), Todo (1), In Progress (2), Review (3), Done (4) — ULIDs generated at seed time

> **Auth model (MVP):** Any request from localhost is treated as `queen-bee` (super-admin).
> No authentication required for MVP. Future: users accessing over the internet authenticate
> via GitHub OAuth, invited by queen-bee with single-use invitation codes.

## GraphQL Schema

```graphql
type Query {
  board(id: ID!): Board
  boards: [Board!]!
  task(id: ID!): Task
  agentRuns(taskId: ID!): [AgentRun!]!
  taskTimeline(taskId: ID!): [TaskEvent!]!  # unified activity feed
  comments(taskId: ID!): [Comment!]!
  me: User!
}

type Mutation {
  # Board
  createBoard(name: String!): Board!

  # Task CRUD
  createTask(input: CreateTaskInput!): Task!
  updateTask(id: ID!, input: UpdateTaskInput!): Task!
  deleteTask(id: ID!): Boolean!
  moveTask(id: ID!, columnId: ID!, position: Float!): Task!
  archiveTask(id: ID!): Task!
  unarchiveTask(id: ID!): Task!

  # Comments
  addComment(taskId: ID!, body: String!, parentId: ID): Comment!
  updateComment(id: ID!, body: String!): Comment!
  deleteComment(id: ID!): Boolean!

  # Agent dispatch
  dispatchAgent(taskId: ID!, action: String!): Task!
  cancelAgent(taskId: ID!): Task!
}

type Subscription {
  taskUpdated(boardId: ID!): Task!
  agentLogStream(taskId: ID!): AgentLogChunk!
  commentAdded(taskId: ID!): Comment!
  taskEventAdded(taskId: ID!): TaskEvent!
}

type User {
  id: ID!
  username: String!
  displayName: String!
  role: String!
}

type Board {
  id: ID!
  name: String!
  columns: [Column!]!
  createdBy: User!
  createdAt: String!
}

type Column {
  id: ID!
  name: String!
  position: Float!
  tasks: [Task!]!          # excludes archived by default
}

type Task {
  id: ID!
  title: String!
  body: String!
  column: Column!
  position: Float!
  action: String
  targetRepo: String
  agentStatus: AgentStatus!
  agentOutput: String
  agentError: String
  retryCount: Int!
  prUrl: String
  prNumber: Int
  archived: Boolean!
  archivedAt: String
  createdBy: User!
  updatedBy: User!
  comments: [Comment!]!
  createdAt: String!
  updatedAt: String!
}

enum AgentStatus {
  IDLE
  QUEUED
  RUNNING
  SUCCESS
  FAILED
}

type Comment {
  id: ID!
  body: String!
  parentId: ID
  replies: [Comment!]!
  createdBy: User!
  createdAt: String!
  updatedAt: String!
}

type TaskEvent {
  id: ID!
  type: String!              # 'created' | 'moved' | 'status_changed' | 'agent_started' | ...
  actor: User                # null when actor = 'SYSTEM'
  isSystem: Boolean!         # true when actor = 'SYSTEM'
  data: String               # JSON string with event-specific payload
  createdAt: String!
}

type AgentRun {
  id: ID!
  action: String!
  status: String!
  output: String
  error: String
  startedAt: String!
  finishedAt: String
}

type AgentLogChunk {
  taskId: ID!
  chunk: String!
  timestamp: String!
}

input CreateTaskInput {
  boardId: ID!
  columnId: ID
  title: String!
  body: String
  action: String
  targetRepo: String
}

input UpdateTaskInput {
  title: String
  body: String
  action: String
  targetRepo: String
}
```

## Frontend Views

### 1. Board View (`/`) — Single Page
- Kanban board with 5 columns
- Each column shows **active (non-archived) task cards** sorted by position
- Drag-and-drop cards between columns (via @dnd-kit)
- "+" button on each column → opens TaskDrawer in **create mode** (same drawer as view)
- Task cards show: title, action badge, agent status indicator, target repo, created_by avatar
- Real-time updates via subscription — cards move/update automatically when agents change state
- "Show Archived" toggle to reveal archived tasks (grayed out, not draggable)
- Current user shown in header (hardcoded `queen-bee` for MVP)
- **Dark theme** (Linear-minimal + Bee palette): `surface-page` background, `surface-raised` cards, `border-default` subtle borders, `honey-400` primary accent, muted semantic colors for badges/status

### 2. Task Drawer (unified create + view/edit — vaul, `direction="right"`)
- Uses **vaul** drawer (`direction="right"`, ~480px, `dismissible`, overlay with backdrop blur)
- **Same component** handles both create and view/edit — consistent UX, no separate dialog
- **Create mode**: "+" on column → drawer opens with empty form, title auto-focused, "Create Task" primary button
- **View mode** (default when clicking a card): title as text, body rendered as markdown preview, metadata as read-only labels — like GitHub issue view
- **Edit mode** (toggled via pencil/Edit button in view mode): title becomes input, body switches to Write/Preview tabs, metadata becomes editable inputs. "Save" / "Cancel" buttons to commit or discard. Same toggle pattern as GitHub issue edit
- Close via X button, Escape key, or click on overlay
- Agent status panel: current status, retry count, last error
- "Dispatch Agent" button (action selector dropdown: plan, research, implement, implement-e2e, revise)
- "Cancel Agent" button (when running)
- "Archive" / "Unarchive" button
- Agent log stream (live output from Claude CLI via subscription)
- PR link (when created)
- **Activity Timeline** (GitHub-issue-style, chronological feed):
  - Interleaves events and comments in a single vertical timeline
  - Each entry shows: icon + actor (or **SYSTEM** badge) + description + relative timestamp
  - User actions: "queen-bee moved this from Backlog to In Progress"
  - System actions (highlighted with SYSTEM badge):
    - "SYSTEM changed status to `running`"
    - "SYSTEM agent started (`implement`, attempt #1)"
    - "SYSTEM agent succeeded (took 2m 34s)"
    - "SYSTEM agent failed: <error summary>"
    - "SYSTEM opened PR #42"
  - Comments appear inline in the timeline with full threaded replies
  - New comment input at the bottom of the timeline
  - Real-time: new events/comments stream in via subscription
- Shows "Created by" and "Updated by" user info
- Close drawer with X button or clicking outside

## Agent Orchestration Changes

The orchestrator moves from polling GitHub Projects → polling the local SQLite database:

| Current (GitHub-based) | New (Owned Board) |
|------------------------|-------------------|
| Poll GitHub Projects V2 via GraphQL | Query `tasks` table for `agent_status = 'queued'` |
| Parse `action:*` / `repo:*` labels | Read `action` and `target_repo` columns directly |
| Move column via GitHub GraphQL mutation | `UPDATE tasks SET column_id = ?` |
| Add `status:running` label | `UPDATE tasks SET agent_status = 'running'` |
| Post comment on issue | `INSERT INTO task_events` + publish subscription |
| Create PR on GitHub | **Still uses GitHub API** — `gh pr create` |

### Dispatch Flow (new)

```
1. User creates task on board, sets action + target_repo
   → event: {type: 'created', actor: user_id}
2. User clicks "Dispatch Agent" → mutation sets agent_status = 'queued'
   → event: {type: 'status_changed', actor: user_id, data: {from: 'idle', to: 'queued'}}
3. Orchestrator poll loop picks up queued tasks
4. Sets agent_status = 'running', publishes taskUpdated + taskEventAdded
   → event: {type: 'agent_started', actor: 'SYSTEM', data: {action, retry: 0}}
5. Spawns Claude CLI (same as current runner.ts)
6. Streams stdout to agentLogStream subscription
7. On success: agent_status = 'success', move to Review column, record agent_run
   → event: {type: 'agent_succeeded', actor: 'SYSTEM', data: {action, duration_ms}}
   → event: {type: 'moved', actor: 'SYSTEM', data: {from_column, to_column}}
8. On failure: agent_status = 'failed', record error, retry logic same as current
   → event: {type: 'agent_failed', actor: 'SYSTEM', data: {action, error}}
```

## Migration Strategy

Phased approach — existing code keeps working while we build alongside it:

1. **Phase 1 — Scaffold** monorepo, database, GraphQL server with basic CRUD
2. **Phase 2 — Frontend** board UI with drag-drop and task CRUD
3. **Phase 3 — Orchestrator** port orchestrator to use SQLite instead of GitHub Projects
4. **Phase 4 — Real-time** subscriptions for live task updates + agent log streaming
5. **Phase 5 — Cleanup** remove old webhook server and GitHub Projects polling code

> **Important:** During Phases 1-4, the new `packages/` code must **never** import from `src/`.
> Reusable logic (workspace manager, agent runner, GitHub client) is **copied** into
> `packages/api/src/` and adapted — not imported from `src/`. The old `src/` is removed in Phase 5.

## Dev Scripts

```json
// root package.json
{
  "scripts": {
    "dev": "bun run --filter '*' dev",
    "dev:api": "bun run --filter api dev",
    "dev:web": "bun run --filter web dev",
    "build:web": "bun run --filter web build",
    "start": "bun run packages/api/src/index.ts"
  }
}
```

### Running Modes

#### Local Development (Bun)

For developers running directly on their machine:

```bash
bun install
bun run dev          # starts both API (8080) + Vite dev server (5173) concurrently
bun run dev:api      # API only (hot-reload via bun --watch)
bun run dev:web      # Web only (Vite HMR)
```

- API: `bun --watch packages/api/src/index.ts` — auto-restarts on file changes
- Web: `vite --port ${WEB_PORT}` — HMR, proxies `/graphql` to API
- Two separate processes, two ports — standard local dev experience

#### Production via Docker

For deployment or CI — **production mode only**, single container:

```bash
docker compose up          # build + start
docker compose up --build  # force rebuild
```

**How it works:**
1. `Dockerfile` builds the web frontend into static assets (`vite build` → `packages/web/dist/`)
2. API server serves both GraphQL API **and** the static web assets from a single port (`API_PORT`, default 8080)
3. No Vite dev server in production — the API handles everything

**API serves static files (production only):**
```typescript
// packages/api/src/index.ts
const isProduction = process.env.NODE_ENV === 'production'
const staticDir = isProduction ? path.join(__dirname, '../../web/dist') : null

Bun.serve({
  port: Number(process.env.API_PORT ?? 8080),
  fetch(req) {
    const url = new URL(req.url)

    // Health check (used by Docker healthcheck + monitoring)
    if (url.pathname === '/health') {
      return Response.json({ ok: true, uptime: process.uptime() })
    }

    // GraphQL endpoint
    if (url.pathname === '/graphql') return yoga.fetch(req)

    // In production, serve static web assets
    if (isProduction && staticDir) {
      const filePath = path.join(staticDir, url.pathname === '/' ? 'index.html' : url.pathname)
      const file = Bun.file(filePath)
      if (file.size > 0) return new Response(file)
      // SPA fallback — serve index.html for client-side routing
      return new Response(Bun.file(path.join(staticDir, 'index.html')))
    }

    return new Response('Not Found', { status: 404 })
  },
})
```

**Dockerfile (multi-stage):**
```dockerfile
# ── Stage 1: Install deps ──
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/api/package.json packages/api/
COPY packages/web/package.json packages/web/
RUN bun install --frozen-lockfile

# ── Stage 2: Build web assets ──
FROM deps AS build-web
COPY packages/web/ packages/web/
RUN bun run --filter web build

# ── Stage 3: Production image ──
FROM oven/bun:1 AS production
WORKDIR /app

# Install runtime tools (git, gh CLI, claude CLI)
RUN apt-get update && apt-get install -y git curl && rm -rf /var/lib/apt/lists/* \
    # Install GitHub CLI
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y gh && rm -rf /var/lib/apt/lists/* \
    # Install Claude CLI (via npm — runs on Bun)
    && bunx @anthropic-ai/claude-code@latest --version || true

# Copy API source + built web assets
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/api/node_modules ./packages/api/node_modules
COPY packages/api/ packages/api/
COPY --from=build-web /app/packages/web/dist ./packages/web/dist
COPY WORKFLOW.md ./

# Non-root user
RUN useradd -m hiveboard
USER hiveboard

ENV NODE_ENV=production
ENV API_PORT=8080
EXPOSE 8080

CMD ["bun", "run", "packages/api/src/index.ts"]
```

**docker-compose.yml:**
```yaml
services:
  hiveboard:
    build: .
    ports:
      - "${API_PORT:-8080}:8080"
    env_file: .env
    environment:
      - NODE_ENV=production
      - API_PORT=8080
    volumes:
      - ./tmp/database:/app/tmp/database        # SQLite persistence
      - ./tmp/workspaces:/app/tmp/workspaces     # Agent workspaces
      - ./WORKFLOW.md:/app/WORKFLOW.md:ro         # Config
      - ./tmp/agents/.claude:/home/hiveboard/.claude  # Claude CLI config
    healthcheck:
      test: ["CMD", "bun", "-e", "fetch('http://localhost:8080/health').then(r => process.exit(r.ok ? 0 : 1))"]
      interval: 30s
      timeout: 5s
      retries: 3
```

### GitHub Auth Configuration

> Supports the same two auth modes as the current `src/` codebase. Docker users pass
> credentials via `.env` file or `environment:` in docker-compose.

**Option A: Personal Access Token (simpler)**
```env
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
```
- Scopes needed: `repo`, `read:org` (for PR creation + review comment fetching)
- Used by `gh` CLI inside agent workspaces and by the GitHub client for API calls

**Option B: GitHub App (recommended for production/Docker)**
```env
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_APP_INSTALLATION_ID=12345678
```
- Installation token is auto-refreshed by the API server (reuses `src/github/client.ts` auth logic)
- More secure: scoped permissions, no personal token, audit trail

**Auth detection** (same as current `src/config/schema.ts` logic):
1. If `GITHUB_TOKEN` is set → use PAT mode
2. Else if all three `GITHUB_APP_*` vars are set → use GitHub App mode
3. Else → error on startup with clear message

**`.env.example` (new, for owned-board):**
```env
# ── GitHub Auth (required — choose one) ───────────────
# Option A: Personal access token
GITHUB_TOKEN=ghp_your_token_here

# Option B: GitHub App (set these INSTEAD of GITHUB_TOKEN)
# GITHUB_APP_ID=123456
# GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
# GITHUB_APP_INSTALLATION_ID=12345678

# ── Ports ─────────────────────────────────────────────
# API_PORT=8080          # API server (default: 8080)
# WEB_PORT=5173          # Vite dev server, local dev only (default: 5173)

# ── Database ──────────────────────────────────────────
# DATABASE_PATH=tmp/database/hiveboard.db   # SQLite file path (default shown)
```

### Port Configuration

| Service | Default | Env Variable | Usage |
|---------|---------|-------------|-------|
| API server | `8080` | `API_PORT` | Both dev and production |
| Web dev server | `5173` | `WEB_PORT` | Dev only (Vite HMR) — not used in Docker |

**In Docker (production):** Only `API_PORT` matters — single port serves API + static web assets.
**In local dev:** Both `API_PORT` and `WEB_PORT` are active — two separate processes.

---

## Acceptance Checklist

### Phase 1: Scaffold & Database
> **Blocks:** Phase 2, Phase 3, Phase 4 (all depend on API + DB)
> **Blocked by:** Nothing — can start immediately

#### 1.1 Monorepo Structure
- [x] Add `"workspaces": ["packages/*"]` to root `package.json`
- [x] Create `packages/api/package.json` with name `@hiveboard/api`, deps: `graphql`, `graphql-yoga`, `consola`, `ulid`
- [x] Create `packages/web/package.json` with name `@hiveboard/web`, deps: `react`, `vite`, `@tanstack/react-router`, `tailwindcss`, `zustand`, `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`, `graphql-request`, `graphql-sse`
- [x] Root `package.json` keeps existing `"start"` script pointing to `src/index.ts` (backward compat)
- [x] Add root scripts: `"dev"`, `"dev:api"`, `"dev:web"` (see Dev Scripts section)
- [x] Create `packages/api/tsconfig.json` extending root, with `"include": ["src/**/*.ts"]` and path alias `@api/*`
- [x] Create `packages/web/tsconfig.json` extending root, with JSX support (`"jsx": "react-jsx"`)
- [x] `bun install` succeeds with workspace resolution
- [x] Existing `bun run start` still boots the old orchestrator (no breakage to `src/`)

#### 1.2 Database Layer (`packages/api/src/db/`)
- [x] `client.ts` — Bun SQLite singleton, reads `DATABASE_PATH` env var (default: `tmp/database/hiveboard.db` at project root), enable WAL mode, foreign keys ON
- [x] `schema.ts` — All `CREATE TABLE IF NOT EXISTS` statements (users, boards, columns, tasks, task_comments, task_events, agent_runs) matching the Database Schema section exactly
- [x] `migrate.ts` — Auto-migration on startup: run all `CREATE TABLE IF NOT EXISTS`, then call `seed()` if tables are empty
- [x] `seed.ts` — Idempotent seed: insert `queen-bee` user (role: admin), "HiveBoard" board, 5 columns (Backlog=0, Todo=1, In Progress=2, Review=3, Done=4) — skip if already exists
- [x] `ulid.ts` — Exports `generateId(): string` using `ulid` package. All IDs generated in application code (not SQLite DEFAULT)
- [x] All tables use `TEXT PRIMARY KEY` for IDs (ULID strings, 26 chars, time-sortable)
- [x] All timestamp columns use `DEFAULT (datetime('now'))` (ISO 8601 UTC strings)
- [x] `tasks.position` uses `REAL` type (fractional positioning, initial spacing 1024)
- [x] `tasks.action` accepts enum values: `plan`, `research`, `implement`, `implement-e2e`, `revise`, or `NULL`
- [x] `tasks.agent_status` defaults to `idle`, valid values: `idle`, `queued`, `running`, `success`, `failed`
- [x] `task_comments.parent_id` is nullable (NULL = top-level, non-NULL = threaded reply)
- [x] `task_events.actor` stores user ID string or literal `'SYSTEM'`
- [x] `task_events.data` stores JSON string payload (event-type-specific, see schema docs)
- [x] Foreign keys with `ON DELETE CASCADE` on board_id, task_id, parent_id references
- [x] Indexes: `tasks(board_id, column_id)`, `tasks(agent_status)`, `task_events(task_id, created_at)`, `task_comments(task_id)`, `agent_runs(task_id)`

#### 1.3 GraphQL Server
- [x] `packages/api/src/index.ts` — Entry point: run `migrate()`, create GraphQL Yoga server, `Bun.serve({ port: Number(process.env.API_PORT ?? 8080), fetch })` with CORS enabled for web origin. Include `/health` endpoint returning `{ ok: true, uptime }` (used by Docker healthcheck)
- [x] `packages/api/src/schema/typeDefs.ts` — Full GraphQL SDL matching the GraphQL Schema section (all types, enums, inputs, queries, mutations, subscriptions)
- [x] `packages/api/src/schema/resolvers.ts` — All resolver implementations (see below)
- [x] `packages/api/src/pubsub.ts` — In-memory pub/sub for GraphQL subscriptions (simple EventEmitter or Yoga's `createPubSub()`)

#### 1.4 Query Resolvers
- [x] `boards` — `SELECT * FROM boards` → returns all boards with nested columns (each column with non-archived tasks sorted by position)
- [x] `board(id)` — Single board by ID with columns + tasks
- [x] `task(id)` — Single task with resolved `column`, `createdBy`, `updatedBy`, `comments` (top-level only, replies nested)
- [x] `agentRuns(taskId)` — `SELECT * FROM agent_runs WHERE task_id = ? ORDER BY started_at DESC`
- [x] `taskTimeline(taskId)` — `SELECT * FROM task_events WHERE task_id = ? ORDER BY created_at ASC` — resolve actor to User object (or null if `'SYSTEM'`), set `isSystem = actor === 'SYSTEM'`
- [x] `comments(taskId)` — Top-level comments (`parent_id IS NULL`) with nested `replies` (recursive 1 level)
- [x] `me` — Returns hardcoded `queen-bee` user (MVP: no auth, single-user)
- [x] Column → `tasks` field resolver: `SELECT * FROM tasks WHERE column_id = ? AND archived = 0 ORDER BY position ASC`

#### 1.5 Mutation Resolvers
- [x] `createBoard(name)` — INSERT board, return it
- [x] `createTask(input)` — INSERT task with `created_by` and `updated_by` set to current user (queen-bee). If `columnId` omitted, default to first column (Backlog). Auto-assign `position` = max position in column + 1. INSERT `task_events` row: `{type: 'created', actor: user_id}`
- [x] `updateTask(id, input)` — UPDATE only provided fields (title, body, action, targetRepo). Set `updated_by`, `updated_at`. INSERT event for each changed field: `title_changed`, `body_changed`, `action_set`/`action_cleared`, `assigned`
- [x] `deleteTask(id)` — DELETE task (cascades to comments, events, agent_runs). Return `true`
- [x] `moveTask(id, columnId, position)` — UPDATE task's `column_id` and `position` (Float — frontend calculates fractional value via `(prev+next)/2`). If gap between adjacent positions < 1.0 after move, batch re-index all tasks in destination column (`0, 1024, 2048, ...`). INSERT `task_events` row: `{type: 'moved', data: {from_column: "name", to_column: "name"}}`. Set `updated_by`, `updated_at`
- [x] `archiveTask(id)` — SET `archived = 1`, `archived_at = datetime('now')`. INSERT event `{type: 'archived'}`. Set `updated_by`, `updated_at`
- [x] `unarchiveTask(id)` — SET `archived = 0`, `archived_at = NULL`. INSERT event `{type: 'unarchived'}`. Set `updated_by`, `updated_at`
- [x] `addComment(taskId, body, parentId?)` — If `parentId` is set, verify parent comment's `parent_id IS NULL` (reject with error if parent is already a reply — max 1 level nesting). INSERT into `task_comments`. INSERT `task_events` row: `{type: 'comment_added', data: {comment_id}}`. Return comment with resolved `createdBy`
- [x] `updateComment(id, body)` — UPDATE comment body and `updated_at`. Return updated comment
- [x] `deleteComment(id)` — DELETE comment (cascades replies). Return `true`
- [x] `dispatchAgent(taskId, action)` — SET `action`, `agent_status = 'queued'`. INSERT events: `action_set` + `status_changed (idle → queued)`. Return task _(actual agent spawning happens in Phase 3 orchestrator)_
- [x] `cancelAgent(taskId)` — SET `agent_status = 'idle'`. INSERT event `status_changed`. _(actual process kill in Phase 3)_
- [x] **Event consistency**: Every mutation that modifies task state wraps its DB writes in a transaction (`db.transaction(() => { ... })()`) to ensure task update + event insert are atomic

#### 1.6 Testing
- [x] `packages/api/test/db.test.ts` — Test migration runs without error, seed creates expected rows, idempotent re-run
- [x] `packages/api/test/resolvers.test.ts` — Test each query/mutation resolver against a fresh in-memory SQLite DB (`:memory:`)
- [x] `packages/api/test/events.test.ts` — Test that each mutation creates the correct `task_events` rows with expected type, actor, and data payload
- [x] `bun test` from root runs all tests (existing `test/` + new `packages/api/test/`)

---

### Phase 2: Frontend Board UI
> **Blocks:** Phase 4 (subscriptions integrate into these components)
> **Blocked by:** Phase 1 (needs GraphQL API running)

#### 2.1 Project Scaffold
- [x] `packages/web/vite.config.ts` — Vite config with React plugin, proxy `/graphql` → `http://localhost:${API_PORT ?? 8080}/graphql`, dev server on port `WEB_PORT ?? 5173`
- [x] `packages/web/index.html` — HTML entry point with `<div id="root">`, dark theme `<meta>`, load `src/main.tsx`
- [x] `packages/web/src/main.tsx` — React 18+ `createRoot`, mount `<LazyMotion features={domAnimation}>` → `<RouterProvider>` → `<StrictMode>` with TanStack Router
- [x] `packages/web/src/styles/index.css` — Tailwind v4 CSS-first config with `@import "tailwindcss"` + `@theme` blocks: Bee palette (honey/amber OKLCH tokens), warm gray neutrals, Linear-style surface layering (`surface-page`, `surface-raised`, `surface-overlay`), muted semantic colors, subtle shadows. Full spec in "Theme / Design Tokens" section
- [x] No `tailwind.config.ts` needed — Tailwind v4 uses CSS-first `@theme` directives (configured via `@tailwindcss/vite` plugin)
- [x] TanStack Router file-based routing: `src/routes/__root.tsx` (layout shell), `src/routes/index.tsx` (board view)

#### 2.2 GraphQL Client
- [x] `packages/web/src/graphql/client.ts` — `graphql-request` client pointed at `/graphql` (uses Vite proxy)
- [x] `packages/web/src/graphql/queries.ts` — All query documents: `GET_BOARD` (board with columns + tasks), `GET_TASK` (full task with comments + timeline), `GET_ME`
- [x] `packages/web/src/graphql/mutations.ts` — All mutation documents: `CREATE_TASK`, `UPDATE_TASK`, `DELETE_TASK`, `MOVE_TASK`, `ARCHIVE_TASK`, `UNARCHIVE_TASK`, `ADD_COMMENT`, `UPDATE_COMMENT`, `DELETE_COMMENT`, `DISPATCH_AGENT`, `CANCEL_AGENT`
- [x] `packages/web/src/graphql/subscriptions.ts` — SSE subscription client using `graphql-sse` + subscription documents (wired in Phase 4): `TASK_UPDATED`, `AGENT_LOG_STREAM`, `COMMENT_ADDED`, `TASK_EVENT_ADDED`

#### 2.3 State Management
- [x] `packages/web/src/store/boardStore.ts` — Zustand store with:
  - `board: Board | null` — current board data (columns + tasks)
  - `selectedTaskId: string | null` — which task drawer is open
  - `showArchived: boolean` — toggle for archived task visibility
  - `drawerMode: 'closed' | 'create' | 'view'` — drawer state (replaces separate `isCreatingTask` + `selectedTaskId` flags)
  - `createTaskColumnId: string | null` — which column the "+" was clicked on (used in create mode)
  - Actions: `setBoard()`, `openDrawerCreate(columnId)`, `openDrawerView(taskId)`, `closeDrawer()`, `toggleArchived()`
  - Optimistic update helpers: `moveTaskOptimistic(taskId, toColumnId, position)` — immediately reorder in store, rollback on server error

#### 2.4 Board View (`/`)
- [x] `Board.tsx` — Fetches board via `GET_BOARD` query on mount. Renders horizontal flex container of `<Column>` components. Wraps columns in `<DndContext>` from @dnd-kit with `onDragEnd` handler
- [x] `Column.tsx` — Renders column header (name + task count) + vertical list of `<TaskCard>` components. "+" button in header calls `openDrawerCreate(columnId)`. Column is a `<SortableContext>` (vertical list strategy) + `useDroppable()` for cross-column drops
- [x] `TaskCard.tsx` — Draggable card (`useSortable()` from @dnd-kit/sortable). Displays: title (truncated), action badge (colored pill: plan=blue, research=purple, implement=green, implement-e2e=teal, revise=orange), agent status indicator (idle=gray dot, queued=yellow pulse, running=blue spinner, success=green check, failed=red x), target repo (small text), created_by username. `onClick` → `openDrawerView(id)` to open drawer. Visual feedback on drag (opacity, shadow)
- [x] Drag-and-drop logic: `onDragEnd` → call `moveTask` mutation with new `columnId` + calculated `position`. Optimistically update store. On error, refetch board to reset
- [x] Position calculation on drop: insert between adjacent cards → `position = (prevPosition + nextPosition) / 2`. If no neighbors, use `0` or `max + 1024`. If fractional positions get too close (< 1), re-index all positions in the column (batch update)

#### 2.5 Task Drawer (unified create + view/edit — vaul)
- [x] `TaskDrawer.tsx` — Single vaul-based right-side drawer (`direction="right"`, ~480px) used for **both** creating and viewing/editing tasks. Controlled by Zustand `drawerMode` state
- [x] Uses `<Drawer direction="right" open={drawerMode !== 'closed'} onOpenChange={...}>` from vaul wrapper
- [x] Scrollable content area uses `data-vaul-no-drag` to prevent swipe-dismiss on scroll
- [x] Drawer layout: `DrawerHeader` (sticky top) → scrollable body → `DrawerFooter` (sticky bottom)

##### Create Mode (`drawerMode === 'create'`)
- [x] Header: "New Task" title, `<DrawerClose>` button
- [x] All fields start in **edit state** (no view/edit toggle needed):
  - Title (text input, required, auto-focused)
  - Body (Write/Preview tabs — GitHub-style markdown, optional)
  - Action (dropdown: none, plan, research, implement, implement-e2e, revise)
  - Target Repo (text input, placeholder: `owner/repo`, optional)
- [x] Pre-fills `columnId` from the column where "+" was clicked (or Backlog if opened from header)
- [x] Footer: **"Create Task"** primary button (`honey-400`) → `CREATE_TASK` mutation → refetch board → close drawer
- [x] No timeline, no agent panel, no archive button (task doesn't exist yet)

##### View Mode (`drawerMode === 'view'`, default when clicking a card)
- [x] Fetches full task data via `GET_TASK` query when opened
- [x] **Header**: Title as styled `<h2>` text, task ID badge, pencil/Edit button, `<DrawerClose>` button
- [x] **Body**: Rendered markdown via `<MarkdownPreview>`. Empty body shows "No description" in `text-tertiary`
- [x] **Metadata**: Action shown as colored badge, target repo as text with link icon — read-only
- [x] **Agent status panel**: `agentStatus` badge, retry count, last error. "Dispatch Agent" / "Cancel Agent" buttons
- [x] **PR link**: Clickable link to GitHub PR (if `prUrl` set, opens in new tab)
- [x] **Activity Timeline** (`TaskTimeline.tsx`): Unified chronological feed — see 2.6
- [x] **Footer**: "Archive" / "Unarchive" button, "Delete" button (with confirmation dialog)
- [x] **Created/Updated info**: "Created by queen-bee · 2h ago" / "Updated by queen-bee · 5m ago"

##### Edit Mode (toggled from View via pencil button)
- [x] Track `isEditing: boolean` in local component state (not Zustand — scoped to drawer)
- [x] **Header**: Title becomes text input (auto-focused)
- [x] **Body**: Switches to Write/Preview tabs (GitHub-style):
  - **Write tab**: Textarea (or CodeMirror with markdown syntax highlighting)
  - **Preview tab**: Same `<MarkdownPreview>` renderer
  - Tab bar with Radix Tabs, active underline in `honey-400`
  - Toolbar (optional): **B** bold, *I* italic, `<>` code, link, list
- [x] **Metadata**: Action becomes dropdown, target repo becomes text input
- [x] Footer changes: **"Save"** (`honey-400`) commits via `UPDATE_TASK` → returns to view mode. **"Cancel"** discards edits → returns to view mode
- [x] Agent panel, timeline, PR link remain visible (read-only) during edit

#### 2.6 Activity Timeline
- [x] `TaskTimeline.tsx` — Fetches `taskTimeline(taskId)` + `comments(taskId)`, merges into single chronological list sorted by `createdAt`
- [x] Each entry is a `<TimelineEvent>` or inline comment block
- [x] `TimelineEvent.tsx` — Single event row layout: `[icon] [actor badge] [description] [relative timestamp]`
  - Icon per event type: created (plus), moved (arrow-right), status_changed (refresh), agent_started (play), agent_succeeded (check), agent_failed (x), pr_opened (git-pull-request), comment_added (message), archived (archive), title_changed (pencil), body_changed (file-text)
  - Actor badge: User events show username (e.g., "queen-bee"), SYSTEM events show "SYSTEM" badge with distinct styling (monospace, gray bg)
  - Description templates:
    - `created` → "created this task"
    - `moved` → "moved this from **{from}** to **{to}**"
    - `status_changed` → "changed status to **{to}**"
    - `agent_started` → "agent started (**{action}**, attempt #{retry+1})"
    - `agent_succeeded` → "agent succeeded (took {duration})"
    - `agent_failed` → "agent failed: {error}"
    - `pr_opened` → "opened PR #{pr_number}"
    - `comment_added` → (rendered as inline comment, not event row)
    - `archived` → "archived this task"
    - `unarchived` → "unarchived this task"
    - `title_changed` → "changed title from ~~{from}~~ to **{to}**"
    - `action_set` → "set action to **{action}**"
  - Relative timestamps: "just now", "2m ago", "1h ago", "Mar 18"

#### 2.7 Comments
- [x] `TaskComments.tsx` — Comment entries appear inline in the timeline (at their `createdAt` position)
- [x] Each comment block: avatar/username, markdown body (rendered), relative timestamp, "Reply" button, "Edit" / "Delete" actions (only for own comments)
- [x] Threaded replies: Indented below parent comment, max 1 level of nesting. Reply input appears inline when "Reply" clicked
- [x] New comment input at the bottom of the timeline: textarea + "Comment" submit button. Calls `ADD_COMMENT` mutation
- [x] Edit mode: Replace body text with textarea, "Save" / "Cancel" buttons. Calls `UPDATE_COMMENT`
- [x] Delete: Confirmation prompt, calls `DELETE_COMMENT`, removes from timeline

#### 2.8 Board Header & Layout
- [x] Root layout (`__root.tsx`): Full-height dark background, header bar + main content
- [x] Header: App name "HiveBoard" (left), board name (center or left), current user "queen-bee" with avatar placeholder (right)
- [x] "Show Archived" toggle switch in board header — when ON, archived tasks render at bottom of their column with reduced opacity, `[Archived]` badge, not draggable
- [x] Responsive: Columns scroll horizontally on narrow screens, drawer overlays full-width on mobile

#### 2.9 Theming & Polish
- [x] Linear-minimal + Bee palette applied throughout (see "Theme / Design Tokens" section):
  - Surfaces: `surface-page` (bg), `surface-raised` (cards/columns), `surface-overlay` (dropdowns/dialogs), `surface-inset` (inputs)
  - Borders: `border-default` (subtle, barely visible like Linear), `border-hover`, `border-active` (`honey-400`)
  - Text: `text-primary` (headings), `text-secondary` (descriptions), `text-tertiary` (placeholders)
  - Accent: `honey-400` for primary buttons/selected states, used sparingly — most UI is gray-on-gray
  - Badges: muted backgrounds at 15% opacity (e.g., `success-400/15%` bg + `success-400` text)
- [x] Task card hover state: `border-hover` + `shadow-xs`, subtle `whileHover={{ y: -1 }}` via Motion
- [x] Drag preview: Card with slight rotation + `shadow-md`. Drop target columns show `border-active` (`honey-400`)
- [x] Status indicator animations: queued = pulsing `honey-400` dot, running = spinning `info-400` loader
- [x] Smooth drawer open/close via `AnimatePresence` + `motion.div` (slide from right, spring damping)
- [x] Loading states: Skeleton cards (pulse animation on `surface-overlay` rects) while board fetches
- [x] Empty column state: "No tasks" in `text-tertiary`, centered
- [x] Focus rings: `shadow-glow-honey` on focused inputs/buttons (not browser default)

---

### Phase 3: Agent Orchestration
> **Blocks:** Nothing directly (real-time in Phase 4 enhances this)
> **Blocked by:** Phase 1 (needs DB + GraphQL mutations)

#### 3.1 Orchestrator Port (`packages/api/src/orchestrator/`)
- [x] `orchestrator.ts` — New orchestrator that polls SQLite instead of GitHub Projects. Core loop: `SELECT * FROM tasks WHERE agent_status = 'queued' ORDER BY updated_at ASC LIMIT ?` (respects `max_concurrent_agents`)
- [x] Reuse existing concurrency model: `Map<taskId, RunState>` for running agents, `AbortController` per run
- [x] Poll interval configurable (default 5s for local SQLite vs 30s for GitHub API — much faster feedback loop)
- [x] Reconciliation check each cycle: verify running agents still have `agent_status = 'running'` in DB (handles external cancellation via `cancelAgent` mutation)

#### 3.2 Dispatch Flow (SQLite-based)
- [x] On pick up queued task:
  1. `UPDATE tasks SET agent_status = 'running', updated_at = datetime('now')`
  2. INSERT `task_events`: `{type: 'agent_started', actor: 'SYSTEM', data: {action, retry: retryCount}}`
  3. INSERT `agent_runs`: `{task_id, action, status: 'running'}`
  4. Move task to "In Progress" column: `UPDATE tasks SET column_id = (SELECT id FROM columns WHERE name = 'In Progress')` (skip for `plan` and `research` actions)
  5. INSERT `task_events`: `{type: 'moved', actor: 'SYSTEM', data: {from_column, to_column}}` (if moved)
- [x] Workspace creation reuses `src/workspace/manager.ts` — create workspace from `target_repo` field. Clone via `git clone https://.../{target_repo} .` + checkout `task-{ulid}/{title-slug}` branch (ULID in branch name, e.g. `task-01HYX3KPQR/add-oauth2-login-flow`)
- [x] Agent spawning reuses `src/agent/runner.ts` — build prompt from task title + body + action. Claude CLI args: `claude --print --output-format json --model sonnet --max-turns 50 --allowedTools Bash,Read,Write,Edit,Glob,Grep --permission-mode bypassPermissions`
- [x] Map task fields to Issue-compatible shape for prompt template: `{ number: task.id, title, body, action, repo_owner, repo_name, labels: '', url: '' }`

#### 3.3 `dispatchAgent` Mutation (enhanced)
- [x] Validate: task must have `action` set, `agent_status` must be `idle` or `failed`
- [x] For `implement`, `implement-e2e`, `revise` actions: `target_repo` is required (return error if missing)
- [x] For `plan`, `research` actions: `target_repo` is optional (research can be repo-less or repo-scoped)
- [x] SET `agent_status = 'queued'`, clear `agent_error`, increment `retry_count` if re-dispatching after failure
- [x] Publish `taskUpdated` event (Phase 4) so board reflects queued state immediately

#### 3.4 `cancelAgent` Mutation (enhanced)
- [x] If `agent_status = 'queued'`: simply SET `agent_status = 'idle'` (agent hasn't started yet)
- [x] If `agent_status = 'running'`: abort via `AbortController.abort()` on the RunState, wait for process exit, SET `agent_status = 'idle'`
- [x] INSERT `task_events`: `{type: 'status_changed', actor: user_id, data: {from: 'running'/'queued', to: 'idle'}}`
- [x] UPDATE `agent_runs`: SET `status = 'failed'`, `error = 'Cancelled by user'`, `finished_at`

#### 3.5 Completion Handling
- [x] **On success:**
  1. `UPDATE tasks SET agent_status = 'success', agent_output = ?, updated_at = datetime('now')`
  2. UPDATE `agent_runs`: SET `status = 'success'`, `output`, `finished_at`
  3. INSERT `task_events`: `{type: 'agent_succeeded', actor: 'SYSTEM', data: {action, duration_ms}}`
  4. Move task to "Review" column (for `implement`, `implement-e2e`, `revise`). For `plan`, move to "Todo". For `research`, stay in current column
  5. INSERT `task_events`: `{type: 'moved', actor: 'SYSTEM', data: {from_column, to_column}}` (if moved)
  6. If PR was created (implement/implement-e2e): parse PR URL from agent output, `UPDATE tasks SET pr_url = ?, pr_number = ?`, INSERT event `{type: 'pr_opened', data: {pr_url, pr_number}}`
- [x] **On failure:**
  1. `UPDATE tasks SET agent_status = 'failed', agent_error = ?, updated_at = datetime('now')`
  2. UPDATE `agent_runs`: SET `status = 'failed'`, `error`, `finished_at`
  3. INSERT `task_events`: `{type: 'agent_failed', actor: 'SYSTEM', data: {action, error: truncated_message}}`
  4. Retry logic: exponential backoff `delay = min(10000 * 2^attempt, max_retry_backoff_ms)`. Schedule re-queue after delay. Max retries configurable (default 3)

#### 3.6 Workspace Lifecycle & Cleanup
- [x] Reuse `src/workspace/manager.ts` (moved to `packages/api/src/workspace/`) — same isolation model as current:
  - **Create**: `tmp/workspaces/{repoName}/task-{id}/` — one directory per task, cloned from `target_repo`
  - **Branch**: `git checkout -b task-{id}/{title-slug}` (was `issue-{number}/{action}`)
  - **Title slug**: lowercase, replace spaces/special chars with `-`, truncate to 50 chars, trim trailing `-`. E.g. `"Add OAuth2 login flow"` → `add-oauth2-login-flow`
    ```typescript
    function slugify(title: string, maxLen = 50): string {
      return title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, maxLen)
        .replace(/-$/, '')
    }
    // branch: `task-${id}/${slugify(title)}`
    ```
  - **Reuse**: If workspace already exists (e.g., retry), reuse it — don't re-clone
  - **Hooks**: `after_create` hook runs after clone (configurable in `WORKFLOW.md`)
- [x] **TTL sweep** — runs every **1 hour** via `setInterval` in the orchestrator:
  - Walk `tmp/workspaces/{repo}/task-*` directories
  - Remove any workspace with `mtime` older than `workspace.ttl_ms` (default: **72 hours** / 259200000ms)
  - Remove empty parent repo directories after sweep
  - Skip if `ttl_ms <= 0` (disabled)
  - Log each removal: `"Sweeping expired workspace: {path}"`
- [x] **Graceful cleanup on cancel**: When `cancelAgent` kills a running agent, workspace is NOT immediately removed (may be needed for retry). TTL sweep handles eventual cleanup
- [x] **Path safety**: Reuse `src/workspace/path-safety.ts` — symlink-aware validation to prevent directory traversal escapes
- [x] Config in `WORKFLOW.md`:
  ```yaml
  workspace:
    root: ./tmp/workspaces    # workspace root directory
    ttl_ms: 259200000         # 72 hours — stale workspace cleanup
  ```

#### 3.7 `research` Action
- [x] Agent prompt for research: "Research the following topic/codebase and write a detailed summary. Do NOT create a PR. Write your findings below."
- [x] If `target_repo` is set: clone repo into workspace, agent can explore code. Findings written to agent output
- [x] If `target_repo` is null: agent works without repo context (general research via web search if available, or knowledge-based)
- [x] On success: Save research findings to a text file at `tmp/workspaces/{repoName}/task-{id}/research-findings.md` (or `tmp/research/task-{id}/findings.md` if no repo). Store the file path in `agent_runs.output`. Do NOT append to `task.body` — body stays as the user wrote it. Findings are viewable in the agent output panel. Stay in current column, status → `success`
- [x] No PR creation, no column move to Review

#### 3.8 GitHub PR Integration (slimmed)
- [x] Move `src/github/client.ts` → `packages/api/src/github/client.ts`, keep only: auth setup, `createPullRequest()`, `fetchReviewComments()` (for revise action)
- [x] PR creation: after successful `implement` or `implement-e2e`, run `gh pr create --title "{task.title}" --body "{task.body}" --base main --head task-{id}/{title-slug}` in workspace
- [x] Parse PR URL + number from `gh pr create` output, write back to task
- [x] `revise` action: fetch PR review comments via GitHub API, include in agent prompt as context

#### 3.9 Testing
- [x] `packages/api/test/orchestrator.test.ts` — Test dispatch flow: queued → running → success/failure. Test concurrency limit. Test retry scheduling
- [x] `packages/api/test/dispatch.test.ts` — Test `dispatchAgent` validation (missing action, missing repo for implement, etc.)
- [x] `packages/api/test/cancel.test.ts` — Test `cancelAgent` for queued vs running states
- [x] `bun test` passes for all orchestrator tests

---

### Phase 4: Real-time
> **Blocks:** Nothing
> **Blocked by:** Phase 1 (pub/sub), Phase 2 (UI components to wire up), Phase 3 (agent events to subscribe to)

#### 4.1 PubSub Infrastructure
- [x] `packages/api/src/pubsub.ts` — Use GraphQL Yoga's built-in `createPubSub()` (in-memory, single-process). Define channels:
  - `TASK_UPDATED:{boardId}` — fired on any task mutation within a board
  - `AGENT_LOG:{taskId}` — fired for each stdout chunk from Claude CLI
  - `COMMENT_ADDED:{taskId}` — fired when a new comment is added to a task
  - `TASK_EVENT:{taskId}` — fired when a new event is added to a task
- [x] Export typed publish helpers: `publishTaskUpdated(boardId, task)`, `publishAgentLog(taskId, chunk)`, `publishCommentAdded(taskId, comment)`, `publishTaskEvent(taskId, event)`

#### 4.2 Subscription Resolvers
- [x] `taskUpdated(boardId)` — Subscribe to `TASK_UPDATED:{boardId}`. Returns full `Task` object on each publish. Wire into every task mutation resolver (createTask, updateTask, moveTask, archiveTask, etc.) + orchestrator status changes
- [x] `agentLogStream(taskId)` — Subscribe to `AGENT_LOG:{taskId}`. Returns `AgentLogChunk { taskId, chunk, timestamp }`. Orchestrator pipes Claude CLI stdout line-by-line to this channel
- [x] `commentAdded(taskId)` — Subscribe to `COMMENT_ADDED:{taskId}`. Returns full `Comment` object. Fired from `addComment` mutation
- [x] `taskEventAdded(taskId)` — Subscribe to `TASK_EVENT:{taskId}`. Returns full `TaskEvent` object. Fired from every event-producing mutation + orchestrator actions

#### 4.3 Transport Configuration
- [x] GraphQL Yoga SSE transport (default, no extra config needed): subscriptions served at same `/graphql` endpoint via `text/event-stream`
- [x] Vite proxy config: configure SSE pass-through with `changeOrigin: true` and disable response buffering via `configure: (proxy) => proxy.on('proxyRes', (res) => { res.headers['cache-control'] = 'no-cache'; res.headers['x-accel-buffering'] = 'no' })`
- [ ] Test SSE connection in browser DevTools: `EventSource` to `/graphql` with subscription query
- [ ] Fallback: if SSE proves unreliable through Vite proxy, switch to `graphql-ws` WebSocket transport (Yoga supports both)

#### 4.4 Agent Log Streaming
- [x] In orchestrator's agent spawn: capture `stdout` stream from Claude CLI subprocess
- [x] For each line/chunk of stdout: `publishAgentLog(taskId, { chunk: line, timestamp: new Date().toISOString() })`
- [x] Buffer strategy: flush every line (not every byte) to avoid partial JSON/text. Use `readline` interface or split on `\n`
- [x] On agent completion: publish final chunk with `[DONE]` marker so frontend knows stream ended
- [x] Store accumulated output in `agent_runs.output` (concat all chunks) for persistence after stream ends

#### 4.5 Frontend Subscription Client
- [x] `packages/web/src/graphql/subscriptions.ts` — SSE-based subscription client using `graphql-sse` package (pairs with Yoga SSE transport)
- [x] `useSubscription(query, variables)` custom hook: manages EventSource lifecycle (open on mount, close on unmount/variable change), parses SSE `data:` events, returns `{ data, error, isConnected }`
- [x] Connection state indicator in header: green dot when connected, yellow when reconnecting, red on error
- [x] Auto-reconnect on disconnect: exponential backoff (1s, 2s, 4s, max 30s)

#### 4.6 Frontend Integration
- [x] `Board.tsx`: Subscribe to `taskUpdated(boardId)` — on each event, merge updated task into Zustand store (update card in correct column, or move between columns). No full refetch needed
- [x] `TaskDrawer.tsx`: Subscribe to `agentLogStream(taskId)` when drawer is open and agent is running — append chunks to scrollable log viewer. Auto-scroll to bottom on new chunks
- [x] `AgentLogStream.tsx` — Monospace pre-formatted log viewer with:
  - Dark background (`surface-inset`), `text-primary` / `success-400` text (terminal feel)
  - Auto-scroll (with "scroll to bottom" button if user scrolled up)
  - "Copy log" button
  - Status indicator: "Streaming..." / "Completed" / "Failed"
- [x] `TaskTimeline.tsx`: Subscribe to `taskEventAdded(taskId)` — append new events to bottom of timeline in real-time. Smooth scroll-in animation for new entries
- [x] `TaskComments.tsx`: Subscribe to `commentAdded(taskId)` — append new comments to timeline in real-time
- [x] Agent status transitions: `TaskCard.tsx` updates status indicator immediately when `taskUpdated` fires (queued→running shows spinner, running→success shows green check, etc.)

#### 4.7 Testing
- [ ] Manual test: open board in browser, dispatch agent from another tab/API call → verify card updates in real-time
- [ ] Manual test: open task drawer, dispatch agent → verify log stream appears live
- [ ] Manual test: add comment from API → verify it appears in drawer without refresh
- [ ] Verify no memory leaks: EventSource connections close when drawer closes or navigating away

---

### Phase 5: Cleanup
> **Blocks:** Nothing
> **Blocked by:** Phase 3 (orchestrator must be fully ported before removing old code)

#### 5.1 Remove GitHub Projects V2 Code
- [ ] Delete `src/webhook/server.ts` and `src/webhook/handlers.ts` (webhook server no longer needed — board is local)
- [ ] Delete `src/tunnel/cloudflare.ts` (no external webhook endpoint to expose)
- [ ] Remove GitHub Projects V2 query code from `src/github/queries.ts`: delete `PROJECT_ITEMS_QUERY`, `ORG_PROJECT_ITEMS_QUERY`, `USER_PROJECT_ITEMS_QUERY`, `MOVE_ITEM_MUTATION`, `STATUS_FIELD_QUERY`, and all column/label mutation queries
- [ ] Remove corresponding methods from `src/github/client.ts`: `fetchProjectItems()`, `findProjectItemId()`, `moveToColumn()`, `addLabels()`, `removeLabels()`, `setStatusLabel()`, `addComment()`, `refreshToken()` (keep only PR-related methods)
- [ ] Remove `src/github/types.ts` types related to project items and labels (keep PR types)

#### 5.2 Slim GitHub Client to PR-Only
- [x] `packages/api/src/github/client.ts` — Keep only:
  - `createPullRequest(workspace, title, body, baseBranch, headBranch)` — wraps `gh pr create`
  - `fetchReviewComments(prUrl)` — fetches PR review comments for revise action
  - GitHub auth setup (PAT only — simplify by removing GitHub App auth if not needed for PR creation)
- [ ] Remove Octokit dependency if `gh` CLI is sufficient for all remaining operations
- [ ] If keeping Octokit: remove `@octokit/webhooks` from `package.json` dependencies

#### 5.3 Remove Old Orchestrator
- [ ] Delete or archive `src/orchestrator/orchestrator.ts` (replaced by `packages/api/src/orchestrator/`)
- [ ] Delete `src/orchestrator/state.ts` (state now in SQLite, not in-memory maps)
- [ ] Delete `src/labels/parse-repo.ts` (no more label-based parsing — `target_repo` is a direct DB field)
- [ ] Delete `src/types/issue.ts` `Issue` interface (replaced by `Task` type from DB)
- [ ] Delete `src/config/schema.ts` fields: `tracker.labels`, `tracker.columns`, `webhook.*` (no longer used)
- [ ] Delete `src/ssh/client.ts` if SSH worker support is deferred (or keep if still needed)

#### 5.4 Dependency Cleanup
- [ ] Remove from root `package.json` dependencies:
  - `@octokit/webhooks` (webhook verification no longer needed)
  - `@octokit/auth-app` (if simplifying to PAT-only)
  - `octokit` (if all GitHub ops go through `gh` CLI)
- [ ] Remove from root `package.json` devDependencies:
  - `@types/mustache` (if prompt templates move to template literals)
  - `mustache` (if no longer used for prompts)
- [ ] Run `bun install` to update lockfile
- [ ] Verify no unused imports or dead requires in remaining code (`bunx biome lint .`)

#### 5.5 Configuration Updates
- [ ] `WORKFLOW.md` — Remove or simplify YAML front matter:
  - Remove `tracker.labels` section (action_prefix, repo_prefix, status_running, status_failed)
  - Remove `tracker.columns` section (columns defined in DB seed now)
  - Remove `webhook` section (port, secret)
  - Keep: `claude.*` config (model, max_turns, etc.), `agent.*` (concurrency, backoff), `workspace.*` (root, TTL, hooks)
  - Port config via env vars `API_PORT` (default 8080) / `WEB_PORT` (default 5173) — no need to duplicate in YAML
- [x] `.env.example` — Replace with new template (see "GitHub Auth Configuration" section). Support both `GITHUB_TOKEN` (PAT) and `GITHUB_APP_*` (App) auth. Remove `GITHUB_WEBHOOK_SECRET`, `GITHUB_OWNER`, `GITHUB_PROJECT_NUMBER`. Add `DATABASE_PATH`, `API_PORT`, `WEB_PORT`
- [x] Update `Dockerfile` — Multi-stage build (see "Production via Docker" section): deps → build-web (`vite build`) → production image. API serves static web assets in production. Single port `API_PORT` (default 8080). No Vite in production
- [x] Update `docker-compose.yml` — Single service, `NODE_ENV=production`, volumes for `tmp/database/` (SQLite) + `tmp/workspaces/` (agents) + `WORKFLOW.md`. Health check via `/health` endpoint
- [x] API `index.ts` — Detect `NODE_ENV=production`: serve `packages/web/dist/` as static files + SPA fallback (all non-`/graphql` routes → `index.html`). In dev mode, don't serve static files (Vite handles it)
- [ ] Update `Makefile` — Update `dev`, `build`, `start` targets to use new monorepo scripts

#### 5.6 Documentation
- [ ] Update `README.md`:
  - New architecture diagram (SQLite + GraphQL + React, no GitHub Projects dependency)
  - Simplified setup: `bun install && bun run dev` (starts both API + web)
  - Remove GitHub Projects setup steps (project creation, webhook config, Cloudflare tunnel)
  - Keep GitHub token setup (still needed for PR creation)
  - Document new env vars and config options
- [ ] Archive `SPEC-OWNED-BOARD.md` or convert to `ARCHITECTURE.md` as living documentation

#### 5.7 Final Verification

**Local dev (Bun):**
- [ ] `bun run dev` starts both API (8080) and web (5173) successfully
- [ ] Board loads in browser at `localhost:5173` with seeded data
- [ ] Full task lifecycle works: create → dispatch → agent runs → PR created → move to Review
- [ ] `API_PORT=9000 bun run dev:api` starts API on port 9000 (env override works)
- [ ] `WEB_PORT=3000 bun run dev:web` starts web on port 3000 (env override works)

**Docker (production):**
- [ ] `docker compose up --build` builds and starts successfully
- [ ] Board loads in browser at `localhost:8080` (single port, API serves static assets)
- [ ] `/graphql` endpoint responds (API)
- [ ] `/` serves `index.html` from built web assets (SPA)
- [ ] Client-side routing works (refresh on any path → SPA fallback → `index.html`)
- [ ] `tmp/database/hiveboard.db` persists across container restarts (volume mount)
- [ ] Health check passes: `curl http://localhost:8080/health` → `{ "ok": true, ... }`

**Code quality:**
- [ ] `bunx biome lint .` reports no errors
- [ ] `bunx tsc --noEmit` passes (no type errors)
- [ ] `bun test` passes all tests (API + orchestrator)
- [ ] No dead code: no unreachable imports, no unused exports, no orphaned files in `src/`
- [ ] Git clean: no untracked generated files committed, `.gitignore` covers `tmp/database/`, `node_modules/`, `dist/`, `packages/web/dist/`
