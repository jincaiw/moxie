import { useCallback, useEffect, useRef, useState } from "react";
import { welcome, guide, type DocumentFile } from "./data";
import { download, type DiskFile, type FileChange } from "./bridge";
import { rehomeImages } from "./assets";
const recoveryKey = "moxie.recovery.v1";
const recoveryDatabase = "moxie.recovery.v1";
const recoveryStore = "snapshots";
const localRecoveryLimit = 1_500_000;
type RecoverySnapshot = { docs: DocumentFile[]; active?: string };

function validDocuments(value: unknown): value is DocumentFile[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (d) =>
        typeof d.id === "string" &&
        typeof d.name === "string" &&
        typeof d.text === "string",
    )
  );
}

function openRecoveryDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("当前环境不支持 IndexedDB"));
      return;
    }
    const request = window.indexedDB.open(recoveryDatabase, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(recoveryStore);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("恢复存储正在升级"));
  });
}

async function readIndexedRecovery(): Promise<RecoverySnapshot | null> {
  const database = await openRecoveryDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(recoveryStore, "readonly");
    const request = transaction.objectStore(recoveryStore).get("latest");
    request.onsuccess = () => {
      database.close();
      const value = request.result as RecoverySnapshot | undefined;
      resolve(value && validDocuments(value.docs) ? value : null);
    };
    request.onerror = () => {
      database.close();
      reject(request.error);
    };
  });
}

