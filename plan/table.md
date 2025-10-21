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
	created_at TIMESTAMP
);

-- chunks: extracted text chunks with provenance information
-- Enforce referential integrity: each chunk must reference an existing file
-- Also enforce that (file_id, chunk_index) is unique to preserve chunk ordering/provenance
CREATE TABLE chunks (
	id BIGINT PRIMARY KEY,
	file_id BIGINT NOT NULL,      -- references files.id
	chunk_index INTEGER NOT NULL, -- ordinal index of chunk within the source
	text VARCHAR NOT NULL DEFAULT '',                 -- extracted text for this chunk
	page_number INTEGER,          -- page number in the original file (1-based, nullable)
	start_offset INTEGER,          -- character offset start in the source text
	end_offset INTEGER,            -- character offset end in the source text
	language VARCHAR,             -- optional per-chunk language
	FOREIGN KEY (file_id) REFERENCES files(id),
	UNIQUE (file_id, chunk_index),
	-- sanity checks
	CHECK (chunk_index >= 0),
	CHECK (page_number IS NULL OR page_number >= 1),
	CHECK (start_offset IS NULL OR end_offset IS NULL OR start_offset <= end_offset)
);

-- Embedding models catalog: keep model metadata and dimensionality centralized
CREATE TABLE embedding_models (
	id BIGINT PRIMARY KEY,
	name VARCHAR NOT NULL,            -- model name, e.g. "openai-text-embedding-3-small"
	provider VARCHAR,                 -- provider or framework, e.g. 'openai', 'hf'
	version VARCHAR,                  -- model version string
	dim INTEGER NOT NULL,             -- embedding dimensionality
	model_hash VARCHAR,               -- short fingerprint of model spec/weights
	metadata VARCHAR,                 -- JSON string with extra params
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	UNIQUE (name, version)
);

-- embeddings: allow one embedding per (chunk, model). This lets you keep
-- multiple models and preserve history. model_dim is copied for easy checks.
CREATE TABLE embeddings (
	chunk_id BIGINT NOT NULL,
	model_id BIGINT NOT NULL,
	vec FLOAT[] NOT NULL,             -- vector; DB-level check ensures length == model_dim
	model_dim INTEGER NOT NULL,
	updated_at TIMESTAMP,
	PRIMARY KEY (chunk_id, model_id),
	FOREIGN KEY (chunk_id) REFERENCES chunks(id),
	FOREIGN KEY (model_id) REFERENCES embedding_models(id),
	-- Ensure stored vector length matches declared model_dim. Replace `cardinality` if DB differs.
	CHECK (length(vec) = model_dim)
);

-- helper indexes
CREATE INDEX idx_chunks_fileid ON chunks (file_id);
CREATE INDEX idx_embeddings_chunkid ON embeddings (chunk_id);
CREATE INDEX idx_embeddings_modelid ON embeddings (model_id);
-- HNSW index must be created after loading the vss extension and should be created per-model
-- because vectors indexed together must share the same dimensionality and metric
-- Example (per-model):
-- CREATE INDEX idx_embeddings_hnsw_modelX ON embeddings USING HNSW (vec) WHERE model_id = <model_id>;
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
