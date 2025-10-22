## Overview

This document describes a practical schema for storing source files, extracted text
chunks, and fixed-dimension embeddings in DuckDB for use with the vss (Vector Similarity
Search) extension. Source files can be PDFs, Markdown files, plain text, or any other
document type that you extract text from.

Design goals:
- Keep file metadata separate from extracted text so that file-level operations are easy
- Store extracted text in chunk units and track offsets for provenance and highlighting
- Store embeddings as fixed-size FLOAT arrays (e.g. FLOAT[dim]) so they can be indexed
	by the vss HNSW index. The dimensionality (dim) must be fixed and agreed by the app.

## Example SQL schema

Below are example CREATE TABLE statements for DuckDB. Adjust types and constraints as
needed for your application.

```sql
-- files: metadata for original source files
CREATE TABLE files (
	id BIGINT PRIMARY KEY,
	filepath VARCHAR NOT NULL UNIQUE,       -- absolute or relative path to the original file (unique to avoid duplicate imports)
	filename VARCHAR,       -- base filename for display
	mimetype VARCHAR,       -- e.g. application/pdf, text/markdown
	filesize BIGINT,        -- bytes, nullable if unknown
	language VARCHAR,       -- detected language code, e.g. 'en' or 'ja'
	metadata VARCHAR,       -- JSON string with extractor metadata (page counts, title, etc.)
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- chunks: extracted text chunks with provenance information
-- Enforce referential integrity: each chunk must reference an existing file
-- Also enforce that (file_id, chunk_index) is unique to preserve chunk ordering/provenance
CREATE TABLE chunks (
	id BIGINT PRIMARY KEY,
	file_id BIGINT NOT NULL,      -- references files.id
	chunk_index INTEGER NOT NULL, -- ordinal index of chunk within the source
	text VARCHAR NOT NULL DEFAULT '',                 -- extracted text for this chunk
	page_start INTEGER,           -- first page number this chunk appears
	page_end INTEGER,             -- last page number this chunk appears
	start_offset INTEGER,         -- character offset start in the source text
	end_offset INTEGER,           -- character offset end in the source text
	language VARCHAR,             -- optional per-chunk language
	FOREIGN KEY (file_id) REFERENCES files(id),
	UNIQUE (file_id, chunk_index),
	-- sanity checks
	CHECK (chunk_index >= 0),
	CHECK (page_start IS NULL OR page_start >= 0),
	CHECK (page_end IS NULL OR page_end >= 0),
	CHECK (page_start IS NULL OR page_end IS NULL OR page_start <= page_end),
	CHECK (start_offset IS NULL OR start_offset >= 0),
	CHECK (end_offset IS NULL OR end_offset >= 0),
	CHECK (start_offset IS NULL OR end_offset IS NULL OR start_offset <= end_offset)
);

-- Embedding models catalog: keep model metadata and dimensionality centralized
CREATE TABLE embedding_models (
	id BIGINT PRIMARY KEY,
	name VARCHAR NOT NULL,            -- model name, e.g. "openai-text-embedding-3-small"
	provider VARCHAR,                 -- provider or framework, e.g. 'openai', 'hf'
	version VARCHAR,                  -- model version string
	dim INTEGER NOT NULL,             -- embedding dimensionality
	metadata VARCHAR,                 -- JSON string with extra params
	UNIQUE (name, version)
);

CREATE TABLE embeddings_1536 (
	chunk_id BIGINT,
	vec FLOAT[1536] NOT NULL,
	model_id BIGINT NOT NULL, -- optional link back to embedding_models
	updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (model_id, chunk_id),
	FOREIGN KEY (chunk_id) REFERENCES chunks(id),
	FOREIGN KEY (model_id) REFERENCES embedding_models(id)
);

CREATE TABLE embeddings_3072 (
	chunk_id BIGINT,
	vec FLOAT[3072] NOT NULL,
	model_id BIGINT NOT NULL, -- optional link back to embedding_models
	updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (model_id, chunk_id),
	FOREIGN KEY (chunk_id) REFERENCES chunks(id),
	FOREIGN KEY (model_id) REFERENCES embedding_models(id)
);

CREATE INDEX idx_chunks_fileid ON chunks (file_id);
CREATE INDEX idx_embeddings1536_chunkid ON embeddings_1536 (chunk_id);
CREATE INDEX idx_embeddings1536_modelid ON embeddings_1536 (model_id);
CREATE INDEX idx_embeddings3072_chunkid ON embeddings_3072 (chunk_id);
CREATE INDEX idx_embeddings3072_modelid ON embeddings_3072 (model_id);
```

