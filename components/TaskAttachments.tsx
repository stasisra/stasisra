// components/TaskAttachments.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Paperclip, X, Download, Trash2, Plus, Eye } from "lucide-react";
import {
  addTaskAttachment,
  countTaskAttachments,
  deleteAttachment,
  getAttachmentBlob,
  listTaskAttachments,
  type AttachmentMeta,
} from "@/lib/attachmentsDb";

function formatBytes(bytes: number) {
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function guessMime(name: string) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "svg") return "image/svg+xml";
  if (ext === "txt") return "text/plain";
  if (ext === "csv") return "text/csv";
  if (ext === "json") return "application/json";
  return "application/octet-stream";
}

function normalizeMime(a: { name: string; type: string }) {
  const raw = a.type?.toLowerCase();
  const mime =
    !raw || raw === "application/octet-stream" ? guessMime(a.name) : raw;
  return [
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "text/plain",
    "text/csv",
    "application/json",
  ].includes(mime)
    ? mime
    : "application/octet-stream";
}

export function AttachmentButton({
  taskId,
  onOpen,
}: {
  taskId: string;
  onOpen: () => void;
}) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    const refresh = () => {
      void countTaskAttachments(taskId)
        .then(setCount)
        .catch(() => setCount(null));
    };
    refresh();
    window.addEventListener("attachments:changed", refresh);
    return () => window.removeEventListener("attachments:changed", refresh);
  }, [taskId]);

  return (
    <button
      type="button"
      onMouseDown={(e) => {
        // чтобы клик не ушёл в link/overlay карточки
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void countTaskAttachments(taskId)
          .then(setCount)
          .catch(() => setCount(null));
        onOpen();
      }}
      title={count && count > 0 ? `Вложения: ${count}` : "Добавить вложение"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 8px",
        borderRadius: 8,
        border: "1px solid rgba(0,0,0,0.12)",
        background: "white",
        cursor: "pointer",
      }}
    >
      <Paperclip size={16} />
      {/* всегда есть span → нет hydration mismatch */}
      <span
        style={{
          fontSize: 12,
          padding: "0 6px",
          borderRadius: 999,
          border: "1px solid rgba(0,0,0,0.15)",
          opacity: count && count > 0 ? 1 : 0,
        }}
      >
        {count && count > 0 ? count : "0"}
      </span>
    </button>
  );
}

