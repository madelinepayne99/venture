import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Bright, premium "headquarters" palette — warm parchment + brass +
        // deep teal. Deliberately not a generic blue/gray SaaS dashboard,
        // and nothing medieval, martial, or trading-floor themed.
        hq: {
          cream: "#FBF6EC",
          parchment: "#F3E9D2",
          brass: "#C89B3C",
          brassDark: "#9C7A2E",
          teal: "#0E5C57",
          tealDark: "#0A3F3C",
          ink: "#20262B",
          slate: "#5B6670",
        },
        status: {
          draft: "#8A8F98",
          pending: "#C89B3C",
          active: "#0E5C57",
          success: "#1E7A4C",
          danger: "#B3462C",
        },
      },
      fontFamily: {
        display: ["Georgia", "Cambria", "serif"],
        body: [
          "-apple-system",
          "Segoe UI",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      boxShadow: {
        desk: "0 1px 2px rgba(32,38,43,0.06), 0 8px 24px rgba(32,38,43,0.08)",
      },
    },
  },
  plugins: [],
} satisfies Config;
