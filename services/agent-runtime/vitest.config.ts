import { readFile } from "node:fs/promises";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      name: "open-publisher-markdown-text",
      enforce: "pre",
      async load(id) {
        const filePath = id.split("?", 1)[0];
        if (!filePath?.endsWith(".md")) {
          return null;
        }
        const content = await readFile(filePath, "utf8");
        return `export default ${JSON.stringify(content)};`;
      },
    },
  ],
  test: {
    include: ["tests/**/*.test.ts"],
    // Bun's Vitest integration supports child-process workers reliably; the
    // default thread pool does not expose the stdio handles Vitest expects.
    pool: "forks",
  },
});
