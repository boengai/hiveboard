# Conventions

Coding standards and patterns used across the HiveBoard monorepo. For deployment
and ops details see [`maintainer-guide.md`](./maintainer-guide.md).

---

## 1. Naming Conventions

| Context | Style | Example |
|---------|-------|---------|
| DB columns | `snake_case` | `created_at`, `agent_status`, `target_branch` |
| GraphQL fields | `camelCase` | `createdAt`, `agentStatus`, `targetBranch` |
| TypeScript variables/functions | `camelCase` | `boardId`, `moveTask` |
| React components | `PascalCase` | `TaskCard`, `MarkdownEditor` |
| Component files | `PascalCase.tsx` | `Button.tsx`, `TaskDrawer.tsx` |
| Type aliases | `PascalCase` | `ButtonProps`, `CreateTaskInput` |
| GraphQL enums | `UPPER_CASE` | `IDLE`, `RUNNING`, `FAILED` |
| CSS custom properties | `kebab-case` | `--color-honey-400`, `--shadow-md` |

---

## 2. Biome Configuration

The project uses **Biome 2.4** for linting and formatting. Key rules from
[`biome.json`](../biome.json):

| Rule | Setting |
|------|---------|
| Quote style | **Single quotes** |
| Semicolons | **As needed** (omitted where possible) |
| Trailing commas | **All** |
| Indent | **2 spaces** |
| Import organization | **Auto-sorted** (`organizeImports: "on"`) |
| Unused imports | **Error** |
| Unused variables | **Warn** |
| Type definitions | **`type` over `interface`** (enforced via `useConsistentTypeDefinitions`) |

All types are extracted to `packages/web/src/types/` and imported from there.
Never define inline interfaces in component files.

---

## 3. File Structure

### Web package layout

```
packages/web/src/
  components/
    common/           # Reusable, feature-agnostic UI primitives
      button/
        Button.tsx
        index.ts      # Barrel: export { Button } from './Button'
      badge/
      drawer/
      icon/
      input/
      markdown/
      index.ts        # Re-exports all common components
    feature/          # Domain-specific components
      agent/
      board/
      task/
      index.ts        # Re-exports all feature components
    index.ts          # Re-exports common/ and feature/
  graphql/            # Client, queries, mutations, subscriptions
  pages/
  routes/
  store/
  types/              # All shared TypeScript type aliases
  utils/
  constants/
```

### Import conventions

- **`@/` path alias** maps to `packages/web/src/` (configured in both
  `tsconfig.json` and `vite.config.ts`).
- **Barrel exports** — every component directory has an `index.ts`. Import from
  the barrel, not the file directly:
  ```ts
  // Good
  import { Button, Badge } from '@/components'

  // Bad
  import { Button } from '@/components/common/button/Button'
  ```

---

## 4. Styling

### Tailwind CSS v4

Styles are defined in [`packages/web/src/index.css`](../packages/web/src/index.css)
using Tailwind v4's `@theme` directive. The project uses the `@tailwindcss/vite`
plugin (no PostCSS config).

### Bee Color Palette (OKLCH)

All colors are defined in OKLCH color space for perceptual uniformity.

| Token family | Hue | Purpose |
|--------------|-----|---------|
| `gray-50`..`gray-950` | 80 | Warm-tinted neutrals |
| `honey-50`..`honey-900` | ~85 | Primary / accent (amber) |
| `success-*` | 165 | Positive state |
| `error-*` | 25 | Destructive / error |
| `info-*` | 240 | Informational |
| `warning-*` | 70 | Caution |
| `purple-*` | 310 | Agent / AI actions |
| `teal-*` | 195 | Supplementary accent |

Semantic surface tokens (`surface-page`, `surface-raised`, `surface-overlay`,
`surface-inset`) and border tokens (`border-default`, `border-hover`,
`border-active`) are aliased from the gray/honey scales.

### `tv()` Variants (tailwind-variants)

