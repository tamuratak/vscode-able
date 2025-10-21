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
	filepath VARCHAR NOT NULL,       -- absolute or relative path to the original file
	filename VARCHAR,       -- base filename for display
	mimetype VARCHAR,       -- e.g. application/pdf, text/markdown
	filesize BIGINT,        -- bytes, nullable if unknown
	language VARCHAR,       -- detected language code, e.g. 'en' or 'ja'
	metadata VARCHAR,       -- JSON string with extractor metadata (page counts, title, etc.)
	created_at TIMESTAMP
);

-- chunks: extracted text chunks with provenance information
-- Enforce referential integrity: each chunk must reference an existing file
-- Also enforce that (file_id, chunk_index) is unique to preserve chunk ordering/provenance
CREATE TABLE chunks (
	id BIGINT PRIMARY KEY,
	file_id BIGINT NOT NULL,      -- references files.id
	chunk_index BIGINT NOT NULL, -- ordinal index of chunk within the source
	text VARCHAR NOT NULL DEFAULT '',                 -- extracted text for this chunk
	page_number BIGINT,          -- page number in the original file (1-based, nullable)
	start_offset BIGINT,          -- character offset start in the source text
	end_offset BIGINT,            -- character offset end in the source text
	language VARCHAR,             -- optional per-chunk language
	FOREIGN KEY (file_id) REFERENCES files(id),
	UNIQUE (file_id, chunk_index)
);

CREATE TABLE embeddings (
	chunk_id BIGINT PRIMARY KEY,     -- references chunks.id
	vec FLOAT[1536],             -- fixed-size float array representing the embedding
	updated_at TIMESTAMP,
	FOREIGN KEY (chunk_id) REFERENCES chunks(id)
);

-- helper indexes
CREATE INDEX idx_chunks_fileid ON chunks (file_id);
CREATE INDEX idx_embeddings_chunkid ON embeddings (chunk_id);
-- HNSW index must be created after loading the vss extension
-- CREATE INDEX idx_embeddings_hnsw ON embeddings USING HNSW (vec);
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
	FOREIGN KEY (author_id) REFERENCES authors(id)
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
```

## Example queries

-- Nearest-neighbour search (k results):
```sql
SELECT f.filename, c.chunk_index, c.text, e.vec
FROM embeddings e
JOIN chunks c ON e.chunk_id = c.id
JOIN files f ON c.file_id = f.id
ORDER BY array_distance(e.vec, [v1,v2,...,v_dim]::FLOAT[<dim>])
LIMIT 5;
```

-- Count chunks per file:
```sql
SELECT file_id, COUNT(*) AS chunk_count FROM chunks GROUP BY file_id;
```
