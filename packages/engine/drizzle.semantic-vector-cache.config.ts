import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./packages/engine/src/persistence/schemas/semantic-vector-cache.ts",
  out: "./packages/engine/src/persistence/migrations/semantic-vector-cache",
});
