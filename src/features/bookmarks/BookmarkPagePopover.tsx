import { BookmarkPageForm } from './BookmarkPageDialog';

/**
 * Adapter used by the Tabspace Bar's "Bookmark this page" button so the bar and the Bookmarks page share one
 * save flow (title, nested folder picker with "New folder…", tags, duplicate detection).
 */
export function BookmarkPagePopover({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  return <BookmarkPageForm page={{ url, title }} onSaved={onClose} onCancel={onClose} className="w-[300px] max-w-full" />;
}
