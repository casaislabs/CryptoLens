import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const base = [...compat.extends("next/core-web-vitals")];

// Rule to prevent importing `@/lib/supabase` in client code (components/pages)
const restrictClientSupabaseImport = {
  files: [
    "components/**/*.{js,jsx,ts,tsx}",
    "pages/**/*.{js,jsx,ts,tsx}",
  ],
  ignores: [
    "pages/api/**/*", // allow in API routes
  ],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: [
          {
            name: "@/lib/supabase",
            message:
              "Do not import '@/lib/supabase' on the client. Use API endpoints.",
          },
        ],
        // Optionally also block subpaths explicitly
        // patterns: ["@/lib/supabase/*"],
      },
    ],
  },
};

const eslintConfig = [
  ...base,
  restrictClientSupabaseImport,
];

export default eslintConfig;
