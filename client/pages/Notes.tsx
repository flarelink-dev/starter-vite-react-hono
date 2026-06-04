// The whole demo, one screen. Sign-in gates this; useSession provides
// the user. Notes are fetched + posted via this Worker's server routes
// (which use the Flarelink SDK with the service key). Attachments PUT
// straight to R2 via a presigned URL minted server-side.

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { flarelink } from '../lib/flarelink.ts';
import { refreshSession, useSession } from '../lib/session.ts';

type Note = {
  id: string;
  content: string;
  attachment_key: string | null;
  created_at: number;
};

export function Notes() {
  const session = useSession();
  const user = session.status === 'signed-in' ? session.user : null;

  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/notes', { credentials: 'include' });
      if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
      const data = (await r.json()) as { notes: Note[] };
      setNotes(data.notes);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    setUploading(true);
    setError(null);
    try {
      let attachmentKey: string | null = null;

      if (file) {
        // 1. Mint a presigned PUT URL on the server (uses serviceKey).
        const r = await fetch('/api/attachments/upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ filename: file.name, contentType: file.type }),
        });
        if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
        const { url, key } = (await r.json()) as { url: string; key: string };

        // 2. Browser PUTs the bytes directly to R2 — zero egress, zero
        //    bytes through this Worker. Content-Type MUST match what was
        //    sent at signing time (it's included in SignedHeaders).
        const put = await fetch(url, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
        });
        if (!put.ok) throw new Error(`R2 upload failed (${put.status})`);
        attachmentKey = key;
      }

      // 3. Create the note row with the optional attachment key.
      const r = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ content: draft.trim(), attachmentKey }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);

      setDraft('');
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const onDelete = async (id: string) => {
    if (!confirm('Delete this note?')) return;
    try {
      const r = await fetch(`/api/notes/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const onSignOut = async () => {
    await flarelink.auth.signOut();
    refreshSession();
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-stone-200 bg-white">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight flex-1">📓 Notebook</h1>
          <span className="text-sm text-stone-500 truncate">{user?.email}</span>
          <button
            type="button"
            onClick={() => void onSignOut()}
            className="text-sm text-stone-600 hover:text-stone-900"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        <form onSubmit={onSubmit} className="bg-white border border-stone-200 rounded-xl p-4 mb-6 shadow-sm">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="What's on your mind?"
            rows={3}
            className="w-full px-3 py-2 border border-stone-200 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-400 resize-none"
          />
          <div className="flex items-center gap-3 mt-3">
            <label className="text-xs text-stone-500 hover:text-stone-700 cursor-pointer flex items-center gap-1.5">
              📎
              <input
                ref={fileInputRef}
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="hidden"
              />
              {file ? <span className="font-mono">{file.name}</span> : 'Attach a file'}
            </label>
            <div className="flex-1" />
            <button
              type="submit"
              disabled={!draft.trim() || uploading}
              className="px-4 py-1.5 bg-orange-600 text-white text-sm font-medium rounded-md hover:bg-orange-500 disabled:opacity-50"
            >
              {uploading ? 'Saving…' : 'Save note'}
            </button>
          </div>
        </form>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md p-3 mb-4">
            {error}
          </div>
        )}

        {loading && notes.length === 0 && (
          <div className="text-center text-sm text-stone-400 py-12">loading…</div>
        )}
        {!loading && notes.length === 0 && (
          <div className="text-center text-sm text-stone-400 py-12">
            No notes yet. Write your first one above.
          </div>
        )}

        <ul className="space-y-3">
          {notes.map((n) => (
            <NoteCard key={n.id} note={n} onDelete={() => void onDelete(n.id)} />
          ))}
        </ul>
      </main>
    </div>
  );
}

function NoteCard({ note, onDelete }: { note: Note; onDelete: () => void }) {
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!note.attachment_key) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `/api/attachments/download-url?key=${encodeURIComponent(note.attachment_key!)}`,
          { credentials: 'include' },
        );
        if (!r.ok) return;
        const data = (await r.json()) as { url: string };
        if (!cancelled) setDownloadUrl(data.url);
      } catch {
        /* non-fatal */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [note.attachment_key]);

  const date = new Date(note.created_at).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <li className="bg-white border border-stone-200 rounded-xl p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <p className="text-sm text-stone-900 whitespace-pre-wrap flex-1 m-0">{note.content}</p>
        <button
          type="button"
          onClick={onDelete}
          className="text-stone-300 hover:text-red-500 text-xs"
          title="delete"
        >
          ✕
        </button>
      </div>
      {note.attachment_key && (
        <div className="mt-2 text-xs">
          {downloadUrl ? (
            <a
              href={downloadUrl}
              target="_blank"
              rel="noreferrer"
              className="text-orange-600 hover:underline font-mono"
            >
              📎 {note.attachment_key.split('/').pop()}
            </a>
          ) : (
            <span className="text-stone-400 font-mono">📎 loading…</span>
          )}
        </div>
      )}
      <div className="text-[11px] text-stone-400 mt-2 font-mono">{date}</div>
    </li>
  );
}
