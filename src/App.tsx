import { useEffect, useMemo, useRef, useState } from "react";
import {
  FileText,
  Plus,
  FolderOpen,
  PanelLeft,
  Sun,
  Moon,
  Code,
  Upload,
  Search,
  FolderSearch2,
  Check,
  ChevronDown,
  Settings as SettingsIcon,
  X,
  FileDown,
  Eye,
  ImagePlus,
  Type,
  Maximize2,
  Minimize2,
  Save,
  Clock,
  AlertCircle,
} from "lucide-react";
import { Editor, type EditorHandle, type Format } from "./Editor";
import { headings, type DocumentFile } from "./data";
import { download } from "./bridge";
import { useFolder } from "./useFolder";
import { FolderBrowser } from "./FolderBrowser";
import { exportHTML } from "./export";
import { withImages } from "./assets";
import { useWorkspace } from "./useWorkspace";
import { usePreferences } from "./preferences";
import { Settings } from "./Settings";
import { Dialog } from "./Dialog";
import { headingLabel, headingTarget, usableLink } from "./links";
import { documentStats } from "./stats";
import type { UpdateStatus } from "./bridge";

function Tool({
  label,
  children,
  onClick,
  active = false,
  disabled = false,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className={"tool " + (active ? "active" : "")}
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
const formats: { kind: Format; label: string; shortcut?: string }[] = [
  { kind: "bold", label: "粗体", shortcut: "⌘B" },
  { kind: "italic", label: "斜体", shortcut: "⌘I" },
  { kind: "highlight", label: "高亮", shortcut: "⌘⇧H" },
  { kind: "superscript", label: "上标" },
  { kind: "subscript", label: "下标" },
  { kind: "strike", label: "删除线", shortcut: "⌘⇧5" },
  { kind: "code", label: "行内代码", shortcut: "⌘⇧`" },
  { kind: "codeblock", label: "代码块", shortcut: "⌘⇧K" },
  { kind: "heading", label: "二级标题" },
  { kind: "quote", label: "引用", shortcut: "⌘⇧Q" },
  { kind: "bulletList", label: "无序列表", shortcut: "⌘⇧8" },
  { kind: "orderedList", label: "有序列表", shortcut: "⌘⇧7" },
  { kind: "task", label: "任务列表", shortcut: "⌘⇧L" },
  { kind: "footnote", label: "插入脚注" },
  { kind: "table", label: "插入表格" },
  { kind: "link", label: "插入链接", shortcut: "⌘K" },
];

export default function App() {
  const [message, setMessage] = useState("");
  const { preferences, update } = usePreferences();
  const workspace = useWorkspace(preferences.autoSave, setMessage);
  const { docs, current, busy, recent } = workspace;
  const documentHeadings = useMemo(
    () =>
      headings(current.text).map((heading) => ({
        ...heading,
        title: headingLabel(heading.title),
      })),
    [current.text],
  );
  const [cursor, setCursor] = useState({ position: 0, line: 1, column: 1 });
  let headingLow = 0;
  let headingHigh = documentHeadings.length;
  while (headingLow < headingHigh) {
    const middle = (headingLow + headingHigh) >>> 1;
    if (documentHeadings[middle].from <= cursor.position)
      headingLow = middle + 1;
    else headingHigh = middle;
  }
  const activeHeading = documentHeadings[headingLow - 1] || null;
  const [countSnapshot, setCountSnapshot] = useState({
    id: current.id,
    text: current.text,
  });
  const [source, setSource] = useState(false);
  const [sidebar, setSidebar] = useState(() => window.innerWidth > 650);
  const [focus, setFocus] = useState(false);
  const [tab, setTab] = useState("files");
  const [menu, setMenu] = useState<"export" | "format" | null>(null);
  const [settings, setSettings] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>(() =>
    window.desktop?.checkForUpdates
      ? { status: "idle" }
      : { status: "unsupported", message: "自动更新仅适用于桌面版。" },
  );
  const [pdfPreviewURL, setPdfPreviewURL] = useState<string | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const folderWorkspace = useFolder();
  const [tabGroup, setTabGroup] = useState("全部");
  const tabGroups = useMemo(
    () =>
      [
        ...new Set(docs.map((document) => document.group).filter(Boolean)),
      ] as string[],
    [docs],
  );
  const visibleDocs =
    tabGroup === "全部"
      ? docs
      : docs.filter((document) => document.group === tabGroup);
  useEffect(() => {
    if (tabGroup !== "全部" && !tabGroups.includes(tabGroup))
      setTabGroup("全部");
  }, [tabGroup, tabGroups]);
  const { tree, busy: folderBusy } = folderWorkspace;
  const [pendingAnchor, setPendingAnchor] = useState<{
    path?: string;
    id?: string;
    anchor: string;
  } | null>(null);
  const [reloadPrompt, setReloadPrompt] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [workspaceSearch, setWorkspaceSearch] = useState(false);
  const [workspaceQuery, setWorkspaceQuery] = useState("");
  const [searchTarget, setSearchTarget] = useState<{
    id?: string;
    path?: string;
    from: number;
  } | null>(null);
  const [projectResults, setProjectResults] = useState<
    { path: string; name: string; from: number; excerpt: string }[]
  >([]);
  const [projectSearchStatus, setProjectSearchStatus] = useState("");
  const [projectSearchBusy, setProjectSearchBusy] = useState(false);
  const [searchScope, setSearchScope] = useState<"all" | "opened" | "folder">(
    "all",
  );
  const [searchSort, setSearchSort] = useState<
    "relevance" | "name" | "location"
  >("relevance");
  const searchGeneration = useRef(0);
  const [recovered, setRecovered] = useState(() => docs.some((d) => d.dirty));
  const editor = useRef<EditorHandle>(null);
  const draggedDocument = useRef<string | null>(null);
  const workspaceSearchInput = useRef<HTMLInputElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const imageUpload = useRef<HTMLInputElement>(null);
  const toolbar = useRef<HTMLElement>(null);
  const visibleSidebar = sidebar && !focus;
  const autoError = workspace.autoErrors[current.id];
  const darkTheme =
    preferences.theme === "dark" || preferences.theme === "solarized-dark";
  useEffect(() => {
    const desktop = window.desktop;
    if (
      !desktop?.onUpdateStatus ||
      !desktop.getUpdateStatus ||
      !desktop.checkForUpdates
    ) {
      setUpdateStatus({
        status: "unsupported",
        message: "当前环境未启用桌面更新服务。",
      });
      return;
    }
    const unsubscribe = desktop.onUpdateStatus(setUpdateStatus);
    let active = true;
    void desktop.getUpdateStatus().then((status) => {
      if (active) setUpdateStatus(status);
    });
    if (preferences.autoCheckUpdates)
      void desktop.checkForUpdates().then((status) => {
        if (active) setUpdateStatus(status);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [preferences.autoCheckUpdates]);

  const runUpdateAction = async (
    action: "checkForUpdates" | "downloadUpdate" | "installUpdate",
  ) => {
    if (!window.desktop || typeof window.desktop[action] !== "function") return;
    try {
      setUpdateStatus(await window.desktop[action]());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (action === "installUpdate")
        setUpdateStatus((status) => ({ ...status, message }));
      else setUpdateStatus({ status: "error", message });
    }
  };
  useEffect(() => {
    const timer = setTimeout(
      () => setCountSnapshot({ id: current.id, text: current.text }),
      180,
    );
    return () => clearTimeout(timer);
  }, [current.id, current.text]);

  useEffect(() => {
    if (folderWorkspace.error && !folderWorkspace.root)
      setMessage(folderWorkspace.error);
  }, [folderWorkspace.error, folderWorkspace.root]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 6000);
    return () => clearTimeout(timer);
  }, [message]);
  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: PointerEvent) => {
      if (!toolbar.current?.contains(event.target as Node)) setMenu(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [menu]);

  const open = async () => {
    try {
      if (window.desktop) {
        const file = await window.desktop.open();
        if (file) workspace.importFile(file);
        void workspace.refreshRecent();
      } else upload.current?.click();
    } catch (error) {
      setMessage(String(error));
    }
  };
  const folder = async () => {
    try {
      if (!window.desktop) {
        setMessage("浏览器预览可打开 Markdown 文件；文件夹管理请使用桌面版。");
        return;
      }
      if (await folderWorkspace.open()) {
        setTab("files");
        setSidebar(true);
        setMessage("文件夹已打开，选择文档开始编辑。");
      }
    } catch (error) {
      setMessage(String(error));
    }
  };
  const reopen = async (path: string) => {
    try {
      if (window.desktop)
        workspace.importFile(await window.desktop.reopen(path));
      void workspace.refreshRecent();
    } catch {
      setMessage("无法打开最近的文件，它可能已被移动或删除。");
    }
  };
  const openLink = async (href: string) => {
    try {
      if (!usableLink(href)) throw Error("不支持此链接地址。");
      if (href.startsWith("#")) {
        let anchor: string;
        try {
          anchor = decodeURIComponent(href.slice(1));
        } catch {
          throw Error("标题链接包含无效的百分号编码。");
        }
        setPendingAnchor({
          id: current.id,
          anchor,
        });
        return;
      }
      if (window.desktop) {
        const result = await window.desktop.openLink({
          href,
          documentPath: current.path,
        });
        if (result.file) {
          workspace.importFile(result.file);
          void workspace.refreshRecent();
        }
        if (result.anchor && result.file)
          setPendingAnchor({ path: result.file.path, anchor: result.anchor });
      } else if (/^(https?:|mailto:)/i.test(href)) {
        window.open(href, "_blank", "noopener,noreferrer");
      } else setMessage("请在桌面版打开关联 Markdown 文档。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };
  useEffect(() => {
    if (
      !pendingAnchor ||
      (pendingAnchor.id
        ? pendingAnchor.id !== current.id
        : pendingAnchor.path !== current.path)
    )
      return;
    const target = headingTarget(current.text, pendingAnchor.anchor);
    if (!target) setMessage("未找到链接指定的标题。");
    else requestAnimationFrame(() => editor.current?.go(target.from));
    setPendingAnchor(null);
  }, [pendingAnchor, current.id, current.path, current.text]);
  useEffect(() => {
    if (!searchTarget) return;
    if (
      searchTarget.id
        ? searchTarget.id !== current.id
        : searchTarget.path !== current.path
    )
      return;
    requestAnimationFrame(() => editor.current?.go(searchTarget.from));
    setSearchTarget(null);
    setWorkspaceSearch(false);
  }, [searchTarget, current.id]);
  useEffect(() => {
    const token = ++searchGeneration.current;
    const query = workspaceQuery.trim();
    if (
      !workspaceSearch ||
      !query ||
      !folderWorkspace.root ||
      !window.desktop?.searchFolder
    ) {
      setProjectResults([]);
      setProjectSearchStatus("");
      setProjectSearchBusy(false);
      return;
    }
    setProjectSearchBusy(true);
    const timer = setTimeout(() => {
      void window
        .desktop!.searchFolder(folderWorkspace.root!, query)
        .then((result) => {
          if (token !== searchGeneration.current) return;
          setProjectResults(result.results);
          setProjectSearchStatus(
            `${result.scanned} 篇已检索${result.skipped ? `，${result.skipped} 篇跳过` : ""}${result.truncated ? " · 结果可能不完整" : ""}`,
          );
        })
        .catch((error) => {
          if (token !== searchGeneration.current) return;
          setProjectResults([]);
          setProjectSearchStatus(
            error instanceof Error ? error.message : "文件夹搜索失败",
          );
        })
        .finally(() => {
          if (token === searchGeneration.current) setProjectSearchBusy(false);
        });
    }, 450);
    return () => clearTimeout(timer);
  }, [workspaceSearch, workspaceQuery, folderWorkspace.root]);
  useEffect(() => {
    if (workspaceSearch)
      requestAnimationFrame(() => workspaceSearchInput.current?.focus());
  }, [workspaceSearch]);
  const remove = (id: string) => {
    workspace.remove(id);
    requestAnimationFrame(() => editor.current?.forget(id));
  };
  const saveCurrent = (saveAs = false) => {
    editor.current?.flush();
    const latest =
      workspace.docsRef.current.find((item) => item.id === current.id) ||
      current;
    void workspace.save(latest, saveAs);
  };
  const requestClose = (document: DocumentFile = current) => {
    if (document.id === current.id) editor.current?.flush();
    const latest =
      workspace.docsRef.current.find((item) => item.id === document.id) ||
      document;
    if (latest.dirty) setClosing(latest.id);
    else remove(latest.id);
  };
  const saveAndClose = async () => {
    if (closing === current.id) editor.current?.flush();
    const document = workspace.docsRef.current.find((d) => d.id === closing);
    if (!document || !(await workspace.save(document))) return;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    if (workspace.docsRef.current.find((d) => d.id === document.id)?.dirty) {
      setMessage("文档又有新的修改，请再次保存后关闭。");
      return;
    }
    remove(document.id);
    setClosing(null);
  };
  const performExport = async (format: "md" | "html" | "pdf" | "docx") => {
    setMenu(null);
    editor.current?.flush();
    const document =
      workspace.docsRef.current.find((item) => item.id === current.id) ||
      current;
    try {
      if (format === "md") {
        download(document.text, document.name);
        return;
      }
      const html = await exportHTML(
        document.text,
        document.name,
        document.path,
        preferences.customCSS,
        preferences.theme,
      );
      if (window.desktop) {
        if (
          await window.desktop.export({
            html,
            name: document.name,
            format,
            pdf:
              format === "pdf"
                ? {
                    pageSize: preferences.pdfPageSize,
                    landscape: preferences.pdfLandscape,
                    margin: preferences.pdfMargin,
                    headerFooter: preferences.pdfHeaderFooter,
                  }
                : undefined,
          })
        )
          setMessage("导出完成");
      } else if (format === "html")
        download(
          html,
          document.name.replace(/\.(md|markdown)$/i, "") + ".html",
          "text/html",
        );
      else if (format === "pdf") {
        const printWindow = window.open("", "_blank");
        if (!printWindow) {
          setMessage("请允许弹出窗口后再导出 PDF。");
          return;
        }
        const title = document.name.replace(/[\\\"\n\r<>]/g, " ");
        const pageMargin = Math.max(
          preferences.pdfMargin,
          preferences.pdfHeaderFooter ? 12 : preferences.pdfMargin,
        );
        const printCSS = `<style>@page { size: ${preferences.pdfPageSize} ${preferences.pdfLandscape ? "landscape" : "portrait"}; margin: ${pageMargin}mm ${preferences.pdfMargin}mm; ${preferences.pdfHeaderFooter ? `@top-center { content: "${title}"; font: 9pt sans-serif; color: #666; } @bottom-center { content: counter(page) " / " counter(pages); font: 9pt sans-serif; color: #666; }` : ""} }</style>`;
        printWindow.document.write(
          html.includes("</head>")
            ? html.replace("</head>", `${printCSS}</head>`)
            : html.replace("</html>", `${printCSS}</html>`),
        );
        printWindow.document.close();
        if (printWindow.document.readyState === "complete") printWindow.print();
        else printWindow.onload = () => printWindow.print();
      } else setMessage("Word 导出请使用 Moxie 桌面版。");
    } catch (error) {
      setMessage(String(error));
    }
  };
  const previewPDF = async () => {
    setMenu(null);
    editor.current?.flush();
    try {
      const document =
        workspace.docsRef.current.find((item) => item.id === current.id) ||
        current;
      const html = await exportHTML(
        document.text,
        document.name,
        document.path,
        preferences.customCSS,
        preferences.theme,
      );
      if (!window.desktop?.previewPDF) return;
      const bytes = await window.desktop.previewPDF({
        html,
        pdf: {
          pageSize: preferences.pdfPageSize,
          landscape: preferences.pdfLandscape,
          margin: preferences.pdfMargin,
          headerFooter: preferences.pdfHeaderFooter,
        },
      });
      const pdfBytes = new Uint8Array(bytes.byteLength);
      pdfBytes.set(bytes);
      const url = URL.createObjectURL(
        new Blob([pdfBytes.buffer], { type: "application/pdf" }),
      );
      setPdfPreviewURL((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return url;
      });
    } catch (error) {
      setMessage(`PDF 预览失败：${String(error)}`);
    }
  };
  const handleAction = (action: string) => {
    if (action.startsWith("format-")) {
      editor.current?.format(action.slice(7) as Format);
      return;
    }
    if (action === "undo") editor.current?.undo();
    if (action === "redo") editor.current?.redo();
    if (action === "new") workspace.add();
    if (action === "open") void open();
    if (action === "folder") void folder();
    if (action === "save") {
      saveCurrent();
    }
    if (action === "saveAs") {
      saveCurrent(true);
    }
    if (action === "source") setSource((value) => !value);
    if (action === "find") editor.current?.find();
    if (action === "export")
      setMenu((value) => (value === "export" ? null : "export"));
    if (action === "settings") setSettings(true);
    if (action === "focus") setFocus((value) => !value);
    if (action === "image") imageUpload.current?.click();
    if (action === "close-document") requestClose();
    if (action === "previous-document" || action === "next-document") {
      if (docs.length > 1) {
        const index = docs.findIndex((document) => document.id === current.id);
        const offset = action === "previous-document" ? -1 : 1;
        workspace.setActive(
          docs[(index + offset + docs.length) % docs.length].id,
        );
      }
    }
    if (action === "keep-close") {
      void (async () => {
        editor.current?.flush();
        if (await workspace.flushAsync()) window.desktop?.closeReady();
      })();
    }
    if (action === "close-request")
      void (async () => {
        editor.current?.flush();
        if (workspace.saving.current) {
          setMessage("正在保存，请完成后再关闭。");
          return;
        }
        for (const document of workspace.docsRef.current.filter((d) => d.dirty))
          if (!(await workspace.save(document))) return;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        if (workspace.docsRef.current.some((d) => d.dirty)) {
          setMessage("保存期间文档发生了变化，请再次保存后关闭。");
          return;
        }
        if (await workspace.flushAsync()) window.desktop?.closeReady();
      })();
  };
  const actionRef = useRef(handleAction);
  actionRef.current = handleAction;
  useEffect(() => {
    const dispose = window.desktop?.onAction((action) =>
      actionRef.current(action),
    );
    const key = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.isComposing ||
        event.altKey
      )
        return;
      if (document.querySelector("dialog[open]")) return;
      if (event.shiftKey && event.code === "BracketLeft") {
        event.preventDefault();
        actionRef.current("previous-document");
        return;
      }
      if (event.shiftKey && event.code === "BracketRight") {
        event.preventDefault();
        actionRef.current("next-document");
        return;
      }
      const mapped: Record<string, string> = {
        s: event.shiftKey ? "saveAs" : "save",
        o: "open",
        n: "new",
        "/": "source",
        ",": "settings",
        w: event.shiftKey ? "" : "close-document",
        f: event.shiftKey ? "focus" : "",
      };
      const action = mapped[event.key.toLowerCase()];
      if (action) {
        event.preventDefault();
        actionRef.current(action);
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      dispose?.();
      window.removeEventListener("keydown", key);
    };
  }, []);

  const closingDocument = docs.find((d) => d.id === closing);
  const stats = useMemo(
    () =>
      documentStats(
        countSnapshot.id === current.id ? countSnapshot.text : current.text,
      ),
    [countSnapshot, current.id],
  );
  const cursorLine = cursor.line;
  const cursorColumn = cursor.column;
  const workspaceResults = (() => {
    const needle = workspaceQuery.trim();
    if (!needle) return [];
    const normalized = needle.toLocaleLowerCase();
    const results: {
      id: string;
      path?: string;
      name: string;
      from: number;
      excerpt: string;
    }[] = [];
    for (const document of docs) {
      const text = document.text;
      const lower = text.toLocaleLowerCase();
      let from = 0;
      while (results.length < 100) {
        const index = lower.indexOf(normalized, from);
        if (index < 0) break;
        const start = Math.max(0, text.lastIndexOf("\n", index - 1) + 1);
        const lineEnd = text.indexOf("\n", index);
        const end = lineEnd < 0 ? text.length : lineEnd;
        const line = text.slice(start, end).trim();
        const excerpt =
          line.length > 180
            ? `…${line.slice(Math.max(0, index - start - 70), index - start + needle.length + 90)}…`
            : line;
        results.push({
          id: document.id,
          path: document.path,
          name: document.name,
          from: index,
          excerpt:
            excerpt ||
            text.slice(Math.max(0, index - 30), index + needle.length + 30),
        });
        from = index + Math.max(needle.length, 1);
      }
      if (results.length >= 100) break;
    }
    return results;
  })();
  const openPaths = new Set(
    docs.map((document) => document.path).filter(Boolean),
  );
  const combinedSearchResults = [
    ...workspaceResults.map((result) => ({
      ...result,
      source: "opened" as const,
    })),
    ...projectResults
      .filter((result) => !openPaths.has(result.path))
      .map((result) => ({
        ...result,
        id: undefined as string | undefined,
        source: "folder" as const,
      })),
  ];
  const queryLower = workspaceQuery.trim().toLocaleLowerCase();
  const folderRoot = folderWorkspace.root?.replace(/[\\/]+$/, "");
  const isInSearchFolder = (path?: string) =>
    !!folderRoot &&
    !!path &&
    (path === folderRoot ||
      path.startsWith(
        `${folderRoot}${folderWorkspace.root?.includes("\\") ? "\\" : "/"}`,
      ));
  const allSearchResults = combinedSearchResults
    .filter(
      (result) =>
        searchScope === "all" ||
        (searchScope === "opened" && result.source === "opened") ||
        (searchScope === "folder" &&
          (result.source === "folder" || isInSearchFolder(result.path))),
    )
    .sort((a, b) => {
      if (searchSort === "name")
        return (
          a.name.localeCompare(b.name, "zh-CN") ||
          (a.path || "").localeCompare(b.path || "")
        );
      if (searchSort === "location")
        return (
          (a.path || a.name).localeCompare(b.path || b.name, "zh-CN") ||
          a.from - b.from
        );
      const rank = (result: (typeof combinedSearchResults)[number]) => {
        const match = result.excerpt.slice(0, 220);
        const exactCase = match.includes(workspaceQuery.trim()) ? 1 : 0;
        const titleMatch = result.name.toLocaleLowerCase().includes(queryLower)
          ? 1
          : 0;
        return titleMatch * 2 + exactCase;
      };
      return (
        rank(b) - rank(a) ||
        (a.path || a.name).localeCompare(b.path || b.name, "zh-CN") ||
        a.from - b.from
      );
    })
    .slice(0, 200);
  const openSearchResult = async (result: {
    id?: string;
    path?: string;
    from: number;
  }) => {
    if (result.id) {
      setSearchTarget({ id: result.id, from: result.from });
      workspace.setActive(result.id);
      return;
    }
    if (!result.path || !window.desktop) return;
    setSearchTarget({ path: result.path, from: result.from });
    try {
      workspace.importFile(await window.desktop.reopen(result.path));
    } catch (error) {
      setSearchTarget(null);
      setMessage(error instanceof Error ? error.message : "无法打开搜索结果");
    }
  };
  if (!workspace.recoveryReady)
    return <div className="recovery-loading">正在载入恢复副本…</div>;
  return (
    <div
      className={
        "app " +
        (!visibleSidebar ? "sidebar-hidden " : "") +
        (focus ? "focus-mode" : "")
      }
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        const files = Array.from(event.dataTransfer.files).filter((file) =>
          /\.(md|markdown|txt)$/i.test(file.name),
        );
        if (!files.length) return;
        event.preventDefault();
        void Promise.all(
          files.map(async (file) =>
            workspace.importFile({ name: file.name, text: await file.text() }),
          ),
        ).catch((error) => setMessage(String(error)));
      }}
    >
      {!settings &&
        ["available", "downloaded"].includes(updateStatus.status) && (
          <button
            className="update-notice"
            onClick={() => setSettings(true)}
            aria-label="打开软件更新设置"
          >
            {updateStatus.status === "available"
              ? `发现新版本 ${updateStatus.version || ""}，点击查看更新。`
              : `版本 ${updateStatus.version || "新版本"} 已下载，点击完成安装。`}
          </button>
        )}
      {visibleSidebar && (
        <aside className="sidebar">
          <div className="window-space">
            {!window.desktop && (
              <div className="traffic" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
            )}
          </div>
          <div className="brand">
            <h1>墨写</h1>
            <p>本地 Markdown 编辑器</p>
          </div>
          <div className="side-tabs" role="tablist" aria-label="侧栏">
            <button
              role="tab"
              aria-selected={tab === "files"}
              className={tab === "files" ? "selected" : ""}
              onClick={() => setTab("files")}
            >
              文件
            </button>
            <button
              role="tab"
              aria-selected={tab === "outline"}
              className={tab === "outline" ? "selected" : ""}
              onClick={() => setTab("outline")}
            >
              大纲
            </button>
          </div>
          <nav
            className="file-list"
            aria-label={tab === "files" ? "文档列表" : "文档大纲"}
          >
            {tab === "files"
              ? docs.map((document) => (
                  <div
                    className={
                      "file-entry " +
                      (document.id === current.id ? "selected" : "")
                    }
                    key={document.id}
                  >
                    <button
                      aria-label={document.name}
                      className="file-row"
                      title={document.path || document.name}
                      onClick={() => workspace.setActive(document.id)}
                    >
                      <FileText size={18} />
                      <span>{document.name}</span>
                      {document.dirty && (
                        <i className="dirty-dot" aria-label="未保存" />
                      )}
                    </button>
                    <button
                      className="close-file"
                      aria-label={"关闭 " + document.name}
                      title="关闭文档"
                      onClick={() => requestClose(document)}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))
              : documentHeadings.map((heading) => (
                  <button
                    className={
                      "outline-row " +
                      (heading.from === activeHeading?.from ? "active" : "")
                    }
                    key={heading.from}
                    aria-current={
                      heading.from === activeHeading?.from
                        ? "location"
                        : undefined
                    }
                    style={{ paddingLeft: 18 + (heading.level - 1) * 12 }}
                    onClick={() => editor.current?.go(heading.from)}
                  >
                    {heading.title}
                  </button>
                ))}
            {tab === "files" && tree && (
              <FolderBrowser
                tree={tree}
                active={current.path}
                open={(path) => void reopen(path)}
                refresh={() => void folderWorkspace.refresh()}
                close={folderWorkspace.close}
                busy={folderBusy}
                expandedPaths={folderWorkspace.expanded}
                toggle={folderWorkspace.toggle}
                error={folderWorkspace.error}
              />
            )}
            {tab === "files" && folderWorkspace.root && !tree && (
              <section
                className="folder-browser folder-unavailable"
                aria-label="文件夹浏览"
              >
                <p className="tree-empty">
                  {folderWorkspace.error || "正在恢复文件夹…"}
                </p>
                <button
                  disabled={folderBusy}
                  onClick={() => void folderWorkspace.refresh()}
                >
                  重试读取文件夹
                </button>
                <button onClick={folderWorkspace.close}>关闭文件夹</button>
              </section>
            )}
            {tab === "files" && recent.length > 0 && (
              <section className="recent-files">
                <h2>
                  <Clock size={13} />
                  最近打开
                </h2>
                {recent.slice(0, 5).map((file) => (
                  <button
                    key={file.path}
                    title={file.path}
                    onClick={() => void reopen(file.path)}
                  >
                    {file.name}
                  </button>
                ))}
              </section>
            )}
          </nav>
          <div className="side-actions">
            <button onClick={workspace.add}>
              <Plus size={19} />
              新建文件
            </button>
            <button onClick={() => void open()}>
              <FileText size={17} />
              打开文件 <kbd>⌘O</kbd>
            </button>
            <button onClick={() => void folder()}>
              <FolderOpen size={18} />
              打开文件夹
            </button>
          </div>
        </aside>
      )}
      <main className="workspace">
        <header ref={toolbar} className="toolbar">
          <div className="document-title">
            <Tool
              label="切换侧栏"
              onClick={() => {
                if (focus) setFocus(false);
                setSidebar((value) => !value);
              }}
            >
              <PanelLeft size={18} />
            </Tool>
            <span>{current.name}</span>
            {current.dirty && (
              <i className="dirty-dot" aria-label="文档未保存" />
            )}
          </div>
          <div className="toolbar-actions">
            <div className="mode-switch">
              <button
                className={!source ? "chosen" : ""}
                onClick={() => setSource(false)}
              >
                即时排版
              </button>
              <button
                className={source ? "chosen" : ""}
                onClick={() => setSource(true)}
              >
                <Code size={16} />
                源码
              </button>
            </div>
            <Tool
              label="格式"
              active={menu === "format"}
              onClick={() =>
                setMenu((value) => (value === "format" ? null : "format"))
              }
            >
              <Type size={18} />
            </Tool>
            <Tool label="插入图片" onClick={() => imageUpload.current?.click()}>
              <ImagePlus size={18} />
            </Tool>
            <Tool label="查找与替换" onClick={() => editor.current?.find()}>
              <Search size={18} />
            </Tool>
            <Tool
              label="搜索项目文件夹"
              active={workspaceSearch}
              onClick={() => setWorkspaceSearch((open) => !open)}
            >
              <FolderSearch2 size={18} />
            </Tool>
            <button
              className="export-button"
              aria-label="导出"
              aria-expanded={menu === "export"}
              onClick={() =>
                setMenu((value) => (value === "export" ? null : "export"))
              }
            >
              <Upload size={16} />
              <span>导出</span>
              <ChevronDown size={13} />
            </button>
            <div className="toolbar-divider" />
            <Tool
              label={focus ? "退出专注模式" : "专注模式"}
              active={focus}
              onClick={() => setFocus((value) => !value)}
            >
              {focus ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </Tool>
            <Tool
              label={darkTheme ? "切换浅色主题" : "切换深色主题"}
              onClick={() => update("theme", darkTheme ? "light" : "dark")}
            >
              {darkTheme ? <Moon size={19} /> : <Sun size={19} />}
            </Tool>
            <Tool label="偏好设置" onClick={() => setSettings(true)}>
              <SettingsIcon size={18} />
            </Tool>
          </div>
          {menu === "export" && (
            <div className="export-menu" role="menu">
              <button role="menuitem" onClick={() => void performExport("md")}>
                <FileText size={17} />
                Markdown 文件
              </button>
              <button
                role="menuitem"
                onClick={() => void performExport("html")}
              >
                <Code size={17} />
                HTML 网页
              </button>
              <button role="menuitem" onClick={() => void performExport("pdf")}>
                <FileDown size={17} />
                PDF 文档
              </button>
              {window.desktop && (
                <button role="menuitem" onClick={() => void previewPDF()}>
                  <Eye size={17} />
                  预览 PDF 分页
                </button>
              )}
              {window.desktop && (
                <button
                  role="menuitem"
                  onClick={() => void performExport("docx")}
                >
                  <FileText size={17} />
                  Word 文档（DOCX）
                </button>
              )}
              <hr />
              <button
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  saveCurrent(true);
                }}
              >
                <Save size={17} />
                另存为…
              </button>
            </div>
          )}
          {menu === "format" && (
            <div className="export-menu format-menu" role="menu">
              {formats.map((format) => (
                <button
                  role="menuitem"
                  key={format.kind}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    editor.current?.format(format.kind);
                    setMenu(null);
                  }}
                >
                  <span>{format.label}</span>
                  {format.shortcut && <kbd>{format.shortcut}</kbd>}
                </button>
              ))}
            </div>
          )}
          {workspaceSearch && (
            <section className="workspace-search" aria-label="跨文档搜索">
              <div className="workspace-search-input">
                <Search size={16} />
                <input
                  ref={workspaceSearchInput}
                  value={workspaceQuery}
                  onChange={(event) => setWorkspaceQuery(event.target.value)}
                  placeholder={
                    folderWorkspace.root
                      ? "搜索文件夹与已打开文档"
                      : "搜索已打开的文档"
                  }
                  aria-label="搜索文件夹与已打开文档"
                />
                <span>
                  {projectSearchBusy
                    ? "搜索中…"
                    : workspaceQuery.trim()
                      ? `${allSearchResults.length}${allSearchResults.length === 200 ? "+" : ""} 条`
                      : "输入搜索内容"}
                </span>
                <button
                  aria-label="关闭跨文档搜索"
                  onClick={() => setWorkspaceSearch(false)}
                >
                  <X size={16} />
                </button>
              </div>
              {workspaceQuery.trim() && (
                <div className="workspace-search-controls">
                  <label>
                    范围
                    <select
                      value={searchScope}
                      onChange={(event) =>
                        setSearchScope(event.target.value as typeof searchScope)
                      }
                    >
                      <option value="all">全部文档</option>
                      <option value="opened">已打开</option>
                      <option value="folder" disabled={!folderWorkspace.root}>
                        文件夹内
                      </option>
                    </select>
                  </label>
                  <label>
                    排序
                    <select
                      value={searchSort}
                      onChange={(event) =>
                        setSearchSort(event.target.value as typeof searchSort)
                      }
                    >
                      <option value="relevance">相关度</option>
                      <option value="name">文件名</option>
                      <option value="location">路径与位置</option>
                    </select>
                  </label>
                </div>
              )}
              {workspaceQuery.trim() && (
                <div className="workspace-search-results">
                  {allSearchResults.length ? (
                    allSearchResults.map((result, index) => (
                      <button
                        key={`${result.id || result.path}:${result.from}:${index}`}
                        onClick={() => void openSearchResult(result)}
                      >
                        <strong>{result.name}</strong>
                        <small>{result.path || "未保存文档"}</small>
                        <span>{result.excerpt}</span>
                      </button>
                    ))
                  ) : (
                    <p>
                      {projectSearchBusy
                        ? "正在搜索…"
                        : projectSearchStatus || "没有找到匹配内容"}
                    </p>
                  )}
                  {projectSearchStatus && <p>{projectSearchStatus}</p>}
                </div>
              )}
            </section>
          )}
        </header>
        {docs.length > 1 && (
          <div className="document-tab-area">
            <div className="document-group-bar" aria-label="文档分组">
              <button
                className={tabGroup === "全部" ? "selected" : ""}
                onClick={() => setTabGroup("全部")}
              >
                全部 <small>{docs.length}</small>
              </button>
              {tabGroups.map((group) => (
                <span
                  key={group}
                  className={
                    "document-group " + (tabGroup === group ? "selected" : "")
                  }
                >
                  <button
                    className="document-group-select"
                    onClick={() => {
                      setTabGroup(group);
                      const first = docs.find(
                        (document) => document.group === group,
                      );
                      if (first) workspace.setActive(first.id);
                    }}
                  >
                    {group}{" "}
                    <small>
                      {
                        docs.filter((document) => document.group === group)
                          .length
                      }
                    </small>
                  </button>
                  <button
                    className="document-group-action"
                    aria-label={`重命名分组 ${group}`}
                    title="重命名分组"
                    onClick={() => {
                      const name = window.prompt("重命名分组", group);
                      const normalized = name?.trim().slice(0, 32);
                      if (!normalized || normalized === group) return;
                      docs
                        .filter((document) => document.group === group)
                        .forEach((document) =>
                          workspace.setDocumentGroup(document.id, normalized),
                        );
                      if (tabGroup === group) setTabGroup(normalized);
                    }}
                  >
                    ✎
                  </button>
                  <button
                    className="document-group-action"
                    aria-label={`移除分组 ${group}`}
                    title="移除分组（文档保留为未分组）"
                    onClick={() => {
                      docs
                        .filter((document) => document.group === group)
                        .forEach((document) =>
                          workspace.setDocumentGroup(document.id),
                        );
                      if (tabGroup === group) setTabGroup("全部");
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
              <button
                className="document-group-add"
                aria-label="新建标签分组"
                title="将当前文档加入新分组"
                onClick={() => {
                  const name = window.prompt("分组名称");
                  const normalized = name?.trim().slice(0, 32);
                  if (normalized) {
                    workspace.setDocumentGroup(current.id, normalized);
                    setTabGroup(normalized);
                  }
                }}
              >
                ＋ 分组
              </button>
            </div>
            <nav
              className="document-tabs"
              role="tablist"
              aria-label="打开的文档"
            >
              {visibleDocs.map((document) => {
                const index = docs.findIndex((item) => item.id === document.id);
                return (
                  <div
                    className={
                      "document-tab " +
                      (document.id === current.id ? "selected" : "")
                    }
                    role="presentation"
                    key={document.id}
                    draggable
                    onDragStart={(event) => {
                      draggedDocument.current = document.id;
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", document.id);
                    }}
                    onDragOver={(event) => {
                      if (draggedDocument.current) {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const moving = draggedDocument.current;
                      if (moving) workspace.moveDocument(moving, document.id);
                      draggedDocument.current = null;
                    }}
                    onDragEnd={() => {
                      draggedDocument.current = null;
                    }}
                  >
                    <button
                      className="document-tab-select"
                      role="tab"
                      aria-selected={document.id === current.id}
                      aria-keyshortcuts="Alt+Shift+ArrowLeft Alt+Shift+ArrowRight"
                      title={`${document.name} · 中键关闭；拖动可排序；按 Alt+Shift+方向键可移动`}
                      onClick={() => workspace.setActive(document.id)}
                      onAuxClick={(event) => {
                        if (event.button !== 1) return;
                        event.preventDefault();
                        requestClose(document);
                      }}
                      onKeyDown={(event) => {
                        if (!event.altKey || !event.shiftKey) return;
                        const offset =
                          event.key === "ArrowLeft"
                            ? -1
                            : event.key === "ArrowRight"
                              ? 1
                              : 0;
                        const target = docs[index + offset];
                        if (!target) return;
                        event.preventDefault();
                        workspace.moveDocument(document.id, target.id);
                      }}
                    >
                      {document.dirty && (
                        <i className="document-tab-dirty" aria-label="未保存" />
                      )}
                      <span>{document.name}</span>
                    </button>
                    <select
                      className="document-tab-group"
                      aria-label={`${document.name}所属分组`}
                      title="所属分组"
                      value={document.group || ""}
                      onChange={(event) => {
                        const nextGroup = event.target.value || undefined;
                        workspace.setDocumentGroup(document.id, nextGroup);
                        if (
                          document.id === current.id &&
                          tabGroup !== "全部" &&
                          nextGroup !== tabGroup
                        ) {
                          const replacement = docs.find(
                            (item) =>
                              item.id !== document.id &&
                              item.group === tabGroup,
                          );
                          if (replacement) workspace.setActive(replacement.id);
                          else setTabGroup("全部");
                        }
                      }}
                    >
                      <option value="">未分组</option>
                      {tabGroups.map((group) => (
                        <option key={group} value={group}>
                          {group}
                        </option>
                      ))}
                    </select>
                    <button
                      className="document-tab-close"
                      aria-label={`关闭 ${document.name}`}
                      title="关闭文档"
                      onClick={() => requestClose(document)}
                    >
                      <X size={13} />
                    </button>
                  </div>
                );
              })}
            </nav>
          </div>
        )}
        {recovered && (
          <div className="recovery-banner">
            已恢复上次会话的未保存文档。请保存到文件。
            <button
              aria-label="关闭恢复提示"
              onClick={() => setRecovered(false)}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {workspace.externalChanges[current.id] && (
          <div className="recovery-banner external-warning" role="status">
            <span>
              {workspace.externalChanges[current.id].status === "changed"
                ? "文件在其他程序中发生了修改。当前编辑已保留。"
                : "磁盘文件已删除或无法读取。当前编辑已保留。"}
            </span>
            {workspace.externalChanges[current.id].status === "changed" && (
              <button onClick={() => setReloadPrompt(current.id)}>
                载入磁盘版本
              </button>
            )}
            <button onClick={() => saveCurrent(true)}>另存为保留编辑</button>
          </div>
        )}
        {autoError && !workspace.externalChanges[current.id] && (
          <div className="recovery-banner save-warning">
            <span>
              <AlertCircle size={14} />
              {autoError}
            </span>
            <button onClick={() => saveCurrent()}>手动保存</button>
          </div>
        )}
        <div className="document-area">
          <Editor
            ref={editor}
            id={current.id}
            text={current.text}
            path={current.path}
            source={source}
            typewriter={preferences.typewriter}
            spellCheck={preferences.spellCheck}
            theme={darkTheme ? "dark" : "light"}
            onChange={(text) => workspace.edit(current.id, text)}
            onDirty={() => workspace.markDirty(current.id)}
            onCursorChange={(position, line, column) =>
              setCursor({ position, line, column })
            }
            onLink={(href) => void openLink(href)}
            onImages={withImages(current)}
            onError={setMessage}
          />
        </div>
        <footer className="statusbar">
          <button onClick={() => saveCurrent()} disabled={busy}>
            {current.dirty ? <Save size={13} /> : <Check size={13} />}
            {busy
              ? "正在保存…"
              : current.dirty
                ? "未保存 · 点击保存"
                : current.path
                  ? "已保存"
                  : "会话副本"}
          </button>
          <span className="recovery-status">
            {preferences.autoSave && window.desktop
              ? autoError
                ? "自动保存已暂停"
                : current.path
                  ? "自动保存已开启"
                  : "首次保存后启用自动保存"
              : workspace.recoveryStatus}
          </span>
          <div className="status-meta">
            <span>Markdown</span>
            <span>UTF-8</span>
            <span>
              行 {cursorLine}, 列 {cursorColumn}
            </span>
            <button
              className="stats-trigger"
              aria-label="字数统计"
              onClick={() => setStatsOpen(true)}
            >
              {stats.charactersWithoutSpaces.toLocaleString()} 字符
            </button>
          </div>
        </footer>
      </main>
      <input
        ref={upload}
        className="md-input"
        type="file"
        accept=".md,.markdown,.txt"
        multiple
        hidden
        onChange={async (event) => {
          const files = Array.from(event.target.files || []);
          event.target.value = "";
          try {
            for (const file of files)
              workspace.importFile({
                name: file.name,
                text: await file.text(),
              });
          } catch (error) {
            setMessage(String(error));
          }
        }}
      />
      <input
        ref={imageUpload}
        data-kind="image"
        aria-label="插入图片文件"
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          event.target.value = "";
          void editor.current?.images(files);
        }}
      />
      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}
      {settings && (
        <Settings
          preferences={preferences}
          update={update}
          updateStatus={updateStatus}
          onCheckForUpdates={() => void runUpdateAction("checkForUpdates")}
          onDownloadUpdate={() => void runUpdateAction("downloadUpdate")}
          onInstallUpdate={() => void runUpdateAction("installUpdate")}
          onClose={() => setSettings(false)}
        />
      )}
      {pdfPreviewURL && (
        <Dialog
          title="PDF 分页预览"
          onClose={() => {
            URL.revokeObjectURL(pdfPreviewURL);
            setPdfPreviewURL(null);
          }}
        >
          <header className="pdf-preview-header">
            <h2>PDF 分页预览</h2>
            <Tool
              label="关闭 PDF 预览"
              onClick={() => {
                URL.revokeObjectURL(pdfPreviewURL);
                setPdfPreviewURL(null);
              }}
            >
              <X size={18} />
            </Tool>
          </header>
          <p className="pdf-preview-note">
            此预览由当前 PDF 导出引擎生成，包含实际分页与页眉页脚。
          </p>
          <iframe
            className="pdf-preview-frame"
            src={`${pdfPreviewURL}#toolbar=1&view=FitH`}
            title="PDF 页面预览"
          />
        </Dialog>
      )}
      {statsOpen && (
        <Dialog title="字数统计" onClose={() => setStatsOpen(false)}>
          <header>
            <h2>字数统计</h2>
            <Tool label="关闭字数统计" onClick={() => setStatsOpen(false)}>
              <X size={18} />
            </Tool>
          </header>
          <div className="document-stats">
            <div>
              <span>字数</span>
              <strong>{stats.words.toLocaleString()}</strong>
            </div>
            <div>
              <span>字符（不含空格）</span>
              <strong>{stats.charactersWithoutSpaces.toLocaleString()}</strong>
            </div>
            <div>
              <span>字符（含空格）</span>
              <strong>{stats.characters.toLocaleString()}</strong>
            </div>
            <div>
              <span>行数</span>
              <strong>{stats.lines.toLocaleString()}</strong>
            </div>
            <div>
              <span>段落</span>
              <strong>{stats.paragraphs.toLocaleString()}</strong>
            </div>
            <div>
              <span>预计阅读</span>
              <strong>{stats.readingMinutes} 分钟</strong>
            </div>
          </div>
          <button
            className="primary-button"
            onClick={() => setStatsOpen(false)}
          >
            完成
          </button>
        </Dialog>
      )}
      {reloadPrompt && (
        <Dialog title="载入磁盘版本" onClose={() => setReloadPrompt(null)}>
          <header>
            <h2>载入磁盘版本？</h2>
          </header>
          <p className="close-description">
            载入会替换这份文档的当前编辑。可先取消并另存为，保留两个版本。
          </p>
          <div className="dialog-actions">
            <button onClick={() => setReloadPrompt(null)}>取消</button>
            <button
              className="primary-button"
              onClick={async () => {
                if (await workspace.reloadExternal(reloadPrompt))
                  setReloadPrompt(null);
              }}
            >
              替换当前编辑
            </button>
          </div>
        </Dialog>
      )}
      {closingDocument && (
        <Dialog title="关闭文档" onClose={() => setClosing(null)}>
          <header>
            <h2>保存修改？</h2>
            <Tool label="取消关闭" onClick={() => setClosing(null)}>
              <X size={18} />
            </Tool>
          </header>
          <p className="close-description">
            “{closingDocument.name}
            ”还有未保存的修改。保存后关闭，或放弃这些修改。
          </p>
          <div className="dialog-actions">
            <button onClick={() => setClosing(null)}>取消</button>
            <button
              onClick={() => {
                remove(closingDocument.id);
                setClosing(null);
              }}
            >
              放弃修改
            </button>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void saveAndClose()}
            >
              保存并关闭
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
