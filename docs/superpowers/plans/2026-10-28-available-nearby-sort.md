# Available Nearby Sort Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stale HDB-biased Recommended ranking with a transparent Available nearby default sort.

**Architecture:** Keep ranking in the existing `sortCarparks` helper. Replace the `recommended` union member with `nearby`, rank availability levels before walking time, and remove the unused recommendation field and card UI.

**Tech Stack:** TypeScript, React, Node's built-in test runner via `tsx`, Vite.

**Spec:** `docs/superpowers/specs/2026-10-28-available-nearby-sort-design.md`

## Global Constraints

- Treat HDB, LTA, and supplemental carparks equally in the default ranking.
- `Available nearby` ranks `high`, `moderate`, `low`, `unknown`, then `full`; walking time breaks ties.
- Keep `Most Available` as the raw `availableLots` sort.
- Do not add dependencies or change backend API payloads.

## Review Focus

- A high-availability carpark farther away must still rank before a low-availability closer carpark; test in Task 1.
- Unknown live availability must not outrank known availability; test in Task 1.
- Full carparks must remain last; test in Task 1.
- Sorting must not mutate the source array; test in Task 1.
- The default UI state and filter label must use `Available nearby`; verify with the typecheck/build in Task 2.

### Task 1: Add the ranking regression test

**Files:**
- Create: `frontend/src/app/data/carparks.test.ts`
- Modify: `frontend/package.json`

**Interfaces:**
- Consumes: `sortCarparks(carparks, 'nearby')` from `frontend/src/app/data/carparks.ts`.
- Produces: A test-covered ordering contract for the new sort and inclusion in `npm test`.

- [x] **Step 1: Write the failing test**

  Add a small `Carpark` fixture and assert that `nearbyHigh` sorts before `farHigh` only when they tie on availability, that known availability precedes unknown, full is last, and the input array is unchanged.

- [x] **Step 2: Run the focused test to verify it fails**

  Run `node --import tsx --test src/app/data/carparks.test.ts --test-name-pattern="Available nearby"` from `frontend`.

  Expected: FAIL because `nearby` is not currently an accepted sort value.

- [x] **Step 3: Add the new test file to the existing `npm test` script**

  Keep the current Node/tsx test runner and append `src/app/data/carparks.test.ts`; do not add a new test framework or dependency.

- [x] **Step 4: Run the focused test again**

  Run `npm test -- --test-name-pattern="Available nearby"` from `frontend`.

  Expected: FAIL with the same missing-sort behavior until production code changes in Task 2.

### Task 2: Implement the source-neutral sort and remove stale recommendation UI

**Files:**
- Modify: `frontend/src/app/data/carparks.ts`
- Modify: `frontend/src/api/carparkService.ts`
- Modify: `frontend/src/app/components/filter-chips.tsx`
- Modify: `frontend/src/app/components/carpark-card.tsx`
- Modify: `frontend/src/app/pages/results-page.tsx`
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 1's `nearby` sort contract.
- Produces: No `isRecommended` field or `recommended` sort union; the UI defaults to and labels the `nearby` sort as `Available nearby`.

- [x] **Step 1: Implement `nearby` in `sortCarparks`**

  Replace the old `recommended` branch with availability rank `high`, `moderate`, `low`, `unknown`, `full`, using walking minutes as the tie-breaker. Keep `available` unchanged.

- [x] **Step 2: Remove `isRecommended` and update callers**

  Delete the field from the `Carpark` type and transform, remove its badge/reason block and unused imports, change `recommended` to `nearby` in filter props and result-page state, and set the initial sort to `nearby`.

- [x] **Step 3: Update the README sort description**

  Describe `Available nearby` and `Most Available` as separate behaviors without mentioning recommendation or ML.

- [x] **Step 4: Run the focused regression test**

  Run `npm test -- --test-name-pattern="Available nearby"` from `frontend`.

  Expected: PASS.

- [x] **Step 5: Run frontend verification**

  Run `npm test`, `npm run typecheck`, and `npm run build` from `frontend`.

  Expected: all commands exit 0 with no test failures or type/build errors.

