import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Tag } from "@mind-palace/shared";
import { api } from "./api";
import { TagGraph } from "./components/TagHierarchy";

export function TagsPage() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setTags(await api.tags());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <main className="detail-shell">
      <nav className="detail-nav">
        <Link to="/">Back to board</Link>
        <span>{tags.length} tag{tags.length === 1 ? "" : "s"}</span>
      </nav>
      {error && <div className="error-banner">{error}</div>}
      <header className="detail-header">
        <div>
          <div className="task-card-topline"><span className="task-type">tag graph</span></div>
          <h1>Tags</h1>
          <p className="muted">Most general tags at the top, most specific at the bottom — click a tag to open it.</p>
        </div>
      </header>
      <section className="tags-graph-panel">
        <div className="tags-graph-viewport">
          <TagGraph tags={tags} size="full" />
        </div>
      </section>
    </main>
  );
}