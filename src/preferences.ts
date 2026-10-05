import { useEffect, useState } from "react";
import { themeCSSError } from "./theme-css";
export { themeCSSError } from "./theme-css";
export type ThemePreset =
  "light" | "dark" | "sepia" | "solarized-light" | "solarized-dark";
export type SavedTheme = { name: string; css: string };
export type Preferences = {
  theme: ThemePreset;
  fontSize: number;
  font: "sans" | "serif";
  width: number;
  autoSave: boolean;
  typewriter: boolean;
  spellCheck: boolean;
  customCSS: string;
  savedThemes: SavedTheme[];
  activeSavedTheme: string;
  pdfPageSize: "A4" | "Letter" | "Legal";
  pdfLandscape: boolean;
  pdfMargin: number;
  pdfHeaderFooter: boolean;
};
const defaults: Preferences = {
  theme: "light",
  fontSize: 18,
  font: "sans",
  width: 880,
  autoSave: false,
  typewriter: false,
  spellCheck: false,
  customCSS: "",
  savedThemes: [],
  activeSavedTheme: "",
  pdfPageSize: "A4",
  pdfLandscape: false,
  pdfMargin: 20,
  pdfHeaderFooter: false,
};

function initial(): Preferences {
  try {
    const value = JSON.parse(
      localStorage.getItem("moxie.preferences.v2") || "{}",
    );
    const storedTheme = value.theme || localStorage.getItem("moxie.theme");
    const savedThemes: SavedTheme[] = Array.isArray(value.savedThemes)
      ? value.savedThemes
          .filter(
            (theme: unknown): theme is SavedTheme =>
              !!theme &&
              typeof theme === "object" &&
              typeof (theme as SavedTheme).name === "string" &&
              (theme as SavedTheme).name.trim().length > 0 &&
              (theme as SavedTheme).name.length <= 40 &&
              typeof (theme as SavedTheme).css === "string" &&
              !themeCSSError((theme as SavedTheme).css),
          )
          .slice(0, 20)
      : [];
    const themes: ThemePreset[] = [
      "light",
      "dark",
      "sepia",
      "solarized-light",
      "solarized-dark",
    ];
    return {
      theme: themes.includes(storedTheme) ? storedTheme : "light",
      fontSize: Math.min(
        24,
        Math.max(
          14,
          Number(value.fontSize || localStorage.getItem("moxie.font")) || 18,
        ),
      ),
      font: value.font === "serif" ? "serif" : "sans",
      width: Math.min(1040, Math.max(620, Number(value.width) || 880)),
      autoSave: value.autoSave === true,
      typewriter: value.typewriter === true,
      spellCheck: value.spellCheck === true,
      customCSS:
        typeof value.customCSS === "string" && value.customCSS.length <= 65536
          ? value.customCSS
          : "",
      savedThemes,
      activeSavedTheme:
        typeof value.activeSavedTheme === "string" &&
        savedThemes.some((theme) => theme.name === value.activeSavedTheme)
          ? value.activeSavedTheme
          : "",
      pdfPageSize: ["A4", "Letter", "Legal"].includes(value.pdfPageSize)
        ? value.pdfPageSize
        : defaults.pdfPageSize,
      pdfLandscape: value.pdfLandscape === true,
      pdfMargin: Math.min(40, Math.max(5, Number(value.pdfMargin) || 20)),
      pdfHeaderFooter: value.pdfHeaderFooter === true,
    };
  } catch {
    return defaults;
  }
}
export function usePreferences() {
  const [preferences, setPreferences] = useState(initial);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = preferences.theme;
    root.style.setProperty("--editor-font", preferences.fontSize + "px");
    root.style.setProperty("--editor-width", preferences.width + "px");
    root.style.setProperty(
      "--body-font",
      preferences.font === "serif"
        ? '"Songti SC", "Noto Serif CJK SC", Georgia, serif'
        : '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
    );
    const themeStyleId = "moxie-custom-theme";
    let customStyle = document.getElementById(
      themeStyleId,
    ) as HTMLStyleElement | null;
    if (!customStyle) {
      customStyle = document.createElement("style");
      customStyle.id = themeStyleId;
      document.head.append(customStyle);
    }
    customStyle.textContent = themeCSSError(preferences.customCSS)
      ? ""
      : preferences.customCSS;
    try {
      localStorage.setItem("moxie.preferences.v2", JSON.stringify(preferences));
      localStorage.setItem("moxie.theme", preferences.theme);
      localStorage.setItem("moxie.font", String(preferences.fontSize));
    } catch {}
  }, [preferences]);
  const update = <K extends keyof Preferences>(key: K, value: Preferences[K]) =>
    setPreferences((p) => ({ ...p, [key]: value }));
  return { preferences, update };
}
