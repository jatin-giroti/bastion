/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        bastion: {
          bg: "#0F172A",
          surface: "#1E293B",
          line: "#334155",
          text: "#F8FAFC",
          muted: "#94A3B8",
          accent: "#4F46E5",
          ok: "#10B981",
          amber: "#F59E0B",
          danger: "#EF4444",
        },
      },
      fontFamily: {
        sans: ["Geist", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["Geist Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};
