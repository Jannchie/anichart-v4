# AGENTS.md

Primary guidance for agents and contributors working in this repository (this
is the canonical doc; `CLAUDE.md` and other agent files just point here). It
captures the architecture, workflows, and conventions that aren't obvious from
any single file.

## What this is

**AniChart v4** is a PIXI.js-based animated data-visualization framework — bar
chart races and line/trend charts — that can also be rendered to video via
Remotion. The repo is a **pnpm + Turborepo monorepo**.

| Package | Path | Role |
| --- | --- | --- |
| `@anichart/core` | `packages/core` | The library: PIXI.js animated chart engine (the only published package). |
| `playground` | `apps/playground` | Interactive Vite demo / sandbox — real-time playback with speed control, dataset & chart-type switching. The canonical usage example. |
| `docs` | `apps/docs` | VitePress documentation. |
| `studio` | `apps/studio` | Remotion video-render project (frame-by-frame → mp4). Seed of the future video-export feature. |
| `web` | `apps/web` | Nuxt 4 SaaS — upload data, configure charts, play & share works. |

Comments and many docs in this codebase are written in **Chinese**. Match the
surrounding language when editing comments in a file.

## Build & dev commands

Install once with `pnpm install` (Node 22, pnpm 10.x via `packageManager`).

Root commands run through Turborepo (see `turbo.json`):

```bash
pnpm build       # build all packages in dependency order
pnpm test        # run tests (currently only @anichart/core vitest)
pnpm typecheck   # full type-check
pnpm lint        # full lint
pnpm dev         # parallel dev (core builds in watch mode for consumers)
```

Target one package with a filter:

```bash
pnpm --filter @anichart/core build
pnpm --filter playground dev   # http://localhost:4301
pnpm --filter docs dev         # http://localhost:4302 (preview: 4304)
pnpm --filter web dev          # http://localhost:4300 — needs apps/web/.env (see .env.example)
pnpm --filter studio start     # Remotion Studio, http://localhost:4303
```

Every app pins a **unique dev port** (43xx range, configured in each app's
config/scripts) so services never collide with each other or with other
projects' defaults — keep this property when adding a new app or service.
Currently allocated: web 4300, playground 4301, docs 4302 (preview 4304),
studio 4303, Postgres 4305, MinIO 4306 (console 4307).

### Critical build-ordering rule

Apps consume `@anichart/core`'s **built `dist`** (not its source) at runtime via
the package `exports` map. Turborepo orders this through the `^build` dependency,
so `pnpm build`/`pnpm dev`/`pnpm typecheck`/`pnpm test` all build core first.

There is one deliberate exception: **type-checking** resolves `@anichart/core`
to its `src` via the `"development"` custom condition in `tsconfig.base.json`
(`customConditions: ["development"]`). This means types come from source (always
fresh, no stale `.d.ts`), while runtime imports still come from `dist`. If you
run an app's dev/build without having built core, runtime imports will fail —
let Turbo handle ordering, or build core manually first.

## Architecture: `@anichart/core`

The render pipeline is: **`Config` → `DataProcessor` → `BarChart`/`LineChart`
(a PIXI `Container`) → `.update(frameIndex)` per frame.** Everything is
precomputed per-frame at construction; `update(frame)` only reads precomputed
state and drives PIXI display objects. This is what lets the same chart play
in real time (playground/web) and render deterministically frame-by-frame
(studio/Remotion) from identical code.

Source files in `packages/core/src` (~2.8k LOC total):

- **`index.ts`** — the public API barrel. Anything not re-exported here is
  internal. Exports: `BarChart`, `LineChart`, `Config`, `DataProcessor`,
  `BarComponent`, `computeInversionMetrics`, the `resources` (`colors`,
  `colorMap`, `textureMap`), and config/data types.
- **`Config.ts`** — public `ConfigInput` (all optional) is normalized into a
  flat `Config` instance. Note the shape: grouped/discriminated inputs like
  `swap`, `line`, `valueScale` are flattened onto the instance (e.g.
  `config.swapAccelBoost`, `config.lineTimeAxisMode`, `config.valueScaleType`).
  Some fields are **auto-derived** and not separately exposed (e.g.
  `valueScaleSmoothing` and `valueSmoothingRadius` derive from `swapDurationSec`
  / `valueSmoothing`). Fields accept either a column name (string) or an
  accessor function (`FieldOrAccessor`).
- **`DataProcessor.ts`** — static `processCSV(path, config)` / `processRows(rows,
  config)` turn raw d3 CSV rows into `RankedData[][]` (one inner array per frame).
  Owns the heavy lifting: sampling/interpolation, carry-forward retention
  windows, fade in/out, baseline scaling, and the **swap algorithm registry**.
