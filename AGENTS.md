# Repository Guidelines

## Project Structure & Module Organization

The project is organized as a Vite-powered TypeScript workspace. Core source files live in `src/`, which contains rendering logic, chart composition, and shared utilities. Static assets and the base HTML shell reside in `public/` and `index.html`. Temporary experiments belong in `playground/`, keeping prototype code separate from production modules. Shared configuration files such as `tsconfig.json`, `pnpm-workspace.yaml`, and `eslint.config.js` sit at the root so new packages inherit consistent settings.

## Build, Test, and Development Commands

Install dependencies with `pnpm install`. Use `pnpm dev` for the hot-reloading development server, `pnpm build` to run `tsc` type checks followed by a production bundle, and `pnpm preview` to review the optimized build locally. Keep builds clean before pushing by ensuring `pnpm build` completes without warnings.

## Coding Style & Naming Conventions

All code is TypeScript. Follow the defaults from `@jannchie/eslint-config`, which enforces modern ECMAScript syntax, import ordering, and strict TypeScript checks. Use camelCase for functions and variables, PascalCase for exported classes and components, and kebab-case for filenames unless the file exports a React component. Prefer const, destructuring, and explicit return types. Keep modules focused and colocate related types or helpers beside their consuming components.

## Testing Guidelines

Formal tests are not yet established. When adding coverage, use Vitest and colocate specs under `src/__tests__/` or next to the implementation with a `.test.ts` suffix. Aim for scenario-focused tests that validate chart rendering logic, data transforms, and time-based animations. Run suites via `pnpm vitest` once the script is introduced, and gate pull requests on a passing run.

## Commit & Pull Request Guidelines

Commit messages follow `<type>(<scope>): <summary>`, for example `refactor(chart): replace forEach with for-of loops`. Keep scopes meaningful and summaries under 72 characters. For pull requests, include a concise problem statement, the solution outline, and testing evidence. Link tracking issues, attach relevant screenshots or GIFs for visual changes, and request reviews from maintainers familiar with the affected modules.

## Environment & Asset Tips

Favor environment-agnostic code: rely on Vite’s env variables prefixed with `VITE_`, and document new ones in the README. Store large media assets in `public/` or a CDN rather than embedding inside `src/`. When adding external data sources, sanitize inputs and provide type definitions so rendering pipelines stay predictable.