Use `tv()` from `tailwind-variants` to declare component style variants. Import
the re-export from `@/utils`:

```tsx
import { tv } from '@/utils'

const cardVariants = tv({
  base: 'rounded-md border border-border-default p-3',
  variants: {
    active: { true: 'border-honey-400 shadow-glow-honey' },
  },
})
```

### Data Attributes for State

Prefer **`data-*` attributes** over className ternaries for visual state
changes. This keeps markup declarative and lets Tailwind's `data-[attr=value]:`
modifier handle styling:

```tsx
// Good
<div
  className="opacity-100 data-[dragging=true]:opacity-40"
  data-dragging={isDragging ? 'true' : 'false'}
/>

// Bad
<div className={isDragging ? 'opacity-40' : 'opacity-100'} />
```

### Common component props

Common components (`Button`, `Badge`, etc.) **do not accept `className` or
`style` overrides**. All visual variants must go through `tv()` props.

---

## 5. Commit Messages

Commits use an **emoji prefix** followed by a short imperative description:

| Emoji | Meaning |
|-------|---------|
| `✨` | New feature |
| `🐛` | Bug fix |
| `♻️` | Refactor |
| `💅` | Style / UI tweak |
| `🗑️` | Remove / deprecate |
| `📝` | Documentation |
| `🧪` | Tests |
| `🔧` | Configuration / tooling |
| `📦` | Dependencies |
| `🔒` | Security / access control |
| `🎨` | Visual / formatting polish |

Format: `<emoji> <Imperative sentence>`
Example: `✨ Add target_branch field to tasks, defaulting to 'main'`

---

## 6. GraphQL

### Schema-first

The schema is defined as a **tagged template literal** in
[`packages/api/src/schema/typeDefs.ts`](../packages/api/src/schema/typeDefs.ts)
using the `/* GraphQL */` tag for IDE syntax highlighting. Resolvers are
implemented against this schema.

### Naming

- Types: `PascalCase` (`Task`, `AgentRun`, `TaskEvent`)
- Fields: `camelCase` (`createdAt`, `agentStatus`)
- Enums: `UPPER_CASE` values (`IDLE`, `QUEUED`, `RUNNING`, `SUCCESS`, `FAILED`)
- Inputs: `PascalCase` with `Input` suffix (`CreateTaskInput`, `UpdateTaskInput`)
- Mutations: `camelCase` verb-first (`createTask`, `moveTask`, `archiveTask`)

### Subscriptions via SSE

Subscriptions use **Server-Sent Events** via the `graphql-sse` library (not
WebSockets). The Vite dev server proxies `/graphql` to the API with SSE
pass-through headers (`cache-control: no-cache`, `x-accel-buffering: no`).

---

## 7. Database

### Engine

SQLite via Bun's built-in `bun:sqlite` driver. Single-file, local-first.

### ID generation

All primary keys are **ULID** strings stored as `TEXT`. ULIDs are
lexicographically sortable by creation time.

### Timestamps

All `*_at` columns are `TEXT` using SQLite's `datetime('now')` default. No
integer epoch timestamps.

### Positions

Task ordering uses `REAL` (floating-point) position values, allowing insertion
between any two adjacent items without reindexing the entire list.

### Comments

Comments support **max 1-level nesting**. A comment can have a `parent_id`
referencing another comment, but replies to replies are not allowed. The GraphQL
`Comment` type exposes a `replies` field for this single level.

### Tables

`users`, `boards`, `columns`, `tasks`, `task_comments`, `task_events`,
`agent_runs` — see
[`packages/api/src/db/schema.ts`](../packages/api/src/db/schema.ts) for the
full DDL.

### Indexes

Composite and single-column indexes exist on high-query paths:
- `idx_tasks_board_column` — `(board_id, column_id)`
- `idx_tasks_agent_status` — `(agent_status)`
- `idx_task_events_task` — `(task_id, created_at)`
- `idx_task_comments_task` — `(task_id)`
- `idx_agent_runs_task` — `(task_id)`
