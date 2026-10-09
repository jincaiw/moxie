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
  ChevronRight,
  Settings as SettingsIcon,
  X,
  FileDown,
  Eye,
  ImagePlus,
  Scaling,
  Type,
  Maximize2,
  Minimize2,
  Save,
  Clock,
  AlertCircle,
  MoreHorizontal,
  Download,
  Copy,
  FolderInput,
} from "lucide-react";
import { Editor, type EditorHandle, type Format } from "./Editor";
import { headings, lineBoundsAt, type DocumentFile } from "./data";
import { download } from "./bridge";
import { useFolder } from "./useFolder";
import { FolderBrowser } from "./FolderBrowser";
import { exportHTML, withoutHTMLStyles } from "./export";
import { downloadRemoteImages, manageLocalImages, withImages } from "./assets";
import { useWorkspace } from "./useWorkspace";
import { usePreferences } from "./preferences";
import { Settings } from "./Settings";
import { Dialog } from "./Dialog";
import { headingLabel, headingTarget, usableLink } from "./links";
import { documentStats } from "./stats";
import type { UpdateStatus } from "./bridge";
import type { FolderNode } from "./bridge";
import {
  parseFrontMatter,
  updateDocumentMetadata,
  type EditableDocumentMetadata,
} from "./front-matter";

