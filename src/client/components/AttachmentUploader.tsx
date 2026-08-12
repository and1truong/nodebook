/** Attachment upload (drag/drop, click, clipboard paste), list, preview. */
import { useEffect, useRef, useState } from "react";
import { api, formatInstant } from "../api";
import type { AttachmentDto } from "../../shared/contracts/issues";
import { isPreviewContentType } from "../../shared/limits";
import { Loading, ErrorState, EmptyState } from "./ui";

export function AttachmentUploader({
  url,
  onUploaded,
  multiple = false,
}: {
  url: string;
  onUploaded?: (a: AttachmentDto) => void;
  multiple?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const upload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const attachment = await api.uploadAttachment(url, file);
      onUploaded?.(attachment);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") return;
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (files.length > 0) {
        e.preventDefault();
        void upload(files[0]!);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  return (
    <div
      className={`uploader ${dragOver ? "dragover" : ""}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const files = [...e.dataTransfer.files];
        void upload(multiple ? files[0]! : files[0]!);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        hidden
        multiple={multiple}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = "";
        }}
      />
      {uploading ? <span>Uploading…</span> : <span>📎 Drop, click, or paste an image to attach</span>}
      {error && <span className="error-inline">{error}</span>}
    </div>
  );
}

export function AttachmentList({ attachments, onDeleted }: { attachments: AttachmentDto[]; onDeleted?: (id: string) => void }) {
  if (attachments.length === 0) return <EmptyState>No attachments.</EmptyState>;
  return (
    <ul className="attachment-list">
      {attachments.map((a) => (
        <li key={a.id} className="attachment-item">
          <AttachmentPreview attachment={a} />
          <button
            className="linklike danger"
            onClick={async () => {
              await api.deleteAttachment(a.id).catch(() => undefined);
              onDeleted?.(a.id);
            }}
          >
            delete
          </button>
        </li>
      ))}
    </ul>
  );
}

export function AttachmentPreview({ attachment }: { attachment: AttachmentDto }) {
  if (attachment.content_type === "application/pdf") {
    return (
      <span className="attachment-link">
        <a href={attachment.url} target="_blank" rel="noreferrer">
          📄 {attachment.filename} · {formatInstant(attachment.created_at)}
        </a>
      </span>
    );
  }
  if (attachment.content_type.startsWith("image/") && isPreviewContentType(attachment.content_type)) {
    return (
      <span className="attachment-link">
        <a href={attachment.url} target="_blank" rel="noreferrer">
          <img src={attachment.url} alt={attachment.filename} className="attachment-thumb" loading="lazy" />
        </a>
        <span className="attachment-name">{attachment.filename}</span>
      </span>
    );
  }
  return (
    <span className="attachment-link">
      <a href={attachment.url} download>
        ⬇ {attachment.filename} · {(attachment.size / 1024).toFixed(1)} KB
      </a>
    </span>
  );
}

export function AttachmentSection({ ownerType, ownerId, uploadUrl }: { ownerType: "issue" | "comment"; ownerId: string; uploadUrl: string }) {
  const [attachments, setAttachments] = useState<AttachmentDto[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setAttachments(null);
    setError(null);
    api
      .attachments(ownerType, ownerId)
      .then(setAttachments)
      .catch(setError);
  }, [ownerType, ownerId, reloadKey]);

  return (
    <div className="attachment-section">
      <AttachmentUploader url={uploadUrl} onUploaded={() => setReloadKey((k) => k + 1)} />
      {error ? <ErrorState error={error} /> : null}
      {!error && !attachments && <Loading label="Loading attachments…" />}
      {attachments && (
        <AttachmentList attachments={attachments} onDeleted={() => setReloadKey((k) => k + 1)} />
      )}
    </div>
  );
}
