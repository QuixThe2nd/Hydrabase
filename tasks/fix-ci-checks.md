# Task: Fix CI Check Failures

The `.d.ts` files have been restored. Fix the remaining CI failures.

## 1. ESLint: `max-lines-per-function` in server.ts

**File:** `src/backend/networking/udp/server.ts` line 133
**Error:** `Async arrow function has too many lines (54). Maximum allowed is 50`

The `messageHandler` function is 4 lines over the limit. Extract the hydra message handling logic (the `query.y === 'q'` branch starting around line 162) into a separate function. Something like `handleHydraQuery(...)`. Keep the handler clean.

## 2. TypeScript: Union narrowing on `query.a` in server.ts

**Errors at lines 171-179:** Properties `n`, `c`, `i`, `d` don't exist on the `HydraAuthQueryMessage` variant of the `a` field union.

After the `hydra_auth` early return at line 136, TS still sees both union members for `query.a`. In the `query.y === 'q'` branch (around line 162+), `query.a` is a union of the standard DHT `a` and the hydra auth `a`.

**Fix:** Add a type guard or narrow with a runtime check. Since `hydra_auth` returns early at line 136, you could also use a discriminated union on the `q` field, or just cast `query.a` in the hydra message branch since we know it's not `hydra_auth` at that point.

## 3. TypeScript: ws/server.ts line 111

**Error:** `Type '{ address: ...; hostname: ...; isOpened: false; ... }' is not assignable to type 'undefined'`

Check `src/backend/networking/ws/server.ts` around line 111. The `handleConnection` function likely returns an object in a branch where the return type expects `undefined`. Fix the return type or the logic.

## 4. Version check

The `version` check is failing — check what the CI version workflow expects and ensure package.json version is correct.

## Deliverables
- All 4 CI checks pass: lint, typecheck-backend, typecheck-frontend, version
- `tsc --project src/backend/tsconfig.json` clean
- `tsc --project src/frontend/tsconfig.json` clean
- `bun run eslint` clean
- Commit to `dev` branch, push to origin
- Delete this task file after committing
