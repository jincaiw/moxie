import { useEffect, useRef, useState } from "react";
import {
  THEME_CSS_LIMIT,
  THEME_LIBRARY_CSS_LIMIT,
  themeCSSError,
} from "./theme-css";
export { themeCSSError } from "./theme-css";
export type ThemePreset =
  "light" | "dark" | "sepia" | "solarized-light" | "solarized-dark";
export type SavedTheme = {
  name: string;
  css: string;
  gallery?: { id: string; version: string };
};
export type Preferences = {
  copyFormat: "rich-text" | "markdown";
  theme: ThemePreset;
  fontSize: number;
  font: "sans" | "serif";
  width: number;
  autoSave: boolean;
  autoCheckUpdates: boolean;
  typewriter: boolean;
  smartQuotes: boolean;
  smartDashes: boolean;
  spellCheck: boolean;
  customCSS: string;
  savedThemes: SavedTheme[];
  activeSavedTheme: string;
  pdfPageSize: "A4" | "Letter" | "Legal";
  pdfLandscape: boolean;
  pdfMargin: number;
  pdfHeaderFooter: boolean;
  htmlOutline: boolean;
  floatingToolbar: boolean;
  outlineCollapsible: boolean;
  showHiddenFiles: boolean;
  showOtherFiles: boolean;
  hiddenFilePatterns: string;
  launchFolder: "restore" | "none" | "default";
  defaultFolder: string;
};
const defaults: Preferences = {
  copyFormat: "rich-text",
  theme: "light",
  fontSize: 18,
  font: "sans",
  width: 880,
  autoSave: false,
  autoCheckUpdates: true,
  typewriter: false,
  smartQuotes: false,
  smartDashes: false,
  spellCheck: false,
  customCSS: "",
  savedThemes: [],
  activeSavedTheme: "",
  pdfPageSize: "A4",
  pdfLandscape: false,
  pdfMargin: 20,
  pdfHeaderFooter: false,
  htmlOutline: false,
  floatingToolbar: false,
  outlineCollapsible: true,
  showHiddenFiles: false,
  showOtherFiles: false,
  hiddenFilePatterns: "",
  launchFolder: "restore",
  defaultFolder: "",
};

