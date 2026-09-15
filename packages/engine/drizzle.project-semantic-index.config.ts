import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./packages/engine/src/persistence/schemas/semantic-index.ts",
  out: "./packages/engine/src/persistence/migrations/project-semantic-index",
});
