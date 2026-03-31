# Hydrabase Workspace Instructions

## Code Quality Workflow

**CRITICAL**: Validate incrementally while editing (not only at the end). Run targeted checks after each small batch of changes, fix issues immediately, then do one final full-project verification.

### Type Checking
Run TypeScript type checking to catch type errors:
```bash
bunx tsc --noEmit
```

### Linting
Run ESLint incrementally on changed files first, then run a full lint once before completion:
```bash
bun eslint --fix <changed-files>
# final verification before completion:
bun eslint --fix
```

### Incremental Validation Loop

For every small edit batch, follow this loop:
1. Run ESLint only on the files you changed.
2. Run `bun tsc --project src/backend/tsconfig.json --noEmit` or `bun tsc --project src/frontend/tsconfig.json --noEmit` to catch cross-file type regressions early.
3. Fix errors immediately before continuing with more edits.

Do not defer lint/type errors until the end of a long multi-file task.

### When to Run

- **After each small change batch in `src/backend/**`**: Run scoped ESLint + type check, then fix issues
- **After each small change batch in `src/frontend/**`**: Run scoped ESLint + type check, then fix issues
- **After each small change batch in `src/types/**` or shared utilities**: Run scoped ESLint + type check, then fix issues
- **Before marking changes complete**: Run final full verification of with eslint and tsc

### Purpose

This project uses strict TypeScript (`strict: true`) and comprehensive ESLint rules. Skipping validation often leads to:
- Type errors that fail in production
- ESLint violations that block commits/PRs
- Sentry/telemetry import issues in shared utilities (browser bundling conflicts)

## GUI Rebuild Workflow

**After editing `src/frontend/**` files**: Run a single build to verify the GUI rebuilds correctly:
```bash
bun build-webui
```

Run this once after frontend changes complete and validation passes. This ensures the built GUI artifacts are fresh for testing.

### Integration

During implementation:
1. Work in small batches
2. Run scoped ESLint on changed files
3. Run `bun tsc --noEmit`
4. Fix issues immediately before continuing

Before completion:
1. Run final full verification (`bun tsc --noEmit` and `bun eslint .`)
2. Report the results (pass/fail)
3. Only mark the task complete after validation passes

This prevents the repeated cycle of changes → type check failures → rework.
