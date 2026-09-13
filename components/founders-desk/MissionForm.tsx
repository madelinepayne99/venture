"use client";

import { useState, type FormEvent } from "react";

export function MissionForm({
  onSubmit,
}: {
  onSubmit: (title: string, brief: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit(title, brief);
      setTitle("");
      setBrief("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-3">
      <div>
        <label className="text-xs font-medium uppercase tracking-wide text-hq-slate">Title</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Preschool counting worksheets"
          className="mt-1 w-full rounded-md border border-hq-brass/30 px-3 py-2 text-sm outline-none focus:border-hq-teal"
          required
        />
      </div>
      <div>
        <label className="text-xs font-medium uppercase tracking-wide text-hq-slate">
          Brief for Scout
        </label>
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="Describe the opportunity you want researched — audience, theme, platform..."
          className="mt-1 w-full rounded-md border border-hq-brass/30 px-3 py-2 text-sm outline-none focus:border-hq-teal"
          rows={3}
          required
        />
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-hq-brass px-4 py-2 text-sm font-semibold text-white transition hover:bg-hq-brassDark disabled:opacity-50"
      >
        {submitting ? "Submitting…" : "Submit mission"}
      </button>
    </form>
  );
}
