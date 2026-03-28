# Hydrabase Workspace Instructions

## Code Quality Workflow

**CRITICAL**: After any major code changes (file edits, refactoring, new features), ALWAYS validate the changes by running type checks and linting:

### Type Checking
Run TypeScript type checking to catch type errors:
```bash
bunx tsc --noEmit
```

### Linting
Run ESLint to check for style and logical issues:
```bash
bunx eslint .
```

### When to Run

- **After editing `src/backend/**` files**: Always run both type check and eslint
- **After editing `src/frontend/**` files**: Always run both type check and eslint
- **After editing `src/types/**` or shared utilities**: Always run both checks
- **Before marking changes complete**: Verify no errors exist

### Purpose

This project uses strict TypeScript (`strict: true`) and comprehensive ESLint rules. Skipping validation often leads to:
- Type errors that fail in production
- ESLint violations that block commits/PRs
- Sentry/telemetry import issues in shared utilities (browser bundling conflicts)

## GUI Rebuild Workflow

**After editing `src/frontend/**` files**: Run a single build to verify the GUI rebuilds correctly:
```bash
bun start
```

Run this once after frontend changes complete and validation passes. This ensures the built GUI is fresh for testing.

### Integration

When you complete major changes:
1. Run type check and eslint as documented above
2. Fix any errors that appear
3. If frontend files were changed, run `bun start` once
4. Report the results (pass/fail)
5. Only mark the task complete after validation passes

This prevents the repeated cycle of changes → type check failures → rework.
