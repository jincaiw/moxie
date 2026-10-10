export type FolderNode = {
  path: string;
  name: string;
  kind: "directory" | "file" | "other";
  modified?: number;
  created?: number;
  children?: FolderNode[];
};
export type FolderTree = {
  path: string;
  name: string;
  entries: FolderNode[];
  truncated: boolean;
  version?: string;
};
export type RecentFolder = { path: string; name: string; pinned: boolean };
export type FileChange = {
  version: string;
  path: string;
  text?: string;
  status: "changed" | "missing" | "unavailable";
};
export type DiskFile = {
  path: string;
  name: string;
  text: string;
  version?: string;
};
export type DroppedCopyProgress = {
  id: string;
  phase: "checking" | "copying" | "cleanup" | "finishing";
  completed: number;
  total?: number;
  name?: string;
};
export type SaveInput = {
  path?: string;
  text: string;
  name: string;
  expected?: string;
  saveAs?: boolean;
  automatic?: boolean;
};
export type UpdateStatus = {
  status:
    | "idle"
    | "checking"
    | "available"
    | "not-available"
    | "downloading"
    | "downloaded"
    | "error"
    | "unsupported";
  version?: string;
  percent?: number;
  message?: string;
};
declare global {
  interface Window {
    desktop?: {
      makeFileLink?: (
        documentPath: string,
        target: string,
        label?: string,
      ) => Promise<string>;
      dragFileOut?: (target: string) => Promise<boolean>;
      cancelDroppedCopy?: (id: string) => Promise<boolean>;
      onDroppedCopyProgress?: (
        fn: (progress: DroppedCopyProgress) => void,
      ) => () => void;
      copyDroppedFiles?: (
        root: string,
        directory: string,
        files: File[],
        options?: FolderDisplayOptions,
        id?: string,
      ) => Promise<{
        paths: string[];
        warning?: string;
        cancelled?: boolean;
      } | null>;
      open: () => Promise<DiskFile | null>;
      importDocument: () => Promise<{ name: string; text: string } | null>;
      folder: (options?: FolderDisplayOptions) => Promise<FolderTree | null>;
      setStartupFolder?: (root: string) => Promise<void>;
      recentFolders?: () => Promise<RecentFolder[]>;
      updateFolderHistory?: (input: {
        action: "pin" | "unpin" | "remove" | "clear";
        path?: string;
      }) => Promise<RecentFolder[]>;
      reopenFolder?: (
        path: string,
        options?: FolderDisplayOptions,
      ) => Promise<FolderTree>;
      refreshFolder: (
        root: string,
        version?: string,
        options?: FolderDisplayOptions,
      ) => Promise<FolderTree | null>;
      fileOperation: (input: {
        action:
          | "new-file"
          | "new-folder"
          | "copy"
          | "rename"
          | "move"
          | "trash"
          | "undo";
        root: string;
        target?: string;
        directory?: string;
        name?: string;
      }) => Promise<{
        action: string;
        path: string;
        from?: string;
        version?: string;
        kind?: "file" | "directory";
        undid?: string;
        paths?: {
          from: string;
          to?: string;
          version?: string;
          remove?: boolean;
        }[];
      } | null>;
      copyPath: (path: string) => Promise<boolean>;
      revealPath: (path: string) => Promise<boolean>;
      openInNewWindow?: (path: string) => Promise<boolean>;
      initialFile?: () => Promise<DiskFile | null>;
      searchFolder: (
        root: string,
        query: string,
        options?: FolderDisplayOptions,
      ) => Promise<{
        results: {
          path: string;
          name: string;
          from: number;
          excerpt: string;
        }[];
        scanned: number;
        skipped: number;
        truncated: boolean;
      }>;
      openLink: (input: {
        href: string;
        documentPath?: string;
        create?: boolean;
      }) => Promise<{
        file?: DiskFile;
        anchor?: string;
        missing?: string;
        folder?: string;
        reveal?: string;
      }>;
      inspect: (
        files: { path: string; version?: string }[],
      ) => Promise<FileChange[]>;
      recent: () => Promise<{ path: string; name: string }[]>;
      reopen: (path: string) => Promise<DiskFile>;
      save: (input: SaveInput) => Promise<DiskFile | null>;
      storeImage: (input: {
        documentPath: string;
        bytes: Uint8Array;
        targetDirectory?: string;
      }) => Promise<{ relativePath: string }>;
      readImage: (input: {
        documentPath: string;
        relativePath: string;
      }) => Promise<string>;
      manageImage: (input: {
        documentPath: string;
        sourcePath: string;
        targetPath: string;
        mode: "copy" | "move";
        avoidCollision?: boolean;
      }) => Promise<{ relativePath: string }>;
      downloadRemoteImage: (input: {
        documentPath: string;
        url: string;
        targetDirectory?: string;
      }) => Promise<{ relativePath: string }>;
      previewPDF: (input: {
        html: string;
        pdf: {
          pageSize: "A4" | "Letter" | "Legal";
          landscape: boolean;
          margin: number;
          headerFooter: boolean;
        };
      }) => Promise<Uint8Array>;
      export: (input: {
        html: string;
        name: string;
        format:
          | "html"
          | "pdf"
          | "docx"
          | "rtf"
          | "epub"
          | "odt"
          | "latex"
          | "mediawiki";
        pdf?: {
          pageSize: "A4" | "Letter" | "Legal";
          landscape: boolean;
          margin: number;
          headerFooter: boolean;
        };
      }) => Promise<boolean>;
      exportImage: (input: {
        html: string;
        name: string;
      }) => Promise<string | null>;
      copyRichText: (input: { html: string; text: string }) => Promise<boolean>;
      getUpdateStatus: () => Promise<UpdateStatus>;
      checkForUpdates: () => Promise<UpdateStatus>;
      downloadUpdate: () => Promise<UpdateStatus>;
      installUpdate: () => Promise<UpdateStatus>;
      fetchThemeResource: (url: string) => Promise<string>;
      onUpdateStatus: (fn: (status: UpdateStatus) => void) => () => void;
      onAction: (fn: (action: string) => void) => () => void;
      dirty: (dirty: boolean) => void;
      closeReady: () => void;
    };
  }
}
export type FolderDisplayOptions = {
  showHiddenFiles: boolean;
  showOtherFiles: boolean;
  hiddenFilePatterns?: string;
};
export function download(text: string, name: string, type = "text/markdown") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function fetchThemeResource(url: string) {
  if (window.desktop?.fetchThemeResource)
    return window.desktop.fetchThemeResource(url);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`请求失败（${response.status}）`);
  return response.text();
}