```sql
-- Normalized schema: canonical authors reused across files
CREATE TABLE publishers (
	id BIGINT PRIMARY KEY,
	name VARCHAR NOT NULL,
	metadata VARCHAR,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE authors (
	id BIGINT PRIMARY KEY,
	name VARCHAR NOT NULL,
	orcid VARCHAR,       -- optional
	metadata VARCHAR,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- join table to preserve ordering and per-file role
CREATE TABLE file_authors (
	file_id BIGINT NOT NULL,
	author_id BIGINT NOT NULL,
	author_order INTEGER,
	role VARCHAR,
	PRIMARY KEY (file_id, author_id),
	FOREIGN KEY (file_id) REFERENCES files(id),
	FOREIGN KEY (author_id) REFERENCES authors(id),
	UNIQUE (file_id, author_order)
);

-- identifiers for DOI/ISBN/etc. Allows uniqueness per scheme
CREATE TABLE identifiers (
	id BIGINT PRIMARY KEY,
	file_id BIGINT NOT NULL,
	scheme VARCHAR NOT NULL, -- 'doi','isbn',...
	value VARCHAR NOT NULL,
	UNIQUE (scheme, value),
	FOREIGN KEY (file_id) REFERENCES files(id)
);

-- file_links: record directed links from one file to another (citations, imports, references, etc.)
-- Each row represents a single link from source_file_id -> target_file_id
CREATE TABLE file_links (
	id BIGINT PRIMARY KEY,
	source_file_id BIGINT NOT NULL,
	target_file_id BIGINT NOT NULL,
	link_type VARCHAR,        -- e.g. 'citation','reference','import','includes','backlink'
	anchor_text VARCHAR,      -- optional excerpt or anchor text used when linking
	page INTEGER,             -- optional page number in the source where the link appears
	start_offset INTEGER,     -- optional character offset start in the source
	end_offset INTEGER,       -- optional character offset end in the source
	metadata VARCHAR,         -- JSON string for extra metadata (line number, section id, etc.)
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (source_file_id) REFERENCES files(id),
	FOREIGN KEY (target_file_id) REFERENCES files(id),
	-- prevent exact duplicate links for the same source/target/type/anchor
	UNIQUE (source_file_id, target_file_id, link_type, anchor_text)
);

CREATE INDEX idx_filelinks_source ON file_links (source_file_id);
CREATE INDEX idx_filelinks_target ON file_links (target_file_id);

-- chunk_links: record links from a specific chunk to a file (for per-chunk references/provenance)
-- Example uses: a paragraph in file A cites file B, or a chunk contains a URL pointing to another document
CREATE TABLE chunk_links (
	id BIGINT PRIMARY KEY,
	chunk_id BIGINT NOT NULL,      -- references chunks.id
	target_file_id BIGINT NOT NULL,-- the file this chunk links to
	link_type VARCHAR,             -- e.g. 'citation','reference','url','seealso'
	anchor_text VARCHAR,           -- optional excerpt or anchor text used when linking
	page INTEGER,                  -- optional page in the source chunk where link appears
	start_offset INTEGER,          -- optional character offset start in the chunk
	end_offset INTEGER,            -- optional character offset end in the chunk
	metadata VARCHAR,              -- JSON string for extra metadata (context id, confidence, etc.)
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (chunk_id) REFERENCES chunks(id),
	FOREIGN KEY (target_file_id) REFERENCES files(id),
	UNIQUE (chunk_id, target_file_id, link_type, anchor_text)
);

CREATE INDEX idx_chunklinks_chunk ON chunk_links (chunk_id);
CREATE INDEX idx_chunklinks_target ON chunk_links (target_file_id);
```

## Example queries

-- Nearest-neighbour search (k results):
```sql
SELECT f.filename, c.chunk_index, c.text, e.vec
FROM embeddings_1536 e
JOIN chunks c ON e.chunk_id = c.id
JOIN files f ON c.file_id = f.id
ORDER BY array_distance(e.vec, [v1,v2,...,v_dim]::FLOAT[<dim>])
LIMIT 5;
```

-- Count chunks per file:
```sql
SELECT file_id, COUNT(*) AS chunk_count FROM chunks GROUP BY file_id;
```

```sql
-- Deletion order when ON DELETE CASCADE is not available (DuckDB)
-- Remove a file and all dependent rows safely. Perform these steps inside a transaction
-- to ensure atomicity and to avoid leaving orphan rows if an error occurs.
-- Replace :file_id with the target file id value.
-- Step 1: delete embeddings that reference chunks of the file
BEGIN TRANSACTION;

-- delete from each embedding table (do this for every embeddings_<dim> table you have)
DELETE FROM embeddings_1536 WHERE chunk_id IN (SELECT id FROM chunks WHERE file_id = :file_id);
DELETE FROM embeddings_3072 WHERE chunk_id IN (SELECT id FROM chunks WHERE file_id = :file_id);

DELETE FROM chunks WHERE file_id = :file_id;

DELETE FROM identifiers WHERE file_id = :file_id;
DELETE FROM file_authors WHERE file_id = :file_id;
-- delete file-level links where this file is either source or target
DELETE FROM file_links WHERE source_file_id = :file_id OR target_file_id = :file_id;
-- delete chunk-level links where the chunks belong to this file or the target is this file
DELETE FROM chunk_links WHERE chunk_id IN (SELECT id FROM chunks WHERE file_id = :file_id) OR target_file_id = :file_id;

DELETE FROM files WHERE id = :file_id;

COMMIT;

-- Notes:
-- * If you have other per-chunk tables (e.g. fts indexes, annotations), delete them in step 1.
-- * For large numbers of chunks/embeddings, prefer batching (e.g. process chunk ids in
--   ranges or use temporary table with chunk ids to join-delete) to avoid long-running
--   IN (...) lists and to reduce transaction memory pressure.
-- * Always run in a transaction so that a failure rolls back the whole operation.
```
