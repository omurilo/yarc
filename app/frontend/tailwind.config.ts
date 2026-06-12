import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#17191f",
        panel: "#20242c",
        rail: "#14171d",
        line: "#343945",
        accent: "#43d9ad",
        warn: "#f4b860",
        danger: "#ff6b6b",
      },
      boxShadow: {
        focus: "0 0 0 1px rgba(67, 217, 173, 0.72)",
      },
    },
  },
  plugins: [],
} satisfies Config;

