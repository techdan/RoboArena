import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["node_modules/**", "dist/**", "build/**", "coverage/**", "docs/extracted/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["src/engine/**/*.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: "Use the seeded engine Rng." },
        { object: "Date", property: "now", message: "Engine code has no wall-clock time." },
        {
          object: "performance",
          property: "now",
          message: "Engine code has no wall-clock time.",
        },
      ],
      "no-restricted-globals": [
        "error",
        { name: "setTimeout", message: "Schedule work with engine ticks." },
        { name: "setInterval", message: "Schedule work with engine ticks." },
      ],
    },
  },
);
