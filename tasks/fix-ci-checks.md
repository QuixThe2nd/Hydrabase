# Fix CI Check Failures

## Issues to Fix

1. **TypeScript Backend Errors:**
   - `rpc.ts(131)`: Type string not assignable to template literal type
   - `Node.ts(66)`: string|false not assignable to string
   - `nat-auth.test.ts(109)`: unused variable `serverAccount`

2. **ESLint Errors:**
   - monitor-stats.js has multiple sorting and style issues
   - require() imports instead of ES modules
   - Unused class methods
   - Console statements
   - Object/import sorting

## Quick Fixes Needed