"use client";

import { useEffect, useState } from "react";
import { Icon } from "./Icon";

const THEME_KEY = "vouch:theme";

/// Standalone theme toggle for pages outside the app shell (e.g. the landing page).
export function ThemeToggle() {
  const [theme, setTheme] = useState("light");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      const initial =
        saved === "dark" || document.documentElement.dataset.theme === "dark" ? "dark" : "light";
      setTheme(initial);
      document.documentElement.dataset.theme = initial;
    } catch {
      /* private mode: stay light */
    }
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      document.documentElement.dataset.theme = next;
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* non-fatal */
    }
  };

  return (
    <button
      className="ghost sm"
      style={{ padding: "7px 10px" }}
      onClick={toggle}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      <Icon name={theme === "dark" ? "sun" : "moon"} size={15} />
    </button>
  );
}
