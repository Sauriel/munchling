// Additive control metadata only; no business rows/UUIDs rewritten.
export const receiveSchemaStatements = `
ALTER TABLE sync_state ADD COLUMN server_epoch TEXT;
CREATE TABLE sync_download (
 id TEXT PRIMARY KEY, slot INTEGER NOT NULL DEFAULT 1 UNIQUE CHECK(slot=1),
 local_epoch TEXT NOT NULL, server_url TEXT NOT NULL, server_instance_id TEXT NOT NULL, server_epoch TEXT NOT NULL,
 manifest TEXT NOT NULL, next_page INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE sync_download_pages (
 download_id TEXT NOT NULL REFERENCES sync_download(id) ON DELETE CASCADE,
 page_index INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(download_id,page_index)
);
CREATE TABLE sync_inbox (
 id TEXT PRIMARY KEY, local_epoch TEXT NOT NULL, server_instance_id TEXT NOT NULL, server_epoch TEXT NOT NULL,
 from_cursor TEXT, to_cursor TEXT NOT NULL, payload TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('applied','blocked')), reason TEXT
);
CREATE INDEX idx_sync_inbox_status ON sync_inbox(status);
`;
