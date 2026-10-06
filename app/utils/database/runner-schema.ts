// Local-only metadata. Published v1/v2/v3 migrations remain immutable.
export const runnerSchemaStatements = `
ALTER TABLE sync_state ADD COLUMN draft_url TEXT;
CREATE TABLE sync_upload (
 id INTEGER PRIMARY KEY CHECK(id=1), local_epoch TEXT NOT NULL,
 server_url TEXT NOT NULL, request TEXT NOT NULL, receipt TEXT
);
`;