- **`bar.ts`** — `BarComponent`, the per-bar PIXI display object (rect + labels
  + image), with its own `update({...})` for position/width/alpha tweening.
- **`BarChart.ts`** / **`LineChart.ts`** — the two chart containers. Each
  precomputes per-frame scales/tick components in its constructor, then exposes
  `update(frameIndex)`.
- **`Data.ts`** — `Data` and `RankedData` (adds `rank` + `blurRank`) interfaces.
- **`resources.ts`** — shared color palette (`colors` ordinal scale tuned for
  dark backgrounds), and the module-level `colorMap` / `textureMap` (string →
  PIXI `Texture`) registries.
- **`utils/`** — `scale.ts` (value-domain scales incl. adaptive soft-saturation),
  `chartChrome.ts` (shared title/tick constants), `textMetrics.ts`,
  `labelFonts.ts`, `inversionMetric.ts` (measures animation "smoothness" via
  inversion-pairs × frames — used by playground to compare swap tuning).

### Swap algorithms (rank movement)

Vertical rank motion uses a pluggable algorithm registered in `DataProcessor`'s
`SWAP_ALGORITHMS` record (defined at the bottom of the file — it references the
class's static methods, so it can't move up without a TDZ error). To add one:
add a member to the `SwapAlgorithmName` union in `Config.ts` **and** register its
implementation in the registry. Current ones: `velocity` (pure feedback,
decelerate-to-target) and `velocity-accel` (adds distance-adaptive acceleration;
`accelBoost=0` degrades to `velocity`).

Both run through `runVelocity`, which additionally applies two orthogonal,
config-driven mechanisms (see `SwapConfig`):

- **Lookahead (preview control)** — the whole pipeline is precomputed offline,
  so the future rank signal is known; the tracking target is read from frame
  `t + L` instead of `t`. A causal tracker always crosses *after* the data
  crossing (that lag *is* the inversion); advancing the phase by `L ≈ half the
  1-rank travel time (0.175·durationSec − 1 frame)` centers the visual crossing
  on the data crossing. Measured on go/gdp/llm: inversion seconds −60~−90%
  with smoothness/reversal metrics bit-identical (phase only, shaping intact).
- **Bottom-edge fade-band speed caps** — bars crossing the alpha fade band
  (`blurRank ∈ (topN−1, topN)`) are speed-capped so enter/exit takes at least
  `enterFadeSec`/`exitFadeSec`. The enter cap alone would add lag (= inversion),
  so entering bars get extra lookahead (`swapEnterExtraFrames`) to depart
  earlier and arrive on time — slow entrances at near-zero inversion cost.

`packages/core/bench-inversion.mts` (run with `tsx`) is the A/B harness used to
derive these defaults; it compares variants on the playground CSVs using
`utils/inversionMetric.ts`.

### Build config for core

`packages/core/vite.config.ts` builds an ES-only lib, externalizes
`pixi.js`/`d3`/`dayjs` (peer/runtime deps resolved by the consumer so PIXI stays
a single instance), and emits a flat `dist/index.d.ts` via `vite-plugin-dts`
(`entryRoot: 'src'` is required — dts@5 otherwise keeps the `src/` prefix and
breaks the `types` pointer). `pixi.js` is a **peerDependency**.

## App integration patterns

- **playground** (`apps/playground/src/main.ts`) — the reference real-time
  player: build a `Config`, `DataProcessor.processCSV` → data, create a PIXI
  `Application`, `new BarChart(data, config)`, then drive `chart.update(frame)`
  from a RAF loop with speed control. `datasets.ts` defines selectable demos.
- **studio** (`apps/studio/src/baseComposition.tsx`) — same core calls wrapped
  in a Remotion component: `useCurrentFrame()` → `bar.update(frame)`, with
  `delayRender`/`continueRender` around async data init. Output composition is
  `AniComp` in `Root.tsx`. Note: studio is **excluded from root eslint**.