function initial(): Preferences {
  try {
    const value = JSON.parse(
      localStorage.getItem("moxie.preferences.v2") || "{}",
    );
    const storedTheme = value.theme || localStorage.getItem("moxie.theme");
    const savedThemes: SavedTheme[] = [];
    let savedThemeCSSSize = 0;
    if (Array.isArray(value.savedThemes)) {
      for (const theme of value.savedThemes) {
        if (
          !theme ||
          typeof theme !== "object" ||
          typeof (theme as SavedTheme).name !== "string" ||
          !(theme as SavedTheme).name.trim() ||
          (theme as SavedTheme).name.length > 40 ||
          typeof (theme as SavedTheme).css !== "string" ||
          themeCSSError((theme as SavedTheme).css) ||
          savedThemes.length >= 20 ||
          savedThemeCSSSize + (theme as SavedTheme).css.length >
            THEME_LIBRARY_CSS_LIMIT
        )
          continue;
        const saved = theme as SavedTheme;
        if (
          saved.gallery &&
          (typeof saved.gallery !== "object" ||
            !/^[a-z0-9][a-z0-9-]{1,39}$/.test(saved.gallery.id) ||
            !/^\d+\.\d+\.\d+$/.test(saved.gallery.version))
        )
          delete saved.gallery;
        savedThemes.push(saved);
        savedThemeCSSSize += (theme as SavedTheme).css.length;
      }
    }
    const themes: ThemePreset[] = [
      "light",
      "dark",
      "sepia",
      "solarized-light",
      "solarized-dark",
    ];
    return {
      copyFormat: value.copyFormat === "markdown" ? "markdown" : "rich-text",
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
      autoCheckUpdates: value.autoCheckUpdates !== false,
      typewriter: value.typewriter === true,
      smartQuotes: value.smartQuotes === true,
      smartDashes: value.smartDashes === true,
      spellCheck: value.spellCheck === true,
      customCSS:
        typeof value.customCSS === "string" &&
        value.customCSS.length <= THEME_CSS_LIMIT
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
      htmlOutline: value.htmlOutline === true,
      floatingToolbar: value.floatingToolbar === true,
      outlineCollapsible:
        typeof value.outlineCollapsible === "boolean"
          ? value.outlineCollapsible
          : localStorage.getItem("moxie.outline-collapsible.v1") !== "false",
      showHiddenFiles: value.showHiddenFiles === true,
      showOtherFiles: value.showOtherFiles === true,
      hiddenFilePatterns:
        typeof value.hiddenFilePatterns === "string"
          ? value.hiddenFilePatterns.slice(0, 2048)
          : "",
      launchFolder:
        value.launchFolder === "none" || value.launchFolder === "default"
          ? value.launchFolder
          : "restore",
      defaultFolder:
        typeof value.defaultFolder === "string"
          ? value.defaultFolder.slice(0, 4096)
          : "",
    };
  } catch {
    return defaults;
  }
}
export function usePreferences(reportError?: (message: string) => void) {
  const [preferences, setPreferences] = useState(initial);
  const receivedPreferences = useRef<string | null>(null);
  const outlineServerValue = useRef<boolean | null>(null);
  const outlineChanges = useRef(0);
  const [outlineDesktopReady, setOutlineDesktopReady] = useState(
    !window.desktop?.getOutlinePreference,
  );
  useEffect(() => {
    const desktop = window.desktop;
    if (!desktop?.getOutlinePreference) return;
    let mounted = true;
    const generation = outlineChanges.current;
    const receive = (value: boolean) => {
      if (!mounted || typeof value !== "boolean") return;
      outlineChanges.current++;
      outlineServerValue.current = value;
      setPreferences((current) =>
        current.outlineCollapsible === value
          ? current
          : { ...current, outlineCollapsible: value },
      );
    };
    const dispose = desktop.onOutlinePreference?.(receive);
    void desktop
      .getOutlinePreference()
      .then((value) => {
        if (!mounted) return;
        if (generation === outlineChanges.current && typeof value === "boolean")
          receive(value);
        setOutlineDesktopReady(true);
      })
      .catch(() => {
        if (mounted) setOutlineDesktopReady(true);
      });
    return () => {
      mounted = false;
      dispose?.();
    };
  }, []);
  useEffect(() => {
    const value = preferences.outlineCollapsible;
    if (
      !outlineDesktopReady ||
      !window.desktop?.setOutlinePreference ||
      outlineServerValue.current === value
    )
      return;
    const previous = outlineServerValue.current;
    outlineServerValue.current = value;
    let mounted = true;
    void window.desktop.setOutlinePreference(value).catch((error) => {
      if (!mounted) return;
      if (outlineServerValue.current === value)
        outlineServerValue.current = previous;
      reportError?.(
        "大纲设置已保存在本窗口，但未同步到其他窗口：" +
          (error instanceof Error ? error.message : String(error)),
      );
    });
    return () => {
      mounted = false;
    };
  }, [preferences.outlineCollapsible, outlineDesktopReady, reportError]);
  useEffect(() => {
    const syncPreferences = (event: StorageEvent) => {
      if (event.key !== "moxie.preferences.v2" && event.key !== null) return;
      const received = initial();
      receivedPreferences.current = JSON.stringify(received);
      setPreferences(received);
    };
    window.addEventListener("storage", syncPreferences);
    return () => window.removeEventListener("storage", syncPreferences);
  }, []);
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
      const serialized = JSON.stringify(preferences);
      if (
        serialized !== receivedPreferences.current &&
        localStorage.getItem("moxie.preferences.v2") !== serialized
      )
        localStorage.setItem("moxie.preferences.v2", serialized);
      if (localStorage.getItem("moxie.theme") !== preferences.theme)
        localStorage.setItem("moxie.theme", preferences.theme);
      if (localStorage.getItem("moxie.font") !== String(preferences.fontSize))
        localStorage.setItem("moxie.font", String(preferences.fontSize));
    } catch {}
    receivedPreferences.current = null;
  }, [preferences]);
  const update = <K extends keyof Preferences>(
    key: K,
    value: Preferences[K],
  ) => {
    if (key === "outlineCollapsible") outlineChanges.current++;
    setPreferences((p) => ({ ...p, [key]: value }));
  };
  return { preferences, update };
}
