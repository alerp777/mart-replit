import { defineConfig } from "drizzle-kit";
import path from "path";
import { databaseUrl } from "./src/connection-url";

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  out: path.join(__dirname, "./drizzle"),
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
