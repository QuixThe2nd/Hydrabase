import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dbCredentials: { url: 'data/db.sqlite' },
  dialect: 'sqlite',
  schema: './src/db/schema.ts'
})
