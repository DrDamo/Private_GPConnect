import { defineProject } from 'vitest/config'

export default defineProject({
  // First test in each file pays for booting PGlite and running migrations.
  test: { name: 'store-postgres', testTimeout: 30_000, hookTimeout: 30_000 },
})
