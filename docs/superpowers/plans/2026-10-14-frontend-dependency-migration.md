# Frontend Dependency Migration Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Upgrade the frontend dependencies from the current `main` versions to the coordinated React, Vite, MUI, Radix, charting, calendar, and utility versions proposed by Dependabot PRs #31, #32, and #33.

**Architecture:** Migrate dependency cohorts independently. Each cohort must pass install, typecheck, tests, build, and container validation before the next cohort begins.

**Tech Stack:** React 19.3, TypeScript, Vite 8/Rolldown, MUI 9, Tailwind 4, Radix UI, Recharts 3, React Day Picker 10, Docker.

**Spec:** Dependabot PRs #31, #32, and #33, plus the migration decisions recorded in the user conversation.

## Global Constraints

- Keep React and React DOM on the same version.
- Keep both React type packages on the same React major.
- Regenerate `frontend/package-lock.json`; never use `--legacy-peer-deps`.
- Preserve `/parkcastsit` base-path behavior and existing user-facing behavior.
- Keep Node 22 for CI and Docker.

## Review Focus

- React 19 type changes involving refs, `useRef`, `useReducer`, and `ReactElement`.
- React Day Picker 10 component API changes in `calendar.tsx`.
- Recharts 3 type/API changes in `chart.tsx`.
- React Resizable Panels 4 API changes in `resizable.tsx`.
- MUI 9 slot, theme, styling, and accessibility compatibility.

### Task 1: Establish migration guardrails

**Files:** `frontend/package.json`, `.github/workflows/ci.yml`

- [ ] Add a `typecheck` script using `tsc --noEmit`.
- [ ] Run the current baseline: `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, and `docker build -t parkcastsg:baseline .`.
- [ ] Record pre-existing failures separately.
- [ ] Commit the validation-script changes.

### Task 2: Align React and React type packages

**Files:** `frontend/package.json`, `frontend/package-lock.json`, React-dependent source files as needed.

- [ ] Upgrade `react`, `react-dom`, `@types/react`, and `@types/react-dom` together to 19.3.0.
- [ ] Regenerate the lockfile.
- [ ] Fix React 19 type incompatibilities only.
- [ ] Run `npm ci`, typecheck, tests, build, and Docker validation.
- [ ] Commit the React migration.

### Task 3: Upgrade Vite and build tooling

**Files:** `frontend/package.json`, `frontend/package-lock.json`, `frontend/vite.config.ts` as needed.

- [ ] Upgrade Vite, the React plugin, Tailwind/Vite, Tailwind CSS, Node types, and tsx to the versions from PR #33.
- [ ] Verify base paths, plugins, and asset handling.
- [ ] Compare build time and generated output with the baseline.
- [ ] Run all validation gates and commit.

### Task 4: Upgrade MUI and Radix UI

**Files:** `frontend/package.json`, `frontend/package-lock.json`, affected UI source files.

- [ ] Upgrade MUI to 9.5.0 and apply the Radix updates from PR #33.
- [ ] Check slot props, theme defaults, refs, event handlers, and accessibility behavior.
- [ ] Run all validation gates and commit.

### Task 5: Migrate calendar, chart, layout, and animation components

**Files:** `frontend/src/app/components/ui/calendar.tsx`, `chart.tsx`, `resizable.tsx`, and affected consumers.

- [ ] Upgrade date-fns, React Day Picker, Recharts, React Resizable Panels, Motion, and Lucide.
- [ ] Adapt changed APIs and types.
- [ ] Run automated validation plus browser smoke checks for calendar, charts, resize behavior, and animations.
- [ ] Commit the cohort.

### Task 6: Apply remaining utility updates

**Files:** `frontend/package.json`, `frontend/package-lock.json`, affected source files.

- [ ] Apply the remaining updates from PR #33, including react-hook-form, masonry, input-otp, sonner, tailwind-merge, tw-animate-css, and Leaflet types.
- [ ] Regenerate the lockfile.
- [ ] Run all validation gates and commit.

### Task 7: Full regression and staging validation

- [ ] Run frontend CI, backend tests, compile checks, audit, and the production container build.
- [ ] Verify `/`, `/parkcastsit/`, map, results, filters, carpark details, calendar, charts, and responsive layout.
- [ ] Push only after all checks pass; deploy to staging and compare with baseline.