- **web** (`apps/web`, Nuxt 4) — a YouTube-style content platform (feed /
  watch / channel / search / studio) with Vercel-style monochrome design
  tokens (`app/assets/css/main.css`, light+dark via `data-theme`).
  `app/components/ChartCanvas.client.vue` reuses core for in-browser playback
  (editor preview, watch page, feed hero). `app/lib/chart-spec.ts` is the key
  indirection: `ChartSpec` is a **serializable** (primitives-only) config
  stored in DB/IndexedDB; `buildConfig(spec)` derives the real `ConfigOptions`
  (with accessor functions) at runtime — `work.chartConfig` in Postgres stores
  `ChartSpec`, never `ConfigOptions`.

  **Local backend** (`apps/web/docker-compose.yml`): Postgres 16 on **4305**,
  MinIO on **4306** (console **4307**), bucket auto-created by the `minio-init`
  container. Startup order matters:

  ```bash
  docker compose -f apps/web/docker-compose.yml up -d
  cp apps/web/.env.example apps/web/.env   # + random BETTER_AUTH_SECRET
  pnpm --filter web db:migrate
  pnpm --filter web dev                    # 4300
  pnpm --filter web db:seed                # needs dev server up (sign-up via HTTP)
  ```

  Data flow: editor drafts live in IndexedDB (`app/lib/store.ts`); publishing
  (`app/lib/publish.ts`) presigns + direct-PUTs the CSV to S3, registers a
  `dataset`, then POSTs the `work` with a base64 poster (server-side upload —
  no browser CORS for images). Watch playback fetches CSV through the
  server-side proxy `GET /api/works/[slug]/csv` (visibility enforced
  server-side); posters proxy via `GET /api/posters/...`. Works routes are
  keyed by **slug** everywhere — sibling dynamic params at the same path
  segment must share one name (radix routing), so never add a `[id]` route
  beside `works/[slug]`. Video export (`server/utils/render.ts`) is a stubbed
  501 placeholder that will reuse the studio Remotion pipeline.

## Coding style & conventions

- **Language/types:** all TypeScript, strict. ESLint uses
  `@jannchie/eslint-config` (`eslint.config.js`) — modern ECMAScript syntax,
  import ordering, strict TS checks. camelCase functions/vars, PascalCase
  exported classes/components, kebab-case filenames (except files exporting a
  React/Vue component). Prefer `const`, destructuring, explicit return types.
  Colocate related types/helpers with their consumer; keep modules focused.
- **eslint scope quirks** (`eslint.config.js`): `apps/studio/**` and
  `apps/web/app/**` (Vue SFCs/composables, handled by Nuxt's own resolution) are
  ignored at root. Nuxt server files (`apps/web/server/**`) rely on Nitro
  auto-imports declared as globals there — when you add a cross-file
  auto-imported server util, register it in that globals block or `no-undef`
  will fire.

## Testing

Vitest. Specs live in `packages/core/src/__tests__/*.test.ts` (or next to the
implementation with a `.test.ts` suffix). Coverage is sparse today (Config,
DataProcessor, scale, inversionMetric); favor scenario tests of rendering logic,
data transforms, and time-based animation. Run with `pnpm test` or
`pnpm --filter @anichart/core test`, and gate PRs on a passing run.

## Commit & PR guidelines

- **Commits:** Conventional Commits — `<type>(<scope>): <summary>`, meaningful
  scope, summary < 72 chars (e.g. `refactor(chart): replace forEach with
  for-of loops`).
- **PRs:** include a concise problem statement, the solution outline, and
  testing evidence. Link tracking issues; attach screenshots/GIFs for visual
  changes; request reviews from maintainers of the affected modules. **Do not
  open a PR unless explicitly asked.**

## Environment & assets

Store large media in `public/` or a CDN, not `src/`. Use Vite's
`VITE_`-prefixed env vars and document new ones in the README. Sanitize external
data sources and provide type definitions so the rendering pipeline stays
predictable. The `apps/playground/public/flagpack` git submodule supplies flag
images — clone with `--recursive` / `git submodule update --init` (CI uses
`submodules: recursive`).

The LMArena sample data (`llm*.csv`) is generated by
`scripts/update-llm-data.py`. The text leaderboard (`llm.csv`, shared by
playground/studio/web) splices three sources: pre-2025-08 history frozen in
`scripts/data/llm-legacy.csv`, the HuggingFace `lmarena-ai/leaderboard-dataset`
parquet, and a live arena.ai snapshot as the final frame. WebDev / Vision /
Search / Text-to-Image (`llm-webdev.csv` etc., playground only) use the same
parquet+live pipeline; the Agent board has no historical dataset, so it is
reconstructed from Wayback Machine daily snapshots (win-rate ×100). Company
display names double as the logo filenames under `public/logos/` (downloaded
via `--logos`); model slugs are prettified by an override table + rules in the
same script, with all parenthetical annotations dropped.

## CI

`.github/workflows/ci.yml` runs on PRs and pushes to `main`:
`turbo run lint typecheck test build` on Node 22 with a turbo cache. It injects
placeholder `DATABASE_URL`/`BETTER_AUTH_*` env (web reads them lazily at
runtime, so build doesn't need real secrets). **Keep lint, typecheck, test, and
build green before pushing.** `render-video.yml` is a manual
(`workflow_dispatch`) job that renders the studio composition to an mp4
artifact.