export function TaskAttachmentsModal({
  taskId,
  taskTitle,
  open,
  onClose,
  onChanged,
}: {
  taskId: string;
  taskTitle?: string;
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [items, setItems] = useState<AttachmentMeta[]>([]);
  const [preview, setPreview] = useState<{
    a: AttachmentMeta;
    url: string;
  } | null>(null);

  // portal guard
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const closePreview = () => {
    if (preview?.url) URL.revokeObjectURL(preview.url);
    setPreview(null);
  };

  const closeAll = () => {
    closePreview();
    onClose();
  };

  const flush = async () => {
    // IndexedDB иногда коммитится чуть позже — это даёт стабильное обновление UI
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    await new Promise<void>((r) => setTimeout(() => r(), 0));
  };

  const load = async () => {
    const res = await Promise.resolve(listTaskAttachments(taskId));
    setItems(Array.isArray(res) ? res : []);
    setError(null);
  };

  // при открытии / смене taskId грузим список
  useEffect(() => {
    if (!open) return;
    void load().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, taskId]);

  // при закрытии чистим preview
  useEffect(() => {
    if (!open) closePreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || !mounted) return null;

  const refresh = async () => {
    await flush();
    await load();
    onChanged?.();
  };

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const f of Array.from(files)) {
        await addTaskAttachment(taskId, f);
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка работы с файлом");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const download = async (a: AttachmentMeta) => {
    const blob = await getAttachmentBlob(a.id);
    if (!blob) return;

    const mime = normalizeMime(a);
    const fixedBlob =
      blob.type === mime ? blob : new Blob([blob], { type: mime });

    const url = URL.createObjectURL(fixedBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = a.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const openPreview = async (a: AttachmentMeta) => {
    closePreview();

    const blob = await getAttachmentBlob(a.id);
    if (!blob) return;

    const mime = normalizeMime(a);
    const fixedBlob =
      blob.type === mime ? blob : new Blob([blob], { type: mime });

    const url = URL.createObjectURL(fixedBlob);
    setPreview({ a, url });
  };

  const remove = async (a: AttachmentMeta) => {
    setBusy(true);
    try {
      if (preview?.a.id === a.id) closePreview();
      await deleteAttachment(a.id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка работы с файлом");
    } finally {
      setBusy(false);
    }
  };

  const isPdf = (mime: string) => mime.toLowerCase().includes("pdf");
  const isImage = (mime: string) => mime.toLowerCase().startsWith("image/");
  const isText = (mime: string) => mime.toLowerCase().startsWith("text/");
  const previewMime = preview ? normalizeMime(preview.a) : "";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 2147483647,
      }}
      onMouseDown={(e) => {
        // клик по overlay закрывает
        if (e.target === e.currentTarget) closeAll();
      }}
    >
      <div
        style={{
          width: "min(860px, 100%)",
          background: "white",
          borderRadius: 16,
          boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
          overflow: "hidden",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
        }}
        onMouseDown={(e) => {
          // чтобы клики внутри не всплывали в overlay/карточки
          e.stopPropagation();
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 14px",
            borderBottom: "1px solid rgba(0,0,0,0.08)",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{ fontWeight: 600 }}>Вложения</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              {taskTitle ? `Задача: ${taskTitle}` : `Task ID: ${taskId}`}
            </div>
          </div>
          <button
            type="button"
            onClick={closeAll}
            style={{
              border: "none",
              background: "transparent",
              cursor: "pointer",
            }}
            title="Закрыть"
          >
            <X />
          </button>
        </div>

        {/* Add files */}
        <div
          style={{
            padding: 14,
            display: "flex",
            gap: 10,
            alignItems: "center",
          }}
        >
          <input
            ref={fileRef}
            type="file"
            multiple
            onChange={(e) => addFiles(e.target.files)}
            style={{ display: "none" }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid rgba(0,0,0,0.12)",
              background: "white",
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            <Plus size={16} /> Добавить файлы
          </button>
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            Хранится локально (у тебя в браузере)
          </div>
        </div>

        {/* Body scroll */}
        <div style={{ padding: 14, paddingTop: 0, overflow: "auto" }}>
          {items.length === 0 ? (
            <div
              style={{
                padding: 14,
                border: "1px dashed rgba(0,0,0,0.2)",
                borderRadius: 12,
                opacity: 0.7,
              }}
            >
              Пока нет вложений. Добавь PDF/фото/Excel — удобно для чертежей,
              писем, скринов.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {items.map((a) => (
                <div
                  key={a.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: 10,
                    alignItems: "center",
                    padding: 10,
                    borderRadius: 12,
                    border: "1px solid rgba(0,0,0,0.10)",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {a.name}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        opacity: 0.7,
                        display: "flex",
                        gap: 10,
                        flexWrap: "wrap",
                      }}
                    >
                      <span>{formatBytes(a.size)}</span>
                      <span>{new Date(a.createdAt).toLocaleString()}</span>
                      {a.type && <span style={{ opacity: 0.6 }}>{a.type}</span>}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => openPreview(a)}
                      title="Просмотр"
                      style={{
                        border: "1px solid rgba(0,0,0,0.12)",
                        background: "white",
                        borderRadius: 10,
                        padding: "8px 10px",
                        cursor: "pointer",
                      }}
                    >
                      <Eye size={16} />
                    </button>

                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => download(a)}
                      title="Скачать"
                      style={{
                        border: "1px solid rgba(0,0,0,0.12)",
                        background: "white",
                        borderRadius: 10,
                        padding: "8px 10px",
                        cursor: "pointer",
                      }}
                    >
                      <Download size={16} />
                    </button>

                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => remove(a)}
                      title="Удалить"
                      style={{
                        border: "1px solid rgba(0,0,0,0.12)",
                        background: "white",
                        borderRadius: 10,
                        padding: "8px 10px",
                        cursor: "pointer",
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Preview */}
          {preview && (
            <div
              style={{
                marginTop: 12,
                border: "1px solid rgba(0,0,0,0.10)",
                borderRadius: 12,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: 10,
                  borderBottom: "1px solid rgba(0,0,0,0.08)",
                  background: "rgba(0,0,0,0.02)",
                  gap: 10,
                }}
              >
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 14,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flex: 1,
                  }}
                >
                  {preview.a.name}
                </div>

                <a
                  href={preview.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    border: "1px solid rgba(0,0,0,0.12)",
                    background: "white",
                    borderRadius: 10,
                    padding: "6px 10px",
                    cursor: "pointer",
                    fontSize: 12,
                    textDecoration: "none",
                    color: "inherit",
                    whiteSpace: "nowrap",
                  }}
                  title="Открыть в новой вкладке"
                >
                  ↗ В новой вкладке
                </a>

                <button
                  type="button"
                  onClick={closePreview}
                  style={{
                    border: "1px solid rgba(0,0,0,0.12)",
                    background: "white",
                    borderRadius: 10,
                    padding: "6px 10px",
                    cursor: "pointer",
                    fontSize: 12,
                    whiteSpace: "nowrap",
                  }}
                >
                  Закрыть просмотр
                </button>
              </div>

              <div style={{ padding: 10 }}>
                {isPdf(previewMime) ? (
                  <iframe
                    sandbox=""
                    src={preview.url}
                    title={preview.a.name}
                    style={{
                      width: "100%",
                      height: "70vh",
                      border: "1px solid rgba(0,0,0,0.12)",
                      borderRadius: 10,
                    }}
                  />
                ) : isImage(previewMime) ? (
                  <img
                    src={preview.url}
                    alt={preview.a.name}
                    style={{
                      width: "100%",
                      maxHeight: "70vh",
                      objectFit: "contain",
                      borderRadius: 10,
                      border: "1px solid rgba(0,0,0,0.12)",
                    }}
                  />
                ) : isText(previewMime) ? (
                  <iframe
                    sandbox=""
                    src={preview.url}
                    title={preview.a.name}
                    style={{
                      width: "100%",
                      height: "50vh",
                      border: "1px solid rgba(0,0,0,0.12)",
                      borderRadius: 10,
                    }}
                  />
                ) : (
                  <div style={{ fontSize: 13, opacity: 0.8 }}>
                    Для этого типа файла нет встроенного просмотра. Нажми
                    “Скачать”.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: 12,
            borderTop: "1px solid rgba(0,0,0,0.08)",
            fontSize: 12,
            opacity: 0.75,
          }}
        >
          {error ? (
            <span role="alert" className="text-red-600">
              {error}
            </span>
          ) : (
            "Файлы сохранены в базе приложения. Максимальный размер файла — 10 МБ."
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
