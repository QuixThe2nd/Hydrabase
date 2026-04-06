# Hydrabase — Claude Code Instructions

## Running the Node

**Always use `bun run` instead of `bun start` or `bun dev`.**

`bun run` starts the backend with a self-terminating TTL (default 30 s) so it does not run forever and block the agent.

```bash
bun run          # starts backend, kills itself after 30 s
bun run -- 60    # 60-second TTL
bun run -- 2m    # 2-minute TTL
bun run -- 0     # no timeout (use only when explicitly needed)
```

Never use `bun start` or `bun dev` — those run indefinitely and will stall or leak background processes.

## Code Quality Workflow

**CRITICAL**: Validate incrementally while editing (not only at the end). Run targeted checks after each small batch of changes, fix issues immediately, then do one final full-project verification.

### Type Checking
```bash
bunx tsc --noEmit
```

### Linting
```bash
bun eslint --fix <changed-files>
# final verification before completion:
bun eslint --fix
```

### Incremental Validation Loop

For every small edit batch:
1. Run ESLint only on the files you changed.
2. Run `bun tsc --project src/backend/tsconfig.json --noEmit` or `bun tsc --project src/frontend/tsconfig.json --noEmit`.
3. Fix errors immediately before continuing.

### When to Run

- **After each small change batch in `src/backend/**`**: scoped ESLint + type check, fix issues
- **After each small change batch in `src/frontend/**`**: scoped ESLint + type check, fix issues
- **After each small change batch in `src/types/**`**: scoped ESLint + type check, fix issues
- **Before marking changes complete**: final full verification

## GUI Rebuild Workflow

After editing `src/frontend/**`:
```bash
bun build-webui
```
