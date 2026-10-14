import type { Config } from "tailwindcss";

const v = (name: string) => `var(--${name})`;

const config: Config = {
  darkMode: "media",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: v("page"),
        surface: v("surface"),
        foreground: v("text-primary"),
        secondary: v("text-secondary"),
        muted: v("text-muted"),
        border: v("border"),
        grid: v("grid"),
        accent: v("accent"),
        "accent-soft": v("accent-soft"),
        good: v("good"),
        warning: v("warning"),
        critical: v("critical"),
      },
      fontFamily: { sans: ["system-ui", "-apple-system", "Segoe UI", "sans-serif"], mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"] },
      borderRadius: { lg: "10px", md: "8px", sm: "6px" },
    },
  },
  plugins: [],
};

export default config;
