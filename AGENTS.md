# Repository Guidelines

## Project Structure & Module Organization

The repo is a pnpm + Turborepo monorepo. The library lives in `packages/core` (`@anichart/core`), the PIXI.js chart engine (rendering, composition, shared utilities under `src/`). Applications live under `apps/`: `playground` (interactive Vite demo of the library), `docs` (VitePress), `studio` (Remotion video-render project; seed of the future video-export feature), and `web` (Nuxt SaaS — upload data, configure charts, play & share works). Shared config sits at the root: `tsconfig.base.json` (each package extends it), `pnpm-workspace.yaml`, `turbo.json`, `eslint.config.js`. Apps consume `@anichart/core`'s built `dist` (not its source), so build the library before running app dev/build/typecheck — Turborepo orders this via `^build`.

## Build, Test, and Development Commands

Install with `pnpm install`. Root commands run through Turborepo: `pnpm build` (build all packages in dependency order), `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm dev` (parallel dev; core builds in watch mode for consumers). Target one package with a filter, e.g. `pnpm --filter playground dev`, `pnpm --filter docs dev`, `pnpm --filter web dev`, `pnpm --filter studio start`, `pnpm --filter @anichart/core build`. Keep builds clean before pushing.

## Coding Style & Naming Conventions

All code is TypeScript. Follow the defaults from `@jannchie/eslint-config`, which enforces modern ECMAScript syntax, import ordering, and strict TypeScript checks. Use camelCase for functions and variables, PascalCase for exported classes and components, and kebab-case for filenames unless the file exports a React component. Prefer const, destructuring, and explicit return types. Keep modules focused and colocate related types or helpers beside their consuming components.

## Testing Guidelines

Formal tests are not yet established. When adding coverage, use Vitest and colocate specs under `src/__tests__/` or next to the implementation with a `.test.ts` suffix. Aim for scenario-focused tests that validate chart rendering logic, data transforms, and time-based animations. Run suites via `pnpm vitest` once the script is introduced, and gate pull requests on a passing run.

## Commit & Pull Request Guidelines

Commit messages follow `<type>(<scope>): <summary>`, for example `refactor(chart): replace forEach with for-of loops`. Keep scopes meaningful and summaries under 72 characters. For pull requests, include a concise problem statement, the solution outline, and testing evidence. Link tracking issues, attach relevant screenshots or GIFs for visual changes, and request reviews from maintainers familiar with the affected modules.

## Environment & Asset Tips

Favor environment-agnostic code: rely on Vite’s env variables prefixed with `VITE_`, and document new ones in the README. Store large media assets in `public/` or a CDN rather than embedding inside `src/`. When adding external data sources, sanitize inputs and provide type definitions so rendering pipelines stay predictable.
