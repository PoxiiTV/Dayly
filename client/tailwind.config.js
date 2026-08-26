/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Semantic tokens mapped to CSS vars (see src/index.css). Changing the
        // value in one place themes light & dark consistently.
        bg: "rgb(var(--bg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        elevated: "rgb(var(--elevated) / <alpha-value>)",
        border: "rgb(var(--border) / <alpha-value>)",
        text: "rgb(var(--text) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        faint: "rgb(var(--faint) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        "accent-strong": "rgb(var(--accent-strong) / <alpha-value>)",
        "accent-soft": "rgb(var(--accent-soft) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        ok: "rgb(var(--ok) / <alpha-value>)",
        warn: "rgb(var(--warn) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
      borderRadius: {
        xl2: "1.25rem",
      },
      boxShadow: {
        soft: "0 1px 2px rgba(15,23,42,0.04), 0 4px 16px -2px rgba(15,23,42,0.08)",
        pop: "0 4px 24px -4px rgba(15,23,42,0.16)",
        ring: "0 0 0 3px rgb(var(--accent-soft))",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "fade-out": { from: { opacity: "1" }, to: { opacity: "0" } },
        "slide-up": { from: { opacity: "0", transform: "translateY(16px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        "slide-down-out": { from: { opacity: "1", transform: "translateY(0)" }, to: { opacity: "0", transform: "translateY(10px)" } },
        "modal-in": { from: { opacity: "0", transform: "translateY(8px) scale(.98)" }, to: { opacity: "1", transform: "translateY(0) scale(1)" } },
        "modal-out": { from: { opacity: "1", transform: "translateY(0) scale(1)" }, to: { opacity: "0", transform: "translateY(6px) scale(.985)" } },
        "scale-in": { from: { opacity: "0", transform: "scale(.98)" }, to: { opacity: "1", transform: "scale(1)" } },
        "scale-out": { from: { opacity: "1", transform: "scale(1)" }, to: { opacity: "0", transform: "scale(.985)" } },
        "slide-in-right": { from: { transform: "translateX(100%)" }, to: { transform: "translateX(0)" } },
        "slide-out-right": { from: { transform: "translateX(0)" }, to: { transform: "translateX(100%)" } },
        "slide-in-left": { from: { transform: "translateX(-100%)" }, to: { transform: "translateX(0)" } },
        "page-in": { from: { opacity: "0.82" }, to: { opacity: "1" } },
      },
      animation: {
        "fade-in": "fade-in .2s ease-out both",
        "fade-out": "fade-out .16s ease-in both",
        "slide-up": "slide-up .28s cubic-bezier(.22,1,.36,1) both",
        "slide-down-out": "slide-down-out .2s cubic-bezier(.4,0,1,1) both",
        "modal-in": "modal-in .28s cubic-bezier(.22,1,.36,1) both",
        "modal-out": "modal-out .18s ease-in both",
        "scale-in": "scale-in .24s cubic-bezier(.22,1,.36,1) both",
        "scale-out": "scale-out .16s ease-in both",
        "slide-in-right": "slide-in-right .32s cubic-bezier(.22,1,.36,1) both",
        "slide-out-right": "slide-out-right .22s cubic-bezier(.4,0,1,1) both",
        "slide-in-left": "slide-in-left .28s cubic-bezier(.22,1,.36,1) both",
        "page-in": "page-in .16s ease-out both",
      },
    },
  },
  plugins: [],
};