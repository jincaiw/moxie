import { X } from "lucide-react";
import { useRef, useState } from "react";
import { Dialog } from "./Dialog";
import { themeCSSError, type Preferences } from "./preferences";
import { download } from "./bridge";
export function Settings({
  preferences,
  update,
  onClose,
}: {
  preferences: Preferences;
  update: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
  onClose: () => void;
}) {
  const themeFile = useRef<HTMLInputElement>(null);
  const [themeName, setThemeName] = useState("");
  const [themeMessage, setThemeMessage] = useState("");
  const cssError = themeCSSError(preferences.customCSS);
  const activeTheme = preferences.savedThemes.find(
    (theme) => theme.name === preferences.activeSavedTheme,
  );
  const normalizedName = themeName.trim();
  const duplicateName = preferences.savedThemes.some(
    (theme) => theme.name.toLowerCase() === normalizedName.toLowerCase(),
  );
  const saveTheme = () => {
    if (cssError) return;
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
      preferences.savedThemes.filter((theme) => theme.name !== activeTheme.name),
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
              !preferences.customCSS.trim() ||
              (activeTheme
                ? false
                : !normalizedName || duplicateName ||
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
        {!activeTheme && duplicateName && (
          <small className="theme-css-error" role="alert">
            已有同名主题，请更换名称或先选择该主题进行更新。
          </small>
        )}
        {!activeTheme && preferences.savedThemes.length >= 20 && (
          <small>主题库已满；删除一个主题后才能保存新主题。</small>
        )}
        <small>本地主题 {preferences.savedThemes.length}/20；每个主题最多 64 KB。</small>
        <small>
          样式仅保存在本机。为保护隐私，不允许 @import、url() 或动态表达式。
        </small>
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
          系统拼写检查<small>使用 macOS 当前启用的拼写词典。</small>
        </span>
        <input
          aria-label="系统拼写检查"
          type="checkbox"
          checked={preferences.spellCheck}
          onChange={(e) => update("spellCheck", e.target.checked)}
        />
      </label>
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
