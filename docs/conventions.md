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
        index.ts      # Barrel: export * from './Button'
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
    hooks/
        index.ts      # Barrel: export * from './useFoo'
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

  Vite tree-shakes barrels for production builds; the dev cold-start cost is
  accepted in exchange for stable, refactor-friendly imports. Deep imports are
  reserved for hot paths with **measured** startup impact — leave a brief
  comment at the import site explaining why (see `App.tsx` for an example).

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

### Prefer wrappers over raw primitives

Prefer the wrappers in `components/common/` (`Button`, `TextInput`,
`SelectInput`, `TextAreaInput`, `ComboboxInput`) over raw `<button>`,
`<input>`, `<select>`, or `<textarea>`. This keeps design tokens and
interaction states centralized.

If an existing wrapper doesn't fit a use case, **add a new variant** to the
wrapper rather than one-off styling at the call site. Extending the variant
matrix keeps new designs discoverable and prevents drift away from the design
system.

Raw primitives are reasonable when they fall outside the design system entirely
— for example, hidden file inputs, or card-shaped interactive regions that
contain their own sub-elements (`Badge` / `Avatar`) and aren't button-shaped.
Add a short comment at these sites so the exception is visible.

**Card-shaped interactive regions:** when the outer surface is itself
clickable (or implicitly `role="button"` via a drag handle, e.g. dnd-kit's
`useSortable` listeners), interactive children must not be `<button>`
elements — that produces a nested-button a11y violation. Use `<a>` for
navigation actions; for in-page actions, move the action out of the card
surface.

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

### Resolver auth

Every resolver that reads or writes task-scoped data must go through
`requireAuth` and, when keyed on a task id, `requireTaskAccess`. This applies
uniformly to queries, mutations, **and subscriptions** — there is no "read-only
stream" exemption. New subscription resolvers that forget `requireTaskAccess`
are treated as a bug, not a style issue.

---

## 7. Database

### Engine

SQLite via Bun's built-in `bun:sqlite` driver. Single-file, local-first.

### ID generation

All primary keys are **ULID** strings stored as `TEXT`. ULIDs are
lexicographically sortable by creation time.

Any filesystem operation keyed on a task id (reading, writing, appending, or
resolving a path under `{agent.state_root}/{task-id}/`) must validate the id
against `/^[0-9A-HJKMNP-TV-Z]{26}$/` **before** touching the fs. Use the shared
`assertValidTaskId` helper in `packages/api/src/agent/agent-state.ts`. Never
interpolate an unvalidated id into a path.

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

---

## 8. Runtime Singletons & Agent State

### Config access

The API supports a **dual config pattern**:

- **Resolvers** read config via the `getConfig()` singleton at
  [`packages/api/src/config/singleton.ts`](../packages/api/src/config/singleton.ts),
  mirroring the existing `orchestrator/singleton.ts`. Resolvers should not
  receive `config` through their context or arguments.
- **Orchestrator and runner code** continue to accept `config: Config`
  explicitly as a parameter, because they are constructed once at startup and
  benefit from explicit dependency injection for testability.

When adding a new module, match the pattern of its neighbors: resolver-adjacent
code uses the singleton; orchestrator-adjacent code takes config as an argument.

### Per-task files

All agent-owned per-task files (transcripts, scratchpads, tool logs, etc.) live
under `{agent.state_root}/{task-id}/` on disk and **never** in the workspace
tree. They are written **append-only via shell `>>`**, never via the `Write`
tool — this is enforced through prompt discipline codified in
[`docs/WORKFLOW.md`](./WORKFLOW.md) and the per-task prompt blocks. New
per-task artifacts must follow this layout and append-only rule.

### Secret handling

Plaintext secret values must never appear in GraphQL responses, log output, or
field resolvers — only names and non-sensitive metadata are returned. As
defense-in-depth, `agent_runs.output` is scrubbed by a post-run literal-match
pass against known secret values before persistence. When introducing a new
secret-bearing surface, add it to both the exclusion list for resolvers and the
post-run scrubbing pass.

---

## 9. React Patterns

Project-specific defaults that prevent unnecessary re-renders and keep
stateful behavior predictable. Deviate only with a concrete reason.

### Zustand selectors

Subscribe to one field per call. A whole-store destructure re-renders the
component on any unrelated state change.

```tsx
// Good
const board = useBoardStore((s) => s.board)
const closeDrawer = useBoardStore((s) => s.closeDrawer)

// Bad
const { board, closeDrawer /* ... */ } = useBoardStore()
```

### memo + primitive props for list items

Components rendered in a loop (cards, rows) should be wrapped in `memo` and
receive **primitive** props — strings, numbers, booleans — rather than whole
objects. The store frequently produces fresh object references for unchanged
data (e.g. `{ ...col, tasks }` in `mergeTaskUpdate`), which defeats `memo`'s
strict-equality bail-out.

```tsx
// Good
<TaskCard columnName={column.name} task={task} />
export const TaskCard = memo(function TaskCard({ task, columnName }) { ... })

// Bad — column gets a new ref on every store update
<TaskCard column={column} task={task} />
```

### Module-level cache for shared storage reads

Hooks that read `localStorage` / `sessionStorage` and are mounted by many
sibling components should hoist the read/parse into a module-level cache,
with writes going through the cache. Avoids re-parsing JSON on every mount.

```tsx
let cache: Record<string, boolean> | null = null

function readMap() {
  if (cache) return cache
  try { cache = JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  catch { cache = {} }
  return cache
}
```

### Lazy state initialization

For non-trivial initial values (storage reads, `JSON.parse`, search-index
build), pass a function to `useState` so it runs once instead of every render.

```tsx
// Good
const [settings] = useState(() => readMap())

// Bad — runs on every render
const [settings] = useState(readMap())
```

### Don't define components inside components

A component declared in another component's body is a new type on every parent
render, causing full unmount/remount and state loss. Always declare components
at module scope and pass props.
