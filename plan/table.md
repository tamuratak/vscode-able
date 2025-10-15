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
	id BIGINT AUTO_INCREMENT,
	filepath VARCHAR,       -- absolute or relative path to the original file
	filename VARCHAR,       -- base filename for display
	mimetype VARCHAR,       -- e.g. application/pdf, text/markdown
	filesize BIGINT,        -- bytes, nullable if unknown
	language VARCHAR,       -- detected language code, e.g. 'en' or 'ja'
	metadata VARCHAR,       -- JSON string with extractor metadata (page counts, title, etc.)
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY(id)
);

-- chunks: extracted text chunks with provenance information
CREATE TABLE chunks (
	id BIGINT AUTO_INCREMENT,
	file_id BIGINT NOT NULL,      -- references files.id
	chunk_index INTEGER NOT NULL, -- ordinal index of chunk within the source
	text VARCHAR,                 -- extracted text for this chunk
	start_offset BIGINT,          -- character offset start in the source text
	end_offset BIGINT,            -- character offset end in the source text
	language VARCHAR,             -- optional per-chunk language
	PRIMARY KEY(id)
);

-- embeddings: fixed-dimension float arrays for vector search
-- replace <dim> with the chosen embedding dimensionality (e.g. 1536)
CREATE TABLE embeddings (
	chunk_id BIGINT NOT NULL,     -- references chunks.id
	vec FLOAT[<dim>],             -- fixed-size float array representing the embedding
	norm FLOAT,                   -- optional precomputed norm
	updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- helper indexes
CREATE INDEX idx_chunks_fileid ON chunks (file_id);
-- HNSW index must be created after loading the vss extension
-- CREATE INDEX idx_embeddings_hnsw ON embeddings USING HNSW (vec);
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

## TypeScript helper examples

The following helpers are convenience snippets you can include in your codebase.

```ts
import type { DuckDBConnection } from '@duckdb/node-api'

export function createHnswIndexSql() {
	return 'CREATE INDEX idx_embeddings_hnsw ON embeddings USING HNSW (vec)'
}

export async function ensureVssSchema(conn: DuckDBConnection, dim: number) {
	if (!Number.isInteger(dim) || dim <= 0) throw new TypeError('dim must be a positive integer')
	await conn.run(`CREATE TABLE files (id BIGINT AUTO_INCREMENT, filepath VARCHAR, filename VARCHAR, mimetype VARCHAR, filesize BIGINT, language VARCHAR, metadata VARCHAR, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(id))`)
	await conn.run(`CREATE TABLE chunks (id BIGINT AUTO_INCREMENT, file_id BIGINT NOT NULL, chunk_index INTEGER NOT NULL, text VARCHAR, start_offset BIGINT, end_offset BIGINT, language VARCHAR, PRIMARY KEY(id))`)
	await conn.run(`CREATE TABLE embeddings (chunk_id BIGINT NOT NULL, vec FLOAT[${dim}], norm FLOAT, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`) 
	await conn.run('CREATE INDEX idx_chunks_fileid ON chunks (file_id)')
	// Note: run `CREATE INDEX idx_embeddings_hnsw ON embeddings USING HNSW (vec)` after loading vss
}

export function nearestNeighbourSql(dim: number, k: number, vector: number[]) {
	if (vector.length !== dim) throw new TypeError('vector length mismatch')
	const literal = `[${vector.join(',')}]::FLOAT[${dim}]`
	return `SELECT f.filename, c.chunk_index, c.text, e.vec FROM embeddings e JOIN chunks c ON e.chunk_id = c.id JOIN files f ON c.file_id = f.id ORDER BY array_distance(e.vec, ${literal}) LIMIT ${k}`
}
```

## Operational notes

- Load the vss extension before creating the HNSW index: `LOAD vss` (or `INSTALL vss; LOAD vss` if not present)
- Embeddings must have a fixed dimensionality. Enforce `dim` consistency in your ingestion pipeline.
- For large datasets consider batching inserts and periodically rebuilding or optimizing the HNSW index.
- Store file contents externally (e.g. object storage) and keep references in `files.filepath`, or add a BLOB column if you prefer embedding file bodies in the DB.

---

Use this schema as a starting point and adapt to your application's performance, storage,
and querying requirements.