async function writeIndexedRecovery(snapshot: RecoverySnapshot) {
  const database = await openRecoveryDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(recoveryStore, "readwrite");
    transaction.objectStore(recoveryStore).put(snapshot, "latest");
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

async function deleteIndexedRecovery() {
  const database = await openRecoveryDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(recoveryStore, "readwrite");
    transaction.objectStore(recoveryStore).delete("latest");
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

function initial(): DocumentFile[] {
  try {
    const value = JSON.parse(localStorage.getItem(recoveryKey) || "null");
    if (validDocuments(value)) {
      return value.map((d) => ({
        ...d,
        diskText: d.diskText ?? (d.dirty ? undefined : d.text),
      }));
    }
  } catch {}
  return [
    { id: "welcome", name: "欢迎使用.md", text: welcome, diskText: welcome },
    { id: "guide", name: "写作指南.md", text: guide, diskText: guide },
  ];
}
export function useWorkspace(
  autoSave: boolean,
  notify: (message: string) => void,
) {
  const [docs, setDocs] = useState(initial);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [active, setActive] = useState(() => {
    try {
      const saved = localStorage.getItem("moxie.active.v1");
      if (docs.some((d) => d.id === saved)) return saved!;
    } catch {}
    return docs[0].id;
  });
  useEffect(() => {
    if (!recoveryReady) return;
    try {
      localStorage.setItem("moxie.active.v1", active);
    } catch {}
  }, [active, recoveryReady]);
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<{ path: string; name: string }[]>([]);
  const [recoveryStatus, setRecoveryStatus] = useState("恢复副本已更新");
  const [autoErrors, setAutoErrors] = useState<Record<string, string>>({});
  const [externalChanges, setExternalChanges] = useState<
    Record<string, FileChange>
  >({});
  const docsRef = useRef(docs);
  docsRef.current = docs;
  useEffect(() => {
    let cancelled = false;
    void readIndexedRecovery()
      .then((snapshot) => {
        if (cancelled || !snapshot) return;
        const restored = snapshot.docs.map((d) => ({
          ...d,
          diskText: d.diskText ?? (d.dirty ? undefined : d.text),
        }));
        docsRef.current = restored;
        setDocs(restored);
        if (restored.some((d) => d.id === snapshot.active))
          setActive(snapshot.active!);
      })
      .catch(() => {
        /* An unavailable indexed snapshot leaves localStorage recovery intact. */
      })
      .finally(() => {
        if (!cancelled) setRecoveryReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const saving = useRef(false);
  const current = docs.find((d) => d.id === active) || docs[0];
  const currentRef = useRef(current);
  currentRef.current = current;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const recoveryWriteQueue = useRef<Promise<void>>(Promise.resolve());
  const queueRecoveryWrite = useCallback(() => {
    const next = recoveryWriteQueue.current
      .catch(() => {})
      .then(() =>
        writeIndexedRecovery({
          docs: docsRef.current,
          active: currentRef.current.id,
        }),
      );
    recoveryWriteQueue.current = next;
    return next;
  }, []);
  const flush = useCallback(() => {
    try {
      const snapshot = docsRef.current;
      if (
        snapshot.reduce((size, document) => size + document.text.length, 0) >
        localRecoveryLimit
      )
        throw new Error("大文档改用 IndexedDB 恢复存储");
      localStorage.setItem(recoveryKey, JSON.stringify(snapshot));
      setRecoveryStatus("恢复副本已更新");
      void recoveryWriteQueue.current
        .catch(() => {})
        .then(() => deleteIndexedRecovery())
        .catch(() => {});
      return true;
    } catch {
      setRecoveryStatus("正在保存大文档恢复副本");
      void queueRecoveryWrite()
        .then(() => {
          try {
            localStorage.removeItem(recoveryKey);
          } catch {}
          setRecoveryStatus("恢复副本已更新");
        })
        .catch(() => {
          setRecoveryStatus("恢复副本写入失败");
          notifyRef.current("恢复存储空间不足，请立即保存文档。");
        });
      return false;
    }
  }, [queueRecoveryWrite]);
  const flushAsync = useCallback(async () => {
    const snapshot = {
      docs: docsRef.current,
      active: currentRef.current.id,
    };
    try {
      if (
        snapshot.docs.reduce(
          (size, document) => size + document.text.length,
          0,
        ) > localRecoveryLimit
      )
        throw new Error("大文档改用 IndexedDB 恢复存储");
      localStorage.setItem(recoveryKey, JSON.stringify(snapshot.docs));
      await recoveryWriteQueue.current.catch(() => {});
      await deleteIndexedRecovery().catch(() => {});
      setRecoveryStatus("恢复副本已更新");
      return true;
    } catch {
      setRecoveryStatus("正在保存大文档恢复副本");
      try {
        await queueRecoveryWrite();
        try {
          localStorage.removeItem(recoveryKey);
        } catch {}
        setRecoveryStatus("恢复副本已更新");
        return true;
      } catch {
        setRecoveryStatus("恢复副本写入失败");
        notifyRef.current("恢复存储空间不足，请立即保存文档。");
        return false;
      }
    }
  }, [queueRecoveryWrite]);
  useEffect(() => {
    if (!recoveryReady) return;
    window.desktop?.dirty(docs.some((d) => d.dirty));
    if (
      docs.reduce((size, document) => size + document.text.length, 0) >
      localRecoveryLimit
    ) {
      void flushAsync();
      return;
    }
    const timer = setTimeout(() => void flushAsync(), 300);
    return () => clearTimeout(timer);
  }, [docs, flushAsync, recoveryReady]);
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => {
      if (!recoveryReady) return;
      const size = docsRef.current.reduce(
        (total, document) => total + document.text.length,
        0,
      );
      // Large snapshots are persisted from edit() and the debounced writer.
      // Starting another async write during unload can race and replace a newer snapshot.
      if (size <= localRecoveryLimit) flush();
      if (!window.desktop && docsRef.current.some((d) => d.dirty)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [flush, recoveryReady]);
  const refreshRecent = useCallback(async () => {
    try {
      if (window.desktop?.recent) setRecent(await window.desktop.recent());
    } catch {}
  }, []);
  useEffect(() => {
    void refreshRecent();
  }, [refreshRecent]);
  useEffect(() => {
    if (!window.desktop?.inspect) return;
    let disposed = false,
      checking = false;
    const observed = new Map<string, { baseline?: string; version: string }>();
    const check = async () => {
      if (checking || saving.current || document.hidden) return;
      const paths = docsRef.current
        .flatMap((d) => {
          if (!d.path) return [];
          const seen = observed.get(d.path);
          return [
            {
              path: d.path,
              version:
                seen?.baseline === d.diskVersion
                  ? seen?.version
                  : d.diskVersion,
            },
          ];
        })
        .slice(0, 100);
      if (!paths.length) return;
      const baselines = new Map(
        docsRef.current.map((d) => [d.path, d.diskVersion]),
      );
      checking = true;
      try {
        const changes = await window.desktop!.inspect(paths);
        if (disposed || saving.current) return;
        for (const change of changes) {
          const current = docsRef.current.find((d) => d.path === change.path);
          if (!current || current.diskVersion !== baselines.get(change.path))
            continue;
          observed.set(change.path, {
            baseline: current.diskVersion,
            version: change.version,
          });
          if (
            change.status === "changed" &&
            change.text !== undefined &&
            (!current.dirty || current.text === change.text)
          ) {
            setDocs((list) =>
              list.map((d) =>
                d.id === current.id && (!d.dirty || d.text === change.text)
                  ? {
                      ...d,
                      text: change.text!,
                      diskText: change.text,
                      diskVersion: change.version,
                      dirty: false,
                    }
                  : d,
              ),
            );
            setExternalChanges((list) => {
              const next = { ...list };
              delete next[current.id];
              return next;
            });
            setAutoErrors((list) => {
              const next = { ...list };
              delete next[current.id];
              return next;
            });
          } else if (
            change.status !== "changed" ||
            change.text !== current.diskText
          ) {
            setExternalChanges((list) => ({ ...list, [current.id]: change }));
            setAutoErrors((list) => ({
              ...list,
              [current.id]: "磁盘版本已变化，自动保存已暂停。",
            }));
          }
        }
      } catch {
        /* 保存时仍会校验磁盘版本；暂时读不到文件时不丢失本地内容。 */
      } finally {
        checking = false;
      }
    };
    const timer = setInterval(() => void check(), 2000);
    const focus = () => void check();
    window.addEventListener("focus", focus);
    void check();
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, []);
  const reloadExternal = useCallback(async (id: string) => {
    const snapshot = docsRef.current.find((d) => d.id === id);
    if (!snapshot?.path || !window.desktop || saving.current) return false;
    try {
      const disk = await window.desktop.reopen(snapshot.path);
      const latest = docsRef.current.find((d) => d.id === id);
      if (
        !latest ||
        latest.text !== snapshot.text ||
        latest.diskVersion !== snapshot.diskVersion
      ) {
        notifyRef.current("读取期间发生了编辑，请重新确认载入磁盘版本。");
        return false;
      }
      setDocs((list) =>
        list.map((d) =>
          d.id === id && d.text === snapshot.text
            ? {
                ...d,
                text: disk.text,
                diskText: disk.text,
                diskVersion: disk.version,
                dirty: false,
              }
            : d,
        ),
      );
      setExternalChanges((list) => {
        const next = { ...list };
        delete next[id];
        return next;
      });
      setAutoErrors((list) => {
        const next = { ...list };
        delete next[id];
        return next;
      });
      notifyRef.current("已载入磁盘版本");
      return true;
    } catch {
      notifyRef.current("无法读取磁盘版本，请另存为保留当前内容。");
      return false;
    }
  }, []);
  const edit = useCallback(
    (id: string, text: string) => {
      const next = docsRef.current.map((d) =>
        d.id === id ? { ...d, text, dirty: text !== (d.diskText ?? "") } : d,
      );
      docsRef.current = next;
      setDocs(next);
      if (
        next.reduce((size, document) => size + document.text.length, 0) >
        localRecoveryLimit
      ) {
        void queueRecoveryWrite()
          .then(() => {
            try {
              localStorage.removeItem(recoveryKey);
            } catch {}
          })
          .catch(() => {
            setRecoveryStatus("恢复副本写入失败");
            notifyRef.current("恢复存储空间不足，请立即保存文档。");
          });
      }
    },
    [queueRecoveryWrite],
  );
  const markDirty = useCallback((id: string) => {
    if (!docsRef.current.some((d) => d.id === id && !d.dirty)) return;
    const next = docsRef.current.map((d) =>
      d.id === id && !d.dirty ? { ...d, dirty: true } : d,
    );
    docsRef.current = next;
    setDocs(next);
  }, []);
  const add = useCallback(() => {
    const used = new Set(docsRef.current.map((d) => d.name));
    let name = "未命名.md",
      number = 2;
    while (used.has(name)) name = `未命名 ${number++}.md`;
    const document = {
      id: crypto.randomUUID(),
      name,
      text: "# 新文档\n\n",
      dirty: true,
    };
    setDocs((list) => [...list, document]);
    setActive(document.id);
  }, []);
  const importFile = useCallback(
    (file: DiskFile | { name: string; text: string }) => {
      const path = "path" in file ? file.path : undefined;
      const existing = path && docsRef.current.find((d) => d.path === path);
      if (existing) {
        setActive(existing.id);
        return;
      }
      const document = {
        ...file,
        id: crypto.randomUUID(),
        diskText: file.text,
        diskVersion: "version" in file ? file.version : undefined,
        dirty: false,
      };
      setDocs((list) => [...list, document]);
      setActive(document.id);
    },
    [],
  );
  const save = useCallback(
    async (
      document: DocumentFile = currentRef.current,
      saveAs = false,
      automatic = false,
    ) => {
      document = docsRef.current.find((d) => d.id === document.id) || document;
      if (saving.current) return false;
      saving.current = true;
      setBusy(true);
      try {
        if (window.desktop) {
          const file = await window.desktop.save({
            path: document.path,
            text: document.text,
            name: document.name,
            expected: document.diskText,
            saveAs,
            automatic,
          });
          if (!file) return false;
          setDocs((list) =>
            list.map((d) =>
              d.id === document.id
                ? {
                    ...d,
                    path: file.path,
                    name: file.name,
                    diskText: file.text,
                    diskVersion: file.version,
                    dirty: d.text !== file.text,
                  }
                : d,
            ),
          );
          if (saveAs && document.path && file.path !== document.path) {
            try {
              const moved = await rehomeImages(
                document.text,
                document.path,
                file.path,
              );
              if (moved !== document.text) {
                const latest = docsRef.current.find(
                  (d) => d.id === document.id,
                );
                if (latest && latest.text !== document.text) {
                  notifyRef.current(
                    "另存为已完成，保存期间发生了编辑，请检查图片路径后再次保存。",
                  );
                } else {
                  const updated = await window.desktop.save({
                    path: file.path,
                    text: moved,
                    name: file.name,
                    expected: file.text,
                  });
                  if (updated)
                    setDocs((list) =>
                      list.map((d) =>
                        d.id === document.id
                          ? d.text === document.text
                            ? {
                                ...d,
                                text: moved,
                                diskText: moved,
                                diskVersion: updated.version,
                                dirty: false,
                              }
                            : {
                                ...d,
                                diskText: moved,
                                diskVersion: updated.version,
                                dirty: true,
                              }
                          : d,
                      ),
                    );
                }
              }
            } catch {
              notifyRef.current(
                "文档已另存为，但部分图片未能复制，请检查图片路径。",
              );
            }
          }
          void refreshRecent();
        } else {
          if (automatic) return false;
          download(document.text, document.name);
          setDocs((list) =>
            list.map((d) =>
              d.id === document.id
                ? {
                    ...d,
                    diskText: document.text,
                    dirty: d.text !== document.text,
                  }
                : d,
            ),
          );
        }
        setAutoErrors((errors) => {
          const next = { ...errors };
          delete next[document.id];
          return next;
        });
        setExternalChanges((list) => {
          const next = { ...list };
          delete next[document.id];
          return next;
        });
        if (!automatic) notifyRef.current("文档已保存");
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (automatic)
          setAutoErrors((errors) => ({ ...errors, [document.id]: message }));
        notifyRef.current(message);
        return false;
      } finally {
        saving.current = false;
        setBusy(false);
      }
    },
    [refreshRecent],
  );
  useEffect(() => {
    if (!autoSave || !window.desktop || busy) return;
    const candidates = docs.filter(
      (d) => d.dirty && d.path && !autoErrors[d.id] && !externalChanges[d.id],
    );
    if (!candidates.length) return;
    const timer = setTimeout(() => {
      void (async () => {
        for (const snapshot of candidates) {
          const document = docsRef.current.find((d) => d.id === snapshot.id);
          if (document?.dirty) await save(document, false, true);
        }
      })();
    }, 1200);
    return () => clearTimeout(timer);
  }, [docs, autoSave, autoErrors, externalChanges, busy, save]);
  const remove = useCallback((id: string) => {
    const next = docsRef.current.filter((d) => d.id !== id);
    if (!next.length)
      next.push({
        id: crypto.randomUUID(),
        name: "未命名.md",
        text: "",
        diskText: "",
        dirty: false,
      });
    const index = docsRef.current.findIndex((d) => d.id === id);
    setDocs(next);
    if (currentRef.current.id === id)
      setActive(next[Math.min(Math.max(0, index), next.length - 1)].id);
    setAutoErrors((errors) => {
      const result = { ...errors };
      delete result[id];
      return result;
    });
  }, []);
  const moveDocument = useCallback((id: string, targetId: string) => {
    if (id === targetId) return;
    const currentDocs = docsRef.current;
    const from = currentDocs.findIndex((document) => document.id === id);
    const to = currentDocs.findIndex((document) => document.id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...currentDocs];
    const [document] = next.splice(from, 1);
    next.splice(to, 0, document);
    docsRef.current = next;
    setDocs(next);
  }, []);
  const setDocumentGroup = useCallback((id: string, group?: string) => {
    const next = docsRef.current.map((document) =>
      document.id === id
        ? { ...document, group: group || undefined }
        : document,
    );
    docsRef.current = next;
    setDocs(next);
  }, []);
  return {
    docs,
    recoveryReady,
    docsRef,
    current,
    setActive,
    add,
    importFile,
    edit,
    markDirty,
    save,
    busy,
    saving,
    recent,
    refreshRecent,
    recoveryStatus,
    autoErrors,
    externalChanges,
    reloadExternal,
    flush,
    flushAsync,
    remove,
    moveDocument,
    setDocumentGroup,
  };
}