function metadataField(value: unknown) {
  if (Array.isArray(value)) return value.map(String).join(", ");
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

type QuickOpenItem = {
  key: string;
  name: string;
  path?: string;
  documentId?: string;
  location: string;
  recent: boolean;
};

function fuzzyScore(value: string, query: string) {
  const text = value.toLocaleLowerCase();
  const needle = query.toLocaleLowerCase().replace(/\s+/g, "");
  if (!needle) return 0;
  let cursor = 0,
    first = -1,
    gaps = 0;
  for (const character of needle) {
    const found = text.indexOf(character, cursor);
    if (found < 0) return Number.POSITIVE_INFINITY;
    if (first < 0) first = found;
    gaps += found - cursor;
    cursor = found + 1;
  }
  const compact = text.replace(/[\s_-]+/g, "");
  return first * 2 + gaps - (compact.startsWith(needle) ? 24 : 0);
}

function isQuickOpenDocument(name: string) {
  return /\.(?:md|markdown|txt)$/i.test(name);
}

function collectQuickOpenFiles(nodes: FolderNode[]): FolderNode[] {
  return nodes.flatMap((node) =>
    node.kind === "file" ? [node] : collectQuickOpenFiles(node.children || []),
  );
}

function Tool({
  label,
  children,
  onClick,
  active = false,
  disabled = false,
  menuButton = false,
  expanded,
}: {
  label: string;
  children: React.ReactNode;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
  disabled?: boolean;
  menuButton?: boolean;
  expanded?: boolean;
}) {
  return (
    <button
      className={"tool " + (active ? "active" : "")}
      title={label}
      aria-label={label}
      aria-haspopup={menuButton ? "menu" : undefined}
      aria-expanded={menuButton ? active : expanded}
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
  { kind: "heading1", label: "一级标题", shortcut: "⌘1" },
  { kind: "heading2", label: "二级标题", shortcut: "⌘2" },
  { kind: "heading3", label: "三级标题", shortcut: "⌘3" },
  { kind: "heading4", label: "四级标题", shortcut: "⌘4" },
  { kind: "heading5", label: "五级标题", shortcut: "⌘5" },
  { kind: "heading6", label: "六级标题", shortcut: "⌘6" },
  { kind: "paragraph", label: "正文", shortcut: "⌘0" },
  { kind: "quote", label: "引用", shortcut: "⌘⇧Q" },
  { kind: "bulletList", label: "无序列表", shortcut: "⌘⇧8" },
  { kind: "orderedList", label: "有序列表", shortcut: "⌘⇧7" },
  { kind: "task", label: "任务列表", shortcut: "⌘⇧L" },
  { kind: "footnote", label: "插入脚注" },
  { kind: "toc", label: "插入文档目录" },
  { kind: "table", label: "插入表格" },
  { kind: "link", label: "插入链接", shortcut: "⌘K" },
];
function shortcutLabel(shortcut: string) {
  if (/Mac|iPhone|iPad/.test(navigator.platform)) return shortcut;
  return shortcut.replaceAll("⌘", "Ctrl+").replaceAll("⇧", "Shift+");
}

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
  const [outlineQuery, setOutlineQuery] = useState("");
  const [collapsedOutline, setCollapsedOutline] = useState<Set<number>>(
    () => new Set(),
  );
  useEffect(() => {
    setOutlineQuery("");
    setCollapsedOutline(new Set());
  }, [current.id]);
  const outlineRows = useMemo(() => {
    const query = outlineQuery.trim().toLocaleLowerCase();
    const collapsedLevels: number[] = [];
    return documentHeadings.flatMap((heading, index) => {
      const identity = heading.from;
      while (
        collapsedLevels.length &&
        heading.level <= collapsedLevels[collapsedLevels.length - 1]
      ) {
        collapsedLevels.pop();
      }
      const hidden = !query && collapsedLevels.length > 0;
      const matches =
        !query || heading.title.toLocaleLowerCase().includes(query);
      const hasChildren =
        index + 1 < documentHeadings.length &&
        documentHeadings[index + 1].level > heading.level;
      const collapsed = collapsedOutline.has(identity);
      if (!query && hasChildren && collapsed)
        collapsedLevels.push(heading.level);
      return hidden || !matches
        ? []
        : [{ heading, hasChildren, collapsed, identity }];
    });
  }, [collapsedOutline, documentHeadings, outlineQuery]);
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
  const [menu, setMenu] = useState<"export" | "format" | "more" | null>(null);
  const menuElement = useRef<HTMLDivElement>(null);
  const menuOpener = useRef<HTMLElement | null>(null);
  const [settings, setSettings] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>(() =>
    window.desktop?.checkForUpdates
      ? { status: "idle" }
      : { status: "unsupported", message: "自动更新仅适用于桌面版。" },
  );
  const [pdfPreviewURL, setPdfPreviewURL] = useState<string | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const [tableDialog, setTableDialog] = useState<{
    rows: number;
    columns: number;
  } | null>(null);
  const [imageSizeDialog, setImageSizeDialog] = useState<{
    width: string;
    height: string;
  } | null>(null);
  const [bulkImageDialog, setBulkImageDialog] = useState<
    "copy" | "move" | null
  >(null);
  const [bulkImageDirectory, setBulkImageDirectory] = useState("_images");
  const [groupDialog, setGroupDialog] = useState<{
    mode: "new" | "rename";
    value: string;
    originalGroup?: string;
  } | null>(null);
  const [metadataDialog, setMetadataDialog] = useState<
    | ({
        documentId: string;
        originalText: string;
      } & EditableDocumentMetadata)
    | null
  >(null);
  const folderWorkspace = useFolder();
  const operateOnFolderFile = async (request: {
    action:
      | "new-file"
      | "new-folder"
      | "copy"
      | "rename"
      | "move"
      | "trash"
      | "undo"
      | "copy-path"
      | "reveal";
    target?: string;
    directory?: string;
    name?: string;
  }) => {
    const root = folderWorkspace.root;
    if (!root || !window.desktop) return;
    if (request.action === "copy-path" || request.action === "reveal") {
      if (!request.target) return;
      try {
        if (request.action === "copy-path") {
          await window.desktop.copyPath(request.target);
          setMessage("已复制路径。");
        } else await window.desktop.revealPath(request.target);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
      return;
    }
    const isWithinPath = (parent: string, child: string) => {
      const prefix =
        parent.endsWith("/") || parent.endsWith("\\")
          ? parent
          : parent + (parent.includes("\\") ? "\\" : "/");
      return child === parent || child.startsWith(prefix);
    };
    const opened = request.target
      ? workspace.docsRef.current.filter(
          (document) =>
            document.path && isWithinPath(request.target!, document.path),
        )
      : [];
    try {
      for (const document of opened) {
        if (document.dirty && !(await workspace.save(document)))
          throw Error("文档未能保存，文件操作已取消。");
      }
      const result = await window.desktop.fileOperation({
        action: request.action as
          | "new-file"
          | "new-folder"
          | "copy"
          | "rename"
          | "move"
          | "trash"
          | "undo",
        root,
        name: request.name,
        target: request.target,
        directory: request.directory,
        ...(request.action === "new-file" || request.action === "new-folder"
          ? { target: request.target || root }
          : {}),
      });
      if (!result) return;
      if (result.paths) {
        for (const mapping of result.paths) {
          const affected = workspace.docsRef.current.filter(
            (document) => document.path === mapping.from,
          );
          if (mapping.remove) {
            for (const document of affected) workspace.remove(document.id);
          } else if (mapping.to && mapping.version) {
            for (const document of affected) {
              workspace.updateDocumentPath(
                mapping.from,
                mapping.to,
                mapping.version,
              );
            }
          }
        }
      } else if (request.action === "rename" || request.action === "move") {
        if (request.target && result.version)
          workspace.updateDocumentPath(
            request.target,
            result.path,
            result.version,
          );
      } else if (request.action === "undo" && result.from && result.version) {
        workspace.updateDocumentPath(result.path, result.from, result.version);
      } else if (request.action === "trash") {
        for (const document of opened) workspace.remove(document.id);
      } else if (request.action === "undo") {
        for (const document of workspace.docsRef.current.filter(
          (item) => item.path === result.path,
        ))
          workspace.remove(document.id);
      } else if (
        (request.action === "copy" && result.kind !== "directory") ||
        request.action === "new-file"
      ) {
        const file = await window.desktop.reopen(result.path);
        workspace.importFile(file);
      }
      await folderWorkspace.refresh();
      setMessage(
        request.action === "undo"
          ? "已撤销上一次文件操作。"
          : request.action === "trash"
            ? "已移入系统废纸篓。"
            : "文件操作完成。",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickOpenQuery, setQuickOpenQuery] = useState("");
  const [quickOpenIndex, setQuickOpenIndex] = useState(0);
  const quickOpenInput = useRef<HTMLInputElement>(null);
  const quickOpenResultsRef = useRef<HTMLDivElement>(null);
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
  const quickOpenItems = useMemo(() => {
    const items = new Map<string, QuickOpenItem>();
    recent.forEach((file, index) => {
      if (!isQuickOpenDocument(file.name)) return;
      items.set(file.path, {
        key: file.path,
        name: file.name,
        path: file.path,
        location: `最近打开 · ${index + 1}`,
        recent: true,
      });
    });
    const root = folderWorkspace.root?.replace(/[\\/]+$/, "");
    const separator = folderWorkspace.root?.includes("\\") ? "\\" : "/";
    for (const file of collectQuickOpenFiles(tree?.entries || [])) {
      if (!isQuickOpenDocument(file.name)) continue;
      const existing = items.get(file.path);
      const location =
        root && file.path.startsWith(root + separator)
          ? file.path.slice(root.length + 1)
          : file.path;
      items.set(file.path, {
        key: file.path,
        name: file.name,
        path: file.path,
        location,
        recent: existing?.recent || false,
      });
    }
    docs.forEach((document) => {
      if (!isQuickOpenDocument(document.name)) return;
      const key = document.path || `document:${document.id}`;
      const existing = items.get(key);
      items.set(key, {
        key,
        name: document.name,
        path: document.path,
        documentId: document.id,
        location: document.path ? `已打开 · ${document.path}` : "当前窗口",
        recent: existing?.recent || false,
      });
    });
    return [...items.values()];
  }, [docs, folderWorkspace.root, recent, tree]);
  const quickOpenResults = useMemo(() => {
    const query = quickOpenQuery.trim();
    return quickOpenItems
      .map((item) => {
        if (!query)
          return {
            item,
            score: item.recent ? -1000 : item.documentId ? -500 : 0,
          };
        const nameScore = fuzzyScore(item.name, query);
        const pathScore = item.path
          ? fuzzyScore(item.path, query) + 12
          : Number.POSITIVE_INFINITY;
        const score = Math.min(nameScore, pathScore);
        return { item, score: score - (item.recent ? 20 : 0) };
      })
      .filter((entry) => Number.isFinite(entry.score))
      .sort(
        (a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name),
      )
      .slice(0, 50)
      .map((entry) => entry.item);
  }, [quickOpenItems, quickOpenQuery]);
  useEffect(() => {
    quickOpenResultsRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [quickOpenIndex, quickOpenResults]);
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
  const editImageSize = () => {
    const size = editor.current?.imageSize();
    if (!size) {
      setMessage("请先点击即时排版中的图片，再设置尺寸。");
      return;
    }
    setImageSizeDialog(size);
  };
  const downloadDocumentImages = async () => {
    const originalText = current.text;
    const documentId = current.id;
    const originalPath = current.path;
    try {
      const result = await downloadRemoteImages(originalText, originalPath);
      const latest = workspace.docsRef.current.find(
        (document) => document.id === documentId,
      );
      if (
        !latest ||
        latest.text !== originalText ||
        latest.path !== originalPath
      ) {
        setMessage(
          "下载期间文档内容已变化，未覆盖编辑；请重新下载并更新图片引用。",
        );
        return;
      }
      if (result.text !== originalText) workspace.edit(documentId, result.text);
      setMessage(
        result.found === 0
          ? "文档中没有 HTTPS 远程图片。"
          : `远程图片：成功下载 ${result.downloaded} 张，失败 ${result.failed} 张。`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };
  const manageDocumentImages = async (
    mode: "copy" | "move",
    targetDirectory: string,
  ) => {
    const originalText = current.text;
    const documentId = current.id;
    const originalPath = current.path;
    try {
      const result = await manageLocalImages(
        originalText,
        originalPath,
        targetDirectory.trim(),
        mode,
      );
      const latest = workspace.docsRef.current.find(
        (document) => document.id === documentId,
      );
      if (
        !latest ||
        latest.text !== originalText ||
        latest.path !== originalPath
      ) {
        if (mode === "move" && window.desktop?.manageImage) {
          for (const operation of [...result.operations].reverse())
            await window.desktop.manageImage({
              documentPath: originalPath!,
              sourcePath: operation.targetPath,
              targetPath: operation.sourcePath,
              mode: "move",
            });
        }
        setMessage("操作期间文档内容已变化，图片移动已撤销；请重试。");
        return;
      }
      if (result.text !== originalText) workspace.edit(documentId, result.text);
      setMessage(
        `本地图片：成功${mode === "move" ? "移动" : "复制"} ${result.managed} 张，失败 ${result.failed} 张。`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };
  const openBulkImageManager = (mode: "copy" | "move") => {
    setMenu(null);
    setBulkImageDirectory("_images");
    setBulkImageDialog(mode);
  };
  const saveGroupDialog = () => {
    if (!groupDialog) return;
    const normalized = groupDialog.value.trim().slice(0, 32);
    if (!normalized) return;
    if (groupDialog.mode === "new") {
      workspace.setDocumentGroup(current.id, normalized);
      setTabGroup(normalized);
    } else if (groupDialog.originalGroup) {
      docs
        .filter((document) => document.group === groupDialog.originalGroup)
        .forEach((document) =>
          workspace.setDocumentGroup(document.id, normalized),
        );
      if (tabGroup === groupDialog.originalGroup) setTabGroup(normalized);
    }
    setGroupDialog(null);
  };
  const openMetadataDialog = () => {
    const metadata = parseFrontMatter(current.text)?.metadata;
    setMetadataDialog({
      documentId: current.id,
      originalText: current.text,
      title: metadataField(metadata?.title),
      author: metadataField(metadata?.author),
      description: metadataField(metadata?.description),
      keywords: metadataField(metadata?.keywords ?? metadata?.tags),
      subject: metadataField(metadata?.subject),
      creator: metadataField(metadata?.creator),
    });
  };
  const saveMetadataDialog = () => {
    if (!metadataDialog) return;
    const latest = workspace.docsRef.current.find(
      (document) => document.id === metadataDialog.documentId,
    );
    if (!latest || latest.text !== metadataDialog.originalText) {
      setMessage("文档在编辑属性期间已变化；请重新打开文档属性后重试。");
      setMetadataDialog(null);
      return;
    }
    try {
      const { documentId, originalText, ...metadata } = metadataDialog;
      const updated = updateDocumentMetadata(originalText, metadata);
      if (updated !== originalText) workspace.edit(documentId, updated);
      setMetadataDialog(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };
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
    const items = () =>
      Array.from(
        menuElement.current?.querySelectorAll<HTMLElement>(
          '[role="menuitem"]:not([disabled])',
        ) || [],
      );
    items()[0]?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!toolbar.current?.contains(event.target as Node)) setMenu(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenu(null);
        menuOpener.current?.focus();
      }
    };
    const navigate = (event: KeyboardEvent) => {
      const menuItems = items();
      if (
        !menuItems.length ||
        !menuElement.current?.contains(event.target as Node)
      )
        return;
      const currentIndex = menuItems.indexOf(
        document.activeElement as HTMLElement,
      );
      let nextIndex: number | undefined;
      if (event.key === "ArrowDown")
        nextIndex = (currentIndex + 1) % menuItems.length;
      if (event.key === "ArrowUp")
        nextIndex = (currentIndex - 1 + menuItems.length) % menuItems.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = menuItems.length - 1;
      if (nextIndex !== undefined) {
        event.preventDefault();
        menuItems[nextIndex]?.focus();
      } else if (event.key === "Tab") {
        setMenu(null);
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    document.addEventListener("keydown", navigate);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
      document.removeEventListener("keydown", navigate);
    };
  }, [menu]);

  const toggleMenu = (
    next: "export" | "format" | "more",
    opener: HTMLElement,
  ) => {
    menuOpener.current = opener;
    setMenu((value) => (value === next ? null : next));
  };

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
  const importDocument = async () => {
    if (!window.desktop?.importDocument) {
      setMessage(
        "文档格式导入需要桌面版和 Pandoc；浏览器版可直接打开 Markdown/TXT。",
      );
      return;
    }
    try {
      const file = await window.desktop.importDocument();
      if (file) {
        workspace.importFile(file);
        setMessage("文档已导入为未保存的 Markdown 副本；保存时选择目标文件。");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
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
  const performExport = async (
    format:
      | "md"
      | "html"
      | "html-plain"
      | "pdf"
      | "docx"
      | "rtf"
      | "epub"
      | "odt"
      | "latex"
      | "mediawiki",
  ) => {
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
      let html = await exportHTML(
        document.text,
        document.name,
        document.path,
        preferences.customCSS,
        preferences.theme,
        (format === "html" || format === "html-plain") &&
          preferences.htmlOutline,
      );
      if (format === "html-plain") html = withoutHTMLStyles(html);
      if (window.desktop) {
        if (
          await window.desktop.export({
            html,
            name: document.name,
            format: format === "html-plain" ? "html" : format,
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
      } else if (format === "html" || format === "html-plain")
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
      } else if (format === "docx")
        setMessage("Word 导出请使用 Moxie 桌面版。");
      else setMessage("更多格式导出请使用桌面版并安装 Pandoc。");
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
  const exportLongImage = async () => {
    setMenu(null);
    editor.current?.flush();
    const document =
      workspace.docsRef.current.find((item) => item.id === current.id) ||
      current;
    if (!window.desktop?.exportImage) {
      setMessage("长图导出目前需要桌面版。");
      return;
    }
    try {
      const html = await exportHTML(
        document.text,
        document.name,
        document.path,
        preferences.customCSS,
        preferences.theme,
      );
      const saved = await window.desktop.exportImage({
        html,
        name: document.name,
      });
      if (saved) setMessage(`长图已导出：${saved}`);
    } catch (error) {
      setMessage(
        `长图导出失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  const copySelectionAsHTML = async (code = false) => {
    const selected = editor.current?.selection() || "";
    if (!selected) {
      setMessage("请先选中要复制为 HTML 的内容。");
      return;
    }
    try {
      const htmlDocument = await exportHTML(
        selected,
        current.name,
        current.path,
        preferences.customCSS,
        preferences.theme,
      );
      const parsed = new DOMParser().parseFromString(htmlDocument, "text/html");
      const styles = Array.from(parsed.head.querySelectorAll("style"))
        .map((style) => style.outerHTML)
        .join("");
      const html = `${styles}<div>${parsed.body.innerHTML}</div>`;
      if (code) {
        const fragment = parsed.body.innerHTML;
        if (window.desktop)
          await window.desktop.copyRichText({ html: "", text: fragment });
        else await navigator.clipboard.writeText(fragment);
        setMessage("已复制 HTML 代码。");
        return;
      }
      if (window.desktop) {
        await window.desktop.copyRichText({ html, text: selected });
      } else {
        const item = new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([selected], { type: "text/plain" }),
        });
        await navigator.clipboard.write([item]);
      }
      setMessage("已复制为 HTML，可粘贴到支持富文本的应用。");
    } catch (error) {
      setMessage(
        `复制为 HTML 失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  const copyMarkdownSelectionAsRichText = async (selected: string) => {
    const htmlPromise = exportHTML(
      selected,
      current.name,
      current.path,
      preferences.customCSS,
      preferences.theme,
    ).then((document) => {
      const parsed = new DOMParser().parseFromString(document, "text/html");
      const styles = Array.from(parsed.head.querySelectorAll("style"))
        .map((style) => style.outerHTML)
        .join("");
      return `${styles}<div>${parsed.body.innerHTML}</div>`;
    });
    try {
      if (window.desktop) {
        const html = await htmlPromise;
        await window.desktop.copyRichText({ html, text: selected });
      } else {
        const htmlBlob = htmlPromise.then(
          (html) => new Blob([html], { type: "text/html" }),
        );
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": htmlBlob,
            "text/plain": new Blob([selected], { type: "text/plain" }),
          }),
        ]);
      }
    } catch (error) {
      try {
        if (window.desktop)
          await window.desktop.copyRichText({ html: "", text: selected });
        else await navigator.clipboard.writeText(selected);
        setMessage("富文本复制不可用，已复制 Markdown 源码。");
      } catch {
        setMessage(
          `复制失败：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  };
  const showQuickOpen = () => {
    setMenu(null);
    setQuickOpenQuery("");
    setQuickOpenIndex(0);
    setQuickOpen(true);
    requestAnimationFrame(() => quickOpenInput.current?.focus());
  };
  const openQuickOpenItem = async (item: QuickOpenItem) => {
    setQuickOpen(false);
    if (item.documentId) workspace.setActive(item.documentId);
    else if (item.path) await reopen(item.path);
  };
  const handleAction = (action: string) => {
    if (action.startsWith("format-")) {
      const kind = action.slice(7) as Format;
      if (kind === "table") setTableDialog({ rows: 3, columns: 2 });
      else editor.current?.format(kind);
      return;
    }
    if (action === "undo") editor.current?.undo();
    if (action === "redo") editor.current?.redo();
    if (action === "new") workspace.add();
    if (action === "open") void open();
    if (action === "import") void importDocument();
    if (action === "folder") void folder();
    if (action === "save") {
      saveCurrent();
    }
    if (action === "saveAs") {
      saveCurrent(true);
    }
    if (action === "source") setSource((value) => !value);
    if (action === "find") editor.current?.find();
    if (action === "copy-as-html") void copySelectionAsHTML();
    if (action === "copy-as-html-code") void copySelectionAsHTML(true);
    if (action === "quick-open") showQuickOpen();
    if (action === "export")
      setMenu((value) => (value === "export" ? null : "export"));
    if (action === "settings") setSettings(true);
    if (action === "focus") setFocus((value) => !value);
    if (action === "image") imageUpload.current?.click();
    if (action === "download-remote-images") void downloadDocumentImages();
    if (action === "copy-local-images") openBulkImageManager("copy");
    if (action === "move-local-images") openBulkImageManager("move");
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
      const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
      if (
        (isMac && event.shiftKey && event.code === "KeyO") ||
        (!isMac && !event.shiftKey && event.key.toLowerCase() === "p")
      ) {
        event.preventDefault();
        actionRef.current("quick-open");
        return;
      }
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
  const [selectionText, setSelectionText] = useState("");
  const selectionStats = useMemo(
    () => (selectionText ? documentStats(selectionText) : null),
    [selectionText],
  );
  const displayedStats = selectionStats || stats;
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
        const { from: start, to: end } = lineBoundsAt(text, index);
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
            {tab === "outline" && (
              <div className="outline-search-wrap">
                <Search size={15} aria-hidden="true" />
                <input
                  aria-label="搜索大纲标题"
                  className="outline-search"
                  type="search"
                  placeholder="搜索标题"
                  value={outlineQuery}
                  onChange={(event) => setOutlineQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape" && outlineQuery) {
                      event.preventDefault();
                      setOutlineQuery("");
                    }
                  }}
                />
              </div>
            )}
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
              : outlineRows.map(
                  ({ heading, hasChildren, collapsed, identity }) => (
                    <div
                      className="outline-entry"
                      key={heading.from}
                      style={{ paddingLeft: 6 + (heading.level - 1) * 12 }}
                    >
                      {hasChildren ? (
                        <button
                          className="outline-toggle"
                          aria-label={`${collapsed ? "展开" : "折叠"} ${heading.title}`}
                          aria-expanded={!collapsed}
                          title={`${collapsed ? "展开" : "折叠"}子标题`}
                          onClick={() =>
                            setCollapsedOutline((previous) => {
                              const next = new Set(previous);
                              if (next.has(identity)) next.delete(identity);
                              else next.add(identity);
                              return next;
                            })
                          }
                        >
                          {collapsed ? (
                            <ChevronRight size={14} aria-hidden="true" />
                          ) : (
                            <ChevronDown size={14} aria-hidden="true" />
                          )}
                        </button>
                      ) : (
                        <span
                          className="outline-toggle-spacer"
                          aria-hidden="true"
                        />
                      )}
                      <button
                        className={
                          "outline-row " +
                          (heading.from === activeHeading?.from ? "active" : "")
                        }
                        aria-current={
                          heading.from === activeHeading?.from
                            ? "location"
                            : undefined
                        }
                        onClick={() => editor.current?.go(heading.from)}
                      >
                        {heading.title}
                      </button>
                    </div>
                  ),
                )}
            {tab === "outline" && outlineRows.length === 0 && (
              <p className="outline-empty" role="status">
                {documentHeadings.length === 0
                  ? "当前文档没有标题"
                  : "没有匹配的标题"}
              </p>
            )}
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
                operate={operateOnFolderFile}
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
            <button onClick={() => void importDocument()}>
              <FileText size={17} />
              导入文档…
            </button>
            <button onClick={() => void folder()}>
              <FolderOpen size={18} />
              打开文件夹
            </button>
          </div>
        </aside>
      )}
      {visibleSidebar && (
        <button
          className="sidebar-backdrop"
          aria-label="关闭侧栏"
          tabIndex={-1}
          onClick={() => setSidebar(false)}
        />
      )}
      <main className="workspace">
        <header ref={toolbar} className="toolbar">
          <div className="document-title">
            <Tool
              label="切换侧栏"
              expanded={visibleSidebar}
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
              menuButton
              onClick={(event) => toggleMenu("format", event.currentTarget)}
            >
              <Type size={18} />
            </Tool>
            <Tool label="插入图片" onClick={() => imageUpload.current?.click()}>
              <ImagePlus size={18} />
            </Tool>
            <Tool label="设置图片尺寸" onClick={editImageSize}>
              <Scaling size={18} />
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
            <Tool label="快速打开" onClick={showQuickOpen}>
              <FileText size={18} />
            </Tool>
            <button
              className="tool mobile-more"
              aria-label="更多工具"
              aria-expanded={menu === "more"}
              onClick={(event) => toggleMenu("more", event.currentTarget)}
            >
              <MoreHorizontal size={19} />
            </button>
            <button
              className="export-button"
              aria-label="导出"
              aria-expanded={menu === "export"}
              aria-haspopup="menu"
              onClick={(event) => toggleMenu("export", event.currentTarget)}
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
            <div className="export-menu" role="menu" ref={menuElement}>
              <button
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  openMetadataDialog();
                }}
              >
                <FileText size={17} />
                文档属性…
              </button>
              <hr />
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
              <button
                role="menuitem"
                onClick={() => void performExport("html-plain")}
              >
                <Code size={17} />
                HTML 网页（不带样式）
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
                <button role="menuitem" onClick={() => void exportLongImage()}>
                  <ImagePlus size={17} />
                  导出整篇长图（SVG）
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
              {window.desktop && (
                <>
                  <hr />
                  <button
                    role="menuitem"
                    onClick={() => void performExport("rtf")}
                  >
                    <FileText size={17} />
                    RTF 文档（需 Pandoc）
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => void performExport("epub")}
                  >
                    <FileText size={17} />
                    EPUB 电子书（需 Pandoc）
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => void performExport("odt")}
                  >
                    <FileText size={17} />
                    OpenDocument 文档（需 Pandoc）
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => void performExport("latex")}
                  >
                    <FileText size={17} />
                    LaTeX 文档（需 Pandoc）
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => void performExport("mediawiki")}
                  >
                    <FileText size={17} />
                    MediaWiki 文本（需 Pandoc）
                  </button>
                </>
              )}
              {window.desktop && (
                <>
                  <button
                    role="menuitem"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      openBulkImageManager("copy");
                    }}
                  >
                    <Copy size={17} />
                    复制本地图片到文件夹…
                  </button>
                  <button
                    role="menuitem"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      openBulkImageManager("move");
                    }}
                  >
                    <FolderInput size={17} />
                    移动本地图片到文件夹…
                  </button>
                </>
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
            <div
              className="export-menu format-menu"
              role="menu"
              ref={menuElement}
            >
              {formats.map((format) => (
                <button
                  role="menuitem"
                  key={format.kind}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setMenu(null);
                    if (format.kind === "table")
                      setTableDialog({ rows: 3, columns: 2 });
                    else editor.current?.format(format.kind);
                  }}
                >
                  <span>{format.label}</span>
                  {format.shortcut && (
                    <kbd>{shortcutLabel(format.shortcut)}</kbd>
                  )}
                </button>
              ))}
              <button
                role="menuitem"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setMenu(null);
                  void copySelectionAsHTML();
                }}
              >
                <Copy size={17} />
                复制选区为 HTML
              </button>
              <button
                role="menuitem"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setMenu(null);
                  void copySelectionAsHTML(true);
                }}
              >
                <Code size={17} />
                复制选区为 HTML 代码
              </button>
              {window.desktop && (
                <button
                  role="menuitem"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setMenu(null);
                    void downloadDocumentImages();
                  }}
                >
                  <Download size={17} />
                  下载文档中的远程图片
                </button>
              )}
            </div>
          )}
          {menu === "more" && (
            <div
              className="export-menu mobile-more-menu"
              role="group"
              aria-label="更多工具"
            >
              <button onClick={() => setMenu("format")}>
                <Type size={17} /> 格式
              </button>
              <button
                onClick={() => {
                  editor.current?.find();
                  setMenu(null);
                }}
              >
                <Search size={17} /> 查找与替换
              </button>
              <button
                onClick={() => {
                  editImageSize();
                  setMenu(null);
                }}
              >
                <Scaling size={17} /> 设置图片尺寸
              </button>
              <button
                onClick={() => {
                  setWorkspaceSearch((open) => !open);
                  setMenu(null);
                }}
              >
                <FolderSearch2 size={17} /> 搜索项目文件夹
              </button>
              <button
                onClick={() => {
                  setFocus((value) => !value);
                  setMenu(null);
                }}
              >
                <Maximize2 size={17} /> 专注模式
              </button>
              <button
                onClick={() => {
                  update("theme", darkTheme ? "light" : "dark");
                  setMenu(null);
                }}
              >
                {darkTheme ? <Moon size={17} /> : <Sun size={17} />}
                {darkTheme ? "切换浅色主题" : "切换深色主题"}
              </button>
              <button
                onClick={() => {
                  setSettings(true);
                  setMenu(null);
                }}
              >
                <SettingsIcon size={17} /> 偏好设置
              </button>
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
                      aria-label="搜索结果排序"
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
                      setGroupDialog({
                        mode: "rename",
                        value: group,
                        originalGroup: group,
                      });
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
                  setGroupDialog({ mode: "new", value: "" });
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
            smartQuotes={preferences.smartQuotes}
            smartDashes={preferences.smartDashes}
            spellCheck={preferences.spellCheck}
            copyFormat={preferences.copyFormat}
            onCopyRichText={copyMarkdownSelectionAsRichText}
            theme={darkTheme ? "dark" : "light"}
            onChange={(text) => workspace.edit(current.id, text)}
            onMapPositions={(mapPosition) =>
              setCollapsedOutline((previous) =>
                previous.size
                  ? new Set(Array.from(previous, mapPosition))
                  : previous,
              )
            }
            onDirty={() => workspace.markDirty(current.id)}
            onCursorChange={(position, line, column, selection) => {
              setCursor({ position, line, column });
              setSelectionText(selection);
            }}
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
              {selectionStats ? "选中 " : ""}
              {displayedStats.charactersWithoutSpaces.toLocaleString()} 字符
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
        accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,image/avif,image/svg+xml"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          event.target.value = "";
          void editor.current?.images(files);
        }}
      />
      {message && (
        <div className="toast" role="status" aria-atomic="true">
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
      {tableDialog && (
        <Dialog title="插入表格" onClose={() => setTableDialog(null)}>
          <header>
            <h2>插入表格</h2>
            <Tool label="关闭表格设置" onClick={() => setTableDialog(null)}>
              <X size={18} />
            </Tool>
          </header>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              editor.current?.format("table", tableDialog);
              setTableDialog(null);
            }}
          >
            <label>
              行数（含表头）
              <select
                aria-label="表格行数"
                value={tableDialog.rows}
                onChange={(event) =>
                  setTableDialog((size) =>
                    size ? { ...size, rows: Number(event.target.value) } : size,
                  )
                }
              >
                {Array.from({ length: 19 }, (_, index) => index + 2).map(
                  (rows) => (
                    <option key={rows} value={rows}>
                      {rows}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label>
              列数
              <select
                aria-label="表格列数"
                value={tableDialog.columns}
                onChange={(event) =>
                  setTableDialog((size) =>
                    size
                      ? { ...size, columns: Number(event.target.value) }
                      : size,
                  )
                }
              >
                {Array.from({ length: 12 }, (_, index) => index + 1).map(
                  (columns) => (
                    <option key={columns} value={columns}>
                      {columns}
                    </option>
                  ),
                )}
              </select>
            </label>
            <p role="status" aria-live="polite">
              将插入 {tableDialog.rows} 行 × {tableDialog.columns}{" "}
              列的表格，首行为表头。
            </p>
            <div className="dialog-actions">
              <button type="button" onClick={() => setTableDialog(null)}>
                取消
              </button>
              <button className="primary-button" type="submit">
                插入表格
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {imageSizeDialog && (
        <Dialog title="设置图片尺寸" onClose={() => setImageSizeDialog(null)}>
          <header>
            <h2>设置图片尺寸</h2>
            <Tool
              label="关闭图片尺寸设置"
              onClick={() => setImageSizeDialog(null)}
            >
              <X size={18} />
            </Tool>
          </header>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (
                editor.current?.setImageSize(
                  imageSizeDialog.width,
                  imageSizeDialog.height,
                )
              )
                setImageSizeDialog(null);
              else setMessage("尺寸需为 1–4096 的整数像素。");
            }}
          >
            <label>
              宽度（像素）
              <input
                type="number"
                min="1"
                max="4096"
                step="1"
                value={imageSizeDialog.width}
                onChange={(event) =>
                  setImageSizeDialog((size) =>
                    size ? { ...size, width: event.target.value } : size,
                  )
                }
                aria-label="图片宽度（像素）"
              />
            </label>
            <label>
              高度（像素）
              <input
                type="number"
                min="1"
                max="4096"
                step="1"
                value={imageSizeDialog.height}
                onChange={(event) =>
                  setImageSizeDialog((size) =>
                    size ? { ...size, height: event.target.value } : size,
                  )
                }
                aria-label="图片高度（像素）"
              />
            </label>
            <p>
              留空一个数值可按图片原始比例自动计算；宽高都留空可移除固定尺寸。
            </p>
            <div className="dialog-actions">
              <button type="button" onClick={() => setImageSizeDialog(null)}>
                取消
              </button>
              <button className="primary-button" type="submit">
                应用
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {metadataDialog && (
        <Dialog title="文档属性" onClose={() => setMetadataDialog(null)}>
          <header>
            <h2>文档属性</h2>
            <Tool label="关闭文档属性" onClick={() => setMetadataDialog(null)}>
              <X size={18} />
            </Tool>
          </header>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              saveMetadataDialog();
            }}
          >
            <label>
              标题
              <input
                autoFocus
                value={metadataDialog.title}
                onChange={(event) =>
                  setMetadataDialog((value) =>
                    value ? { ...value, title: event.target.value } : value,
                  )
                }
                aria-label="文档标题"
                placeholder={current.name}
              />
            </label>
            <label>
              作者
              <input
                value={metadataDialog.author}
                onChange={(event) =>
                  setMetadataDialog((value) =>
                    value ? { ...value, author: event.target.value } : value,
                  )
                }
                aria-label="文档作者"
              />
            </label>
            <label>
              描述
              <textarea
                value={metadataDialog.description}
                onChange={(event) =>
                  setMetadataDialog((value) =>
                    value
                      ? { ...value, description: event.target.value }
                      : value,
                  )
                }
                aria-label="文档描述"
                rows={3}
              />
            </label>
            <label>
              关键词
              <input
                value={metadataDialog.keywords}
                onChange={(event) =>
                  setMetadataDialog((value) =>
                    value ? { ...value, keywords: event.target.value } : value,
                  )
                }
                aria-label="文档关键词"
                placeholder="多个关键词用逗号分隔"
              />
            </label>
            <label>
              主题
              <input
                value={metadataDialog.subject}
                onChange={(event) =>
                  setMetadataDialog((value) =>
                    value ? { ...value, subject: event.target.value } : value,
                  )
                }
                aria-label="文档主题"
              />
            </label>
            <label>
              创建者
              <input
                value={metadataDialog.creator}
                onChange={(event) =>
                  setMetadataDialog((value) =>
                    value ? { ...value, creator: event.target.value } : value,
                  )
                }
                aria-label="文档创建者"
              />
            </label>
            <p>属性会写入文档顶部的 YAML；其他字段、注释和正文会保留。</p>
            <div className="dialog-actions">
              <button type="button" onClick={() => setMetadataDialog(null)}>
                取消
              </button>
              <button className="primary-button" type="submit">
                保存属性
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {bulkImageDialog && (
        <Dialog
          title={bulkImageDialog === "copy" ? "复制本地图片" : "移动本地图片"}
          onClose={() => setBulkImageDialog(null)}
        >
          <header>
            <h2>
              {bulkImageDialog === "copy" ? "复制本地图片" : "移动本地图片"}
            </h2>
            <Tool label="关闭图片管理" onClick={() => setBulkImageDialog(null)}>
              <X size={18} />
            </Tool>
          </header>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const target = bulkImageDirectory.trim();
              if (!target) return;
              const mode = bulkImageDialog;
              setBulkImageDialog(null);
              void manageDocumentImages(mode, target);
            }}
          >
            <label>
              目标相对文件夹
              <input
                autoFocus
                required
                value={bulkImageDirectory}
                onChange={(event) => setBulkImageDirectory(event.target.value)}
                aria-label="图片目标相对文件夹"
                placeholder="_images"
              />
            </label>
            <p>
              路径相对于文档所在文件夹；目标中已有同名图片时会自动生成不冲突的文件名。
            </p>
            <div className="dialog-actions">
              <button type="button" onClick={() => setBulkImageDialog(null)}>
                取消
              </button>
              <button className="primary-button" type="submit">
                {bulkImageDialog === "copy" ? "复制图片" : "移动图片"}
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {groupDialog && (
        <Dialog
          title={groupDialog.mode === "new" ? "新建分组" : "重命名分组"}
          onClose={() => setGroupDialog(null)}
        >
          <header>
            <h2>{groupDialog.mode === "new" ? "新建分组" : "重命名分组"}</h2>
            <Tool label="关闭分组设置" onClick={() => setGroupDialog(null)}>
              <X size={18} />
            </Tool>
          </header>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!groupDialog.value.trim()) {
                setMessage("分组名称不能只包含空格。");
                return;
              }
              saveGroupDialog();
            }}
          >
            <label>
              分组名称
              <input
                autoFocus
                required
                maxLength={32}
                value={groupDialog.value}
                onChange={(event) =>
                  setGroupDialog((dialog) =>
                    dialog ? { ...dialog, value: event.target.value } : dialog,
                  )
                }
                aria-label="分组名称"
              />
            </label>
            <p>
              {groupDialog.mode === "new"
                ? "新分组会应用于当前文档。"
                : "重命名会同步更新此分组中的所有文档。"}
            </p>
            <div className="dialog-actions">
              <button type="button" onClick={() => setGroupDialog(null)}>
                取消
              </button>
              <button className="primary-button" type="submit">
                {groupDialog.mode === "new" ? "创建分组" : "保存名称"}
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {quickOpen && (
        <Dialog title="快速打开" onClose={() => setQuickOpen(false)}>
          <div className="quick-open-dialog">
            <header>
              <h2>快速打开</h2>
              <Tool label="关闭快速打开" onClick={() => setQuickOpen(false)}>
                <X size={18} />
              </Tool>
            </header>
            <input
              ref={quickOpenInput}
              autoFocus
              className="quick-open-input"
              aria-label="搜索文件名"
              aria-controls="quick-open-results"
              aria-activedescendant={
                quickOpenResults.length
                  ? `quick-open-option-${quickOpenIndex}`
                  : undefined
              }
              placeholder="搜索当前文件夹、最近文件和已打开文档"
              value={quickOpenQuery}
              onChange={(event) => {
                setQuickOpenQuery(event.target.value);
                setQuickOpenIndex(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" && quickOpenResults.length) {
                  event.preventDefault();
                  setQuickOpenIndex(
                    (index) => (index + 1) % quickOpenResults.length,
                  );
                } else if (event.key === "ArrowUp" && quickOpenResults.length) {
                  event.preventDefault();
                  setQuickOpenIndex(
                    (index) =>
                      (index - 1 + quickOpenResults.length) %
                      quickOpenResults.length,
                  );
                } else if (event.key === "Enter" && quickOpenResults.length) {
                  event.preventDefault();
                  void openQuickOpenItem(
                    quickOpenResults[
                      Math.min(quickOpenIndex, quickOpenResults.length - 1)
                    ],
                  );
                }
              }}
            />
            <div
              ref={quickOpenResultsRef}
              id="quick-open-results"
              className="quick-open-results"
              role="listbox"
              aria-label="匹配的文档"
            >
              {quickOpenResults.map((item, index) => (
                <button
                  id={`quick-open-option-${index}`}
                  key={item.key}
                  role="option"
                  aria-selected={index === quickOpenIndex}
                  className={index === quickOpenIndex ? "selected" : ""}
                  onMouseEnter={() => setQuickOpenIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => void openQuickOpenItem(item)}
                >
                  <FileText size={17} />
                  <span>
                    <strong>{item.name}</strong>
                    <small title={item.location}>{item.location}</small>
                  </span>
                </button>
              ))}
              {!quickOpenResults.length && (
                <p role="status">
                  {quickOpenItems.length
                    ? "没有匹配的文档。"
                    : "打开文件夹或文档后，可在此快速切换。"}
                </p>
              )}
            </div>
            <footer>
              <span>↑↓ 选择</span>
              <span>Enter 打开</span>
              <span>Esc 关闭</span>
            </footer>
          </div>
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
          <p>
            {selectionStats ? "当前选区" : "整篇文档"} · 全文{" "}
            {stats.charactersWithoutSpaces.toLocaleString()} 字符
          </p>
          <div className="document-stats">
            <div>
              <span>字数</span>
              <strong>{displayedStats.words.toLocaleString()}</strong>
            </div>
            <div>
              <span>字符（不含空格）</span>
              <strong>
                {displayedStats.charactersWithoutSpaces.toLocaleString()}
              </strong>
            </div>
            <div>
              <span>字符（含空格）</span>
              <strong>{displayedStats.characters.toLocaleString()}</strong>
            </div>
            <div>
              <span>行数</span>
              <strong>{displayedStats.lines.toLocaleString()}</strong>
            </div>
            <div>
              <span>段落</span>
              <strong>{displayedStats.paragraphs.toLocaleString()}</strong>
            </div>
            <div>
              <span>预计阅读</span>
              <strong>{displayedStats.readingMinutes} 分钟</strong>
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
