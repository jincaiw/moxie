import { X, RefreshCw, Check } from "lucide-react";
import { useRef, useState } from "react";
import { Dialog } from "./Dialog";
import { themeCSSError, type Preferences } from "./preferences";
import { THEME_LIBRARY_CSS_LIMIT } from "./theme-css";
import { download } from "./bridge";
import type { UpdateStatus } from "./bridge";
import { importThemePackage } from "./theme-package";
import {
  downloadVerifiedTheme,
  loadThemeCatalog,
  type GalleryTheme,
  type ThemeCatalog,
} from "./theme-gallery";

function themeRequestError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  if (
    /failed to fetch|fetch failed|network|timed out|connection|terminated|连接失败/i.test(
      message,
    )
  )
    return "暂时无法连接官方主题图库，请检查网络后重试。";
  return message || fallback;
}

function isNewerVersion(candidate: string, installed: string) {
  const next = candidate.split(".").map(Number);
  const current = installed.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    if (next[index] !== current[index]) return next[index] > current[index];
  }
  return false;
}

function ThemePreview({ theme, alt }: { theme: GalleryTheme; alt: string }) {
  const [unavailable, setUnavailable] = useState(false);
  return (
    <div
      className={`theme-gallery-preview theme-gallery-preview--${theme.appearance}`}
      aria-label={alt || `${theme.name}主题预览`}
    >
      <div className="theme-gallery-preview-fallback" aria-hidden="true">
        <span />
        <i />
        <i />
        <b />
        <i />
      </div>
      {!unavailable && (
        <img
          src={theme.previewUrl}
          alt={alt}
          loading="lazy"
          onError={() => setUnavailable(true)}
        />
      )}
    </div>
  );
}
export function Settings({
  preferences,
  update,
  updateStatus,
  onCheckForUpdates,
  onDownloadUpdate,
  onInstallUpdate,
  onClose,
}: {
  preferences: Preferences;
  update: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
  updateStatus: UpdateStatus;
  onCheckForUpdates: () => void;
  onDownloadUpdate: () => void;
  onInstallUpdate: () => void;
  onClose: () => void;
}) {
  const themeFile = useRef<HTMLInputElement>(null);
  const themePackage = useRef<HTMLInputElement>(null);
  const [themeName, setThemeName] = useState("");
  const [themeMessage, setThemeMessage] = useState("");
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [galleryError, setGalleryError] = useState("");
  const [gallery, setGallery] = useState<ThemeCatalog | null>(null);
  const [galleryQuery, setGalleryQuery] = useState("");
  const [galleryAppearance, setGalleryAppearance] = useState("all");
  const [selectedGalleryTheme, setSelectedGalleryTheme] =
    useState<GalleryTheme | null>(null);
  const [installingGalleryThemeId, setInstallingGalleryThemeId] = useState<
    string | null
  >(null);
  const cssError = themeCSSError(preferences.customCSS);
  const activeTheme = preferences.savedThemes.find(
    (theme) => theme.name === preferences.activeSavedTheme,
  );
  const normalizedName = themeName.trim();
  const duplicateName = preferences.savedThemes.some(
    (theme) => theme.name.toLowerCase() === normalizedName.toLowerCase(),
  );
  const savedThemeCSSSize = preferences.savedThemes.reduce(
    (total, theme) => total + theme.css.length,
    0,
  );
  const nextThemeLibrarySize =
    savedThemeCSSSize -
    (activeTheme?.css.length || 0) +
    preferences.customCSS.length;
  const themeLibraryError =
    nextThemeLibrarySize > THEME_LIBRARY_CSS_LIMIT
      ? "本地主题库总大小不能超过 1.5 MB；请删除其他主题或精简 CSS。"
      : "";
  const galleryThemes = (gallery?.themes || []).filter((theme) => {
    const query = galleryQuery.trim().toLocaleLowerCase();
    const matchesQuery =
      !query ||
      `${theme.name} ${theme.description} ${theme.author}`
        .toLocaleLowerCase()
        .includes(query);
    const matchesAppearance =
      galleryAppearance === "all" || theme.appearance === galleryAppearance;
    return matchesQuery && matchesAppearance;
  });
  const installedGalleryTheme = selectedGalleryTheme
    ? preferences.savedThemes.find(
        (saved) => saved.gallery?.id === selectedGalleryTheme.id,
      )
    : undefined;
  const galleryUpdateAvailable = Boolean(
    installedGalleryTheme &&
    selectedGalleryTheme &&
    isNewerVersion(
      selectedGalleryTheme.version,
      installedGalleryTheme.gallery!.version,
    ),
  );
  const loadGallery = async () => {
    setGalleryLoading(true);
    setGalleryError("");
    try {
      const next = await loadThemeCatalog(__APP_VERSION__);
      setGallery(next);
      setSelectedGalleryTheme(null);
    } catch (error) {
      setGalleryError(themeRequestError(error, "无法读取主题目录。"));
    } finally {
      setGalleryLoading(false);
    }
  };
  const installGalleryTheme = async (theme: GalleryTheme) => {
    if (installingGalleryThemeId) return;
    const previous = preferences.savedThemes.find(
      (saved) => saved.gallery?.id === theme.id,
    );
    if (
      !previous &&
      preferences.savedThemes.some(
        (saved) =>
          saved.name.toLocaleLowerCase() === theme.name.toLocaleLowerCase(),
      )
    ) {
      setThemeMessage(
        `本地已有同名主题“${theme.name}”，请先改名或删除后再安装。`,
      );
      return;
    }
    if (!previous && preferences.savedThemes.length >= 20) {
      setThemeMessage("本地主题库已满；删除一个主题后才能安装。");
      return;
    }
    setInstallingGalleryThemeId(theme.id);
    try {
      const css = await downloadVerifiedTheme(theme);
      const total =
        preferences.savedThemes.reduce(
          (sum, saved) => sum + saved.css.length,
          0,
        ) -
        (previous?.css.length || 0) +
        css.length;
      if (total > THEME_LIBRARY_CSS_LIMIT)
        throw new Error("本地主题库总大小不能超过 1.5 MB；请先删除其他主题。");
      const saved = {
        name: previous?.name || theme.name,
        css,
        gallery: { id: theme.id, version: theme.version },
      };
      update(
        "savedThemes",
        previous
          ? preferences.savedThemes.map((item) =>
              item === previous ? saved : item,
            )
          : [...preferences.savedThemes, saved],
      );
      update("activeSavedTheme", saved.name);
      update("customCSS", css);
      setThemeMessage(
        previous
          ? `已更新并应用“${saved.name}”至版本 ${theme.version}。`
          : `已安装并应用“${theme.name}”。`,
      );
    } catch (error) {
      setGalleryError(themeRequestError(error, "主题下载或校验失败。"));
    } finally {
      setInstallingGalleryThemeId(null);
    }
  };
  const saveTheme = () => {
    if (cssError || themeLibraryError) return;
    if (activeTheme) {
      update(
        "savedThemes",
        preferences.savedThemes.map((theme) =>
          theme.name === activeTheme.name
            ? { ...theme, css: preferences.customCSS }
            : theme,
        ),
      );
      setThemeMessage(`已更新“${activeTheme.name}”。`);
      return;
    }
    if (!normalizedName || duplicateName) return;
    update("savedThemes", [
      ...preferences.savedThemes,
      { name: normalizedName, css: preferences.customCSS },
    ]);
    update("activeSavedTheme", normalizedName);
    setThemeName("");
    setThemeMessage(`已保存“${normalizedName}”。`);
  };
  const deleteActiveTheme = () => {
    if (!activeTheme) return;
    update(
      "savedThemes",
      preferences.savedThemes.filter(
        (theme) => theme.name !== activeTheme.name,
      ),
    );
    update("activeSavedTheme", "");
    update("customCSS", "");
    setThemeMessage(`已删除“${activeTheme.name}”。`);
  };
  return (
    <Dialog title="偏好设置" onClose={onClose}>
      <header>
        <h2>偏好设置</h2>
        <button className="tool" aria-label="关闭设置" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <h3 className="settings-section-title">编辑外观</h3>
      <label className="toggle-setting">
        <input
          type="checkbox"
          aria-label="选中文本时显示浮动格式工具栏"
          checked={preferences.floatingToolbar}
          onChange={(event) => update("floatingToolbar", event.target.checked)}
        />
        选中文本时显示浮动格式工具栏
      </label>
      <h3 className="settings-section-title">侧栏</h3>
      <label className="toggle-setting">
        <input
          type="checkbox"
          aria-label="使用可折叠大纲"
          checked={preferences.outlineCollapsible}
          onChange={(event) =>
            update("outlineCollapsible", event.target.checked)
          }
        />
        使用可折叠大纲
      </label>
      <label>
        启动时打开文件夹
        <select
          aria-label="启动时打开文件夹"
          value={preferences.launchFolder}
          onChange={(event) =>
            update(
              "launchFolder",
              event.target.value as Preferences["launchFolder"],
            )
          }
        >
          <option value="restore">恢复上次文件夹</option>
          <option value="none">不打开文件夹</option>
          <option value="default">打开指定文件夹</option>
        </select>
        <small>下次启动生效，未保存文档仍会恢复。</small>
      </label>
      {preferences.launchFolder === "default" && (
        <label>
          启动文件夹<small>{preferences.defaultFolder || "尚未选择"}</small>
          <button
            aria-label="选择启动文件夹"
            disabled={!window.desktop}
            onClick={async () => {
              try {
                const folder = await window.desktop?.folder({
                  showHiddenFiles: preferences.showHiddenFiles,
                  showOtherFiles: preferences.showOtherFiles,
                  hiddenFilePatterns: preferences.hiddenFilePatterns,
                });
                if (folder) {
                  await window.desktop?.setStartupFolder?.(folder.path);
                  update("defaultFolder", folder.path);
                }
              } catch {
                setThemeMessage("启动文件夹无法读取，请重新选择。");
              }
            }}
          >
            选择启动文件夹
          </button>
        </label>
      )}
      <label className="toggle-setting">
        <input
          type="checkbox"
          aria-label="显示隐藏文件"
          checked={preferences.showHiddenFiles}
          onChange={(event) => update("showHiddenFiles", event.target.checked)}
        />
        显示隐藏文件和文件夹
      </label>
      <label className="toggle-setting">
        <input
          type="checkbox"
          aria-label="显示非 Markdown 文件"
          checked={preferences.showOtherFiles}
          onChange={(event) => update("showOtherFiles", event.target.checked)}
        />
        显示非 Markdown 文件
      </label>
      <label>
        隐藏文件规则
        <textarea
          aria-label="隐藏文件规则"
          aria-describedby="folder-pattern-help"
          value={preferences.hiddenFilePatterns}
          maxLength={2048}
          rows={3}
          placeholder={"*.bak\ndrafts/**"}
          onChange={(event) => update("hiddenFilePatterns", event.target.value)}
        />
        <small id="folder-pattern-help">
          每行一条，最多 40 条。* 匹配名称，** 匹配多层目录，?
          匹配单个字符；例如 *.bak、drafts/**。只控制侧栏显示，不删除文件。
        </small>
      </label>
      <h3 className="settings-section-title">复制</h3>
      <label>
        默认复制格式
        <select
          aria-label="默认复制格式"
          value={preferences.copyFormat}
          onChange={(event) =>
            update(
              "copyFormat",
              event.target.value as Preferences["copyFormat"],
            )
          }
        >
          <option value="rich-text">富文本优先（纯文本仍保留 Markdown）</option>
          <option value="markdown">仅 Markdown 源码</option>
        </select>
      </label>
      <label>
        正文字号 <span>{preferences.fontSize}px</span>
        <input
          aria-label="正文字号"
          type="range"
          min="14"
          max="24"
          value={preferences.fontSize}
          onChange={(e) => update("fontSize", Number(e.target.value))}
        />
      </label>
      <label>
        正文字体
        <select
          aria-label="正文字体"
          value={preferences.font}
          onChange={(e) =>
            update("font", e.target.value as Preferences["font"])
          }
        >
          <option value="sans">系统无衬线</option>
          <option value="serif">宋体 / 衬线</option>
        </select>
      </label>
      <label>
        正文宽度 <span>{preferences.width}px</span>
        <input
          aria-label="正文宽度"
          type="range"
          min="620"
          max="1040"
          step="20"
          value={preferences.width}
          onChange={(e) => update("width", Number(e.target.value))}
        />
      </label>
      <label>
        外观
        <select
          aria-label="外观"
          value={preferences.theme}
          onChange={(e) =>
            update("theme", e.target.value as Preferences["theme"])
          }
        >
          <option value="light">浅色</option>
          <option value="dark">深色</option>
          <option value="sepia">纸感</option>
          <option value="solarized-light">Solarized 浅色</option>
          <option value="solarized-dark">Solarized 深色</option>
        </select>
      </label>
      <section className="theme-css-editor" aria-label="自定义主题 CSS">
        <label htmlFor="theme-css">自定义主题 CSS</label>
        <label htmlFor="saved-theme">本地主题</label>
        <select
          id="saved-theme"
          aria-label="本地主题"
          value={preferences.activeSavedTheme}
          onChange={(event) => {
            const name = event.target.value;
            const selected = preferences.savedThemes.find(
              (theme) => theme.name === name,
            );
            update("activeSavedTheme", name);
            update("customCSS", selected?.css || "");
            setThemeMessage(selected ? `已应用“${name}”。` : "");
          }}
        >
          <option value="">自定义 CSS（未保存）</option>
          {preferences.savedThemes.map((theme) => (
            <option key={theme.name} value={theme.name}>
              {theme.name}
            </option>
          ))}
        </select>
        <textarea
          id="theme-css"
          aria-label="自定义主题 CSS 内容"
          value={preferences.customCSS}
          spellCheck={false}
          placeholder={
            ":root {\n  --bg: #fbf5e9;\n  --text: #40382d;\n  --accent: #936538;\n}"
          }
          onChange={(event) => update("customCSS", event.target.value)}
        />
        {cssError && (
          <small className="theme-css-error" role="alert">
            {cssError}
          </small>
        )}
        <div className="theme-css-actions">
          <button type="button" onClick={() => themePackage.current?.click()}>
            导入主题包文件夹
          </button>
          <button type="button" onClick={() => themeFile.current?.click()}>
            导入 .css 文件
          </button>
          <button
            type="button"
            disabled={!preferences.customCSS.trim() || !!cssError}
            onClick={() => {
              const baseName = (activeTheme?.name || "moxie-theme")
                .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
                .trim();
              download(
                preferences.customCSS,
                `${baseName || "moxie-theme"}.css`,
                "text/css",
              );
            }}
          >
            导出当前 CSS
          </button>
          <button
            type="button"
            onClick={() => {
              update("activeSavedTheme", "");
              update("customCSS", "");
              setThemeMessage("");
            }}
          >
            清除自定义样式
          </button>
          <input
            ref={themeFile}
            aria-label="选择主题 CSS 文件"
            type="file"
            accept=".css,text/css"
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              update("activeSavedTheme", "");
              update("customCSS", await file.text());
            }}
          />
          <input
            ref={(element) => {
              themePackage.current = element;
              element?.setAttribute("webkitdirectory", "");
              element?.setAttribute("directory", "");
            }}
            aria-label="选择主题包文件夹"
            type="file"
            multiple
            hidden
            onChange={async (event) => {
              const files = Array.from(event.target.files || []);
              event.target.value = "";
              if (!files.length) return;
              try {
                const css = await importThemePackage(files);
                update("activeSavedTheme", "");
                update("customCSS", css);
                setThemeMessage("主题包已导入，请保存为本地主题以便下次使用。");
              } catch (error) {
                setThemeMessage(
                  `主题包导入失败：${error instanceof Error ? error.message : "无法读取主题文件。"}`,
                );
              }
            }}
          />
        </div>
        <div className="theme-library-actions">
          {!activeTheme && (
            <input
              aria-label="新主题名称"
              maxLength={40}
              placeholder="新主题名称"
              value={themeName}
              onChange={(event) => setThemeName(event.target.value)}
            />
          )}
          <button
            type="button"
            disabled={
              !!cssError ||
              !!themeLibraryError ||
              !preferences.customCSS.trim() ||
              (activeTheme
                ? false
                : !normalizedName ||
                  duplicateName ||
                  preferences.savedThemes.length >= 20)
            }
            onClick={saveTheme}
          >
            {activeTheme ? "更新已保存主题" : "保存为本地主题"}
          </button>
          {activeTheme && (
            <button type="button" onClick={deleteActiveTheme}>
              删除主题
            </button>
          )}
        </div>
        {themeMessage && <small role="status">{themeMessage}</small>}
        {themeLibraryError && (
          <small className="theme-css-error" role="alert">
            {themeLibraryError}
          </small>
        )}
        {!activeTheme && duplicateName && (
          <small className="theme-css-error" role="alert">
            已有同名主题，请更换名称或先选择该主题进行更新。
          </small>
        )}
        {!activeTheme && preferences.savedThemes.length >= 20 && (
          <small>主题库已满；删除一个主题后才能保存新主题。</small>
        )}
        <small>
          本地主题 {preferences.savedThemes.length}/20；每份 CSS 最多 128
          KB，主题库总量最多 1.5 MB。
        </small>
        <small>
          样式仅保存在本机。主题包总量最多 96 KB，支持 CSS
          与图片/字体资源，导入时会内嵌资源；不允许外部 URL、@import
          或动态表达式。
        </small>
      </section>
      <section className="theme-gallery" aria-label="精选主题图库">
        <div className="theme-gallery-heading">
          <div>
            <h3>精选主题图库</h3>
            <small>由 Moxie 维护；安装前显示作者、许可和来源。</small>
          </div>
          <button
            type="button"
            aria-expanded={galleryOpen}
            onClick={() => {
              const open = !galleryOpen;
              setGalleryOpen(open);
              if (open && !gallery) void loadGallery();
            }}
          >
            {galleryOpen ? "收起图库" : "浏览主题图库"}
          </button>
        </div>
        {galleryOpen && (
          <div className="theme-gallery-content">
            {galleryLoading && (
              <small role="status">正在加载官方主题目录…</small>
            )}
            {galleryError && (
              <div className="theme-gallery-error" role="alert">
                <span>{galleryError}</span>
                <button type="button" onClick={() => void loadGallery()}>
                  <RefreshCw size={14} /> 重试
                </button>
              </div>
            )}
            {gallery && (
              <>
                <div className="theme-gallery-filters">
                  <input
                    aria-label="搜索精选主题"
                    placeholder="搜索主题"
                    value={galleryQuery}
                    onChange={(event) => setGalleryQuery(event.target.value)}
                  />
                  <select
                    aria-label="筛选主题外观"
                    value={galleryAppearance}
                    onChange={(event) =>
                      setGalleryAppearance(event.target.value)
                    }
                  >
                    <option value="all">全部外观</option>
                    <option value="light">浅色</option>
                    <option value="dark">深色</option>
                    <option value="paper">纸感</option>
                  </select>
                  <button
                    type="button"
                    aria-label="刷新精选主题目录"
                    disabled={galleryLoading}
                    onClick={() => void loadGallery()}
                  >
                    <RefreshCw size={15} />
                  </button>
                </div>
                {galleryThemes.length ? (
                  <div className="theme-gallery-grid">
                    {galleryThemes.map((theme) => (
                      <button
                        className="theme-gallery-card"
                        type="button"
                        key={theme.id}
                        aria-pressed={selectedGalleryTheme?.id === theme.id}
                        onClick={() => {
                          setSelectedGalleryTheme(theme);
                          setGalleryError("");
                        }}
                      >
                        <ThemePreview theme={theme} alt="" />
                        <span className="theme-gallery-card-copy">
                          <strong>{theme.name}</strong>
                          <small>
                            {preferences.savedThemes.some(
                              (saved) =>
                                saved.gallery?.id === theme.id &&
                                isNewerVersion(
                                  theme.version,
                                  saved.gallery.version,
                                ),
                            )
                              ? "有更新"
                              : theme.appearance === "dark"
                                ? "深色"
                                : theme.appearance === "paper"
                                  ? "纸感"
                                  : "浅色"}
                          </small>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <small>没有符合条件的主题。</small>
                )}
                {selectedGalleryTheme && (
                  <div className="theme-gallery-detail">
                    <ThemePreview
                      theme={selectedGalleryTheme}
                      alt={`${selectedGalleryTheme.name}主题预览`}
                    />
                    <div>
                      <h4>{selectedGalleryTheme.name}</h4>
                      <p>{selectedGalleryTheme.description}</p>
                      <small>
                        作者：{selectedGalleryTheme.author} · 许可：
                        {selectedGalleryTheme.license} · 版本：
                        {selectedGalleryTheme.version}
                      </small>
                      <a
                        href={selectedGalleryTheme.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        查看主题来源
                      </a>
                      {installedGalleryTheme && !galleryUpdateAvailable && (
                        <small>
                          已安装版本 {installedGalleryTheme.gallery?.version}
                        </small>
                      )}
                      {galleryUpdateAvailable && (
                        <p role="status">
                          已安装版本 {installedGalleryTheme?.gallery?.version}
                          ，图库提供新版本 {selectedGalleryTheme.version}
                          。确认后将替换并应用这个本地主题，其他已保存主题不受影响。
                        </p>
                      )}
                      <button
                        type="button"
                        aria-busy={
                          installingGalleryThemeId === selectedGalleryTheme.id
                        }
                        disabled={
                          galleryLoading ||
                          Boolean(installingGalleryThemeId) ||
                          Boolean(
                            installedGalleryTheme && !galleryUpdateAvailable,
                          )
                        }
                        onClick={() =>
                          void installGalleryTheme(selectedGalleryTheme)
                        }
                      >
                        <Check size={15} />{" "}
                        {installingGalleryThemeId === selectedGalleryTheme.id
                          ? "正在下载并校验…"
                          : installingGalleryThemeId
                            ? "另一主题正在安装…"
                            : galleryUpdateAvailable
                              ? "确认更新并应用"
                              : installedGalleryTheme
                                ? "已安装"
                                : "确认安装并应用"}
                      </button>
                    </div>
                  </div>
                )}
                <small>
                  新主题会另存为本地主题；更新已有图库主题需确认后替换并应用。离线时可重试，现有主题仍可使用。
                </small>
                {gallery?.withdrawnThemes.length ? (
                  <div className="theme-gallery-withdrawn" role="status">
                    {preferences.savedThemes
                      .filter((saved) =>
                        gallery.withdrawnThemes.some(
                          (withdrawn) => withdrawn.id === saved.gallery?.id,
                        ),
                      )
                      .map((saved) => {
                        const withdrawn = gallery.withdrawnThemes.find(
                          (item) => item.id === saved.gallery?.id,
                        )!;
                        return (
                          <p key={saved.name}>
                            “{saved.name}”已从图库撤回（{withdrawn.reason}
                            ）。本地副本保留，可继续使用或删除。
                          </p>
                        );
                      })}
                  </div>
                ) : null}
              </>
            )}
          </div>
        )}
      </section>
      <section className="pdf-settings" aria-label="PDF 导出设置">
        <h3>PDF 导出</h3>
        <label>
          纸张
          <select
            aria-label="PDF 纸张"
            value={preferences.pdfPageSize}
            onChange={(e) =>
              update(
                "pdfPageSize",
                e.target.value as Preferences["pdfPageSize"],
              )
            }
          >
            <option value="A4">A4</option>
            <option value="Letter">US Letter</option>
            <option value="Legal">US Legal</option>
          </select>
        </label>
        <label>
          方向
          <select
            aria-label="PDF 页面方向"
            value={preferences.pdfLandscape ? "landscape" : "portrait"}
            onChange={(e) =>
              update("pdfLandscape", e.target.value === "landscape")
            }
          >
            <option value="portrait">纵向</option>
            <option value="landscape">横向</option>
          </select>
        </label>
        <label>
          页边距 <span>{preferences.pdfMargin} mm</span>
          <input
            aria-label="PDF 页边距"
            type="range"
            min="5"
            max="40"
            step="1"
            value={preferences.pdfMargin}
            onChange={(e) => update("pdfMargin", Number(e.target.value))}
          />
        </label>
        <label className="toggle-setting">
          <span>
            页眉与页码
            <small>页眉显示文档标题，页脚显示当前页和总页数。</small>
          </span>
          <input
            aria-label="PDF 页眉与页码"
            type="checkbox"
            checked={preferences.pdfHeaderFooter}
            onChange={(e) => update("pdfHeaderFooter", e.target.checked)}
          />
        </label>
      </section>
      <section className="pdf-settings" aria-label="HTML 导出设置">
        <h3>HTML 导出</h3>
        <label className="toggle-setting">
          <span>
            导出时显示文档目录
            <small>在 HTML 页面中显示可跳转的标题侧栏；打印时自动隐藏。</small>
          </span>
          <input
            aria-label="HTML 导出时显示文档目录"
            type="checkbox"
            checked={preferences.htmlOutline}
            onChange={(e) => update("htmlOutline", e.target.checked)}
          />
        </label>
      </section>
      <h3 className="settings-section-title">写作体验</h3>
      <label className="toggle-setting">
        <span>
          自动保存到原文件
          <small>
            停止输入 1.2 秒后保存；仅适用于桌面版和已选定路径的文件。
          </small>
        </span>
        <input
          aria-label="自动保存到原文件"
          type="checkbox"
          checked={preferences.autoSave}
          onChange={(e) => update("autoSave", e.target.checked)}
        />
      </label>
      <label className="toggle-setting">
        <span>
          打字机模式<small>输入时让当前段落保持在视野中央。</small>
        </span>
        <input
          aria-label="打字机模式"
          type="checkbox"
          checked={preferences.typewriter}
          onChange={(e) => update("typewriter", e.target.checked)}
        />
      </label>
      <label className="toggle-setting">
        <span>
          智能引号
          <small>将直引号转换为弯引号；代码、数学和 YAML 中保持原样。</small>
        </span>
        <input
          aria-label="智能引号"
          type="checkbox"
          checked={preferences.smartQuotes}
          onChange={(e) => update("smartQuotes", e.target.checked)}
        />
      </label>
      <label className="toggle-setting">
        <span>
          智能破折号
          <small>将连续两个或三个连字符转换为短破折号或长破折号。</small>
        </span>
        <input
          aria-label="智能破折号"
          type="checkbox"
          checked={preferences.smartDashes}
          onChange={(e) => update("smartDashes", e.target.checked)}
        />
      </label>
      <label className="toggle-setting">
        <span>
          系统拼写检查<small>使用 macOS 当前启用的拼写词典。</small>
        </span>
        <input
          aria-label="系统拼写检查"
          type="checkbox"
          checked={preferences.spellCheck}
          onChange={(e) => update("spellCheck", e.target.checked)}
        />
      </label>
      <section className="update-settings" aria-label="软件更新">
        <h3>软件更新</h3>
        <label className="toggle-setting">
          <span>
            自动检查更新
            <small>启动桌面版时检查 GitHub Releases 中的稳定版本。</small>
          </span>
          <input
            aria-label="自动检查更新"
            type="checkbox"
            checked={preferences.autoCheckUpdates}
            onChange={(event) =>
              update("autoCheckUpdates", event.target.checked)
            }
          />
        </label>
        <div
          className="update-status"
          role={updateStatus.status === "error" ? "alert" : "status"}
          aria-live={updateStatus.status === "error" ? "assertive" : "polite"}
          aria-atomic="true"
        >
          {updateStatus.status === "checking" && "正在检查更新…"}
          {updateStatus.status === "idle" && "尚未检查更新。"}
          {updateStatus.status === "unsupported" && updateStatus.message}
          {updateStatus.status === "not-available" &&
            `当前已是最新版本${updateStatus.version ? `（${updateStatus.version}）` : ""}。`}
          {updateStatus.status === "available" &&
            `发现新版本 ${updateStatus.version}。`}
          {updateStatus.status === "downloading" &&
            `正在下载更新 ${Math.round(updateStatus.percent || 0)}%。`}
          {updateStatus.status === "downloaded" &&
            `版本 ${updateStatus.version} 已下载，可重启安装。${updateStatus.message ? ` ${updateStatus.message}` : ""}`}
          {updateStatus.status === "error" && updateStatus.message}
        </div>
        {updateStatus.status === "downloading" && (
          <progress
            aria-label="软件更新下载进度"
            aria-valuetext={`${Math.round(updateStatus.percent || 0)}%`}
            max="100"
            value={updateStatus.percent || 0}
          />
        )}
        <div className="update-actions">
          <button
            type="button"
            onClick={onCheckForUpdates}
            disabled={
              !window.desktop ||
              typeof window.desktop.checkForUpdates !== "function" ||
              ["checking", "available", "downloading", "downloaded"].includes(
                updateStatus.status,
              )
            }
          >
            立即检查更新
          </button>
          {updateStatus.status === "available" && (
            <button type="button" onClick={onDownloadUpdate}>
              下载更新
            </button>
          )}
          {updateStatus.status === "downloaded" && (
            <button type="button" onClick={onInstallUpdate}>
              重启并安装
            </button>
          )}
        </div>
        <small>
          macOS 自动安装需要 Developer ID 签名；Linux 自动更新仅适用于
          AppImage。
        </small>
        <a
          className="update-release-link"
          href="https://github.com/jincaiw/moxie/releases/latest"
          target="_blank"
          rel="noopener noreferrer"
        >
          打开官方版本下载页
        </a>
      </section>
      <p>
        恢复副本会自动更新。文件被其他程序修改时，自动保存会暂停，请手动保存处理冲突。
      </p>
      <div className="shortcut-list">
        <span>
          保存 <kbd>⌘S</kbd>
        </span>
        <span>
          粗体 <kbd>⌘B</kbd>
        </span>
        <span>
          查找 <kbd>⌘F</kbd>
        </span>
        <span>
          链接 <kbd>⌘K</kbd>
        </span>
      </div>
      <button className="primary-button" onClick={onClose}>
        完成
      </button>
    </Dialog>
  );
}
