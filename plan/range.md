## Nearest by cosine distance with overlapping-interval deduplication

The SQL below returns rows whose embedding vectors are nearest to a given query vector `vec` by cosine distance. If multiple rows have overlapping character ranges `[start_offset, end_offset]`, the query keeps only the single row in each overlapping group that has the smallest cosine distance.

This implementation assumes the following schema exists in DuckDB (adjust names/types as needed):

- `embeddings` table with columns: `chunk_id`, `vec` (FLOAT[dim]), `norm` (FLOAT)
- `chunks` table with columns: `id`, `file_id`, `chunk_index`, `start_offset`, `end_offset`, `text`

Replace the placeholders `N` (vector dimension), `[v1,v2,...]::FLOAT[N]`, `$qnorm`, and `$k` with your actual values.

```sql
-- Parameters to replace:
--   [v1,v2,...]::FLOAT[N]  -> the query vector literal (cast to fixed-length ARRAY)
--   $qnorm                 -> norm (L2 length) of the query vector (if needed)
--   $k                     -> max number of final results to return

WITH RECURSIVE params AS (
	SELECT [v1,v2,...]::FLOAT[N] AS q, $qnorm AS qnorm, $k AS k
),
scored AS (
	-- compute cosine distance from stored embedding to query vector
	SELECT
		e.chunk_id,
		c.file_id,
		c.chunk_index,
		c.start_offset,
		c.end_offset,
		c.text,
		e.norm AS emb_norm,
		-- Use DuckDB ARRAY-native cosine distance function
		array_cosine_distance(e.vec, params.q) AS cos_distance
	FROM embeddings e
	JOIN chunks c ON e.chunk_id = c.id
	CROSS JOIN params
),
edges AS (
	-- undirected edges between chunks whose intervals overlap
	SELECT a.chunk_id AS u, b.chunk_id AS v
	FROM scored a
	JOIN scored b
	  ON a.chunk_id < b.chunk_id
	 -- choose half-open overlap testing [start, end) here; change to <= if closed intervals required
	 AND a.start_offset < b.end_offset
	 AND b.start_offset < a.end_offset
),
edge_dir AS (
	-- make edges bidirectional to allow full reachability expansion
	SELECT u, v FROM edges
	UNION ALL
	SELECT v AS u, u AS v FROM edges
),
reach AS (
	-- build reachability: seed each node with itself, then expand along directed edges
	SELECT s.chunk_id AS seed, s.chunk_id AS node FROM scored s
	UNION ALL
	SELECT r.seed, e.v AS node
	FROM reach r
	JOIN edge_dir e ON e.u = r.node
),
component AS (
	-- assign the minimal reachable seed as the component id for each chunk
	SELECT node AS chunk_id, MIN(seed) AS component_id
	FROM reach
	GROUP BY node
),
ranked AS (
	-- pick a single deterministic representative per overlapping component
	SELECT
		s.*,
		comp.component_id,
		ROW_NUMBER() OVER (PARTITION BY comp.component_id ORDER BY s.cos_distance, s.chunk_id) AS rn
	FROM scored s
	JOIN component comp ON s.chunk_id = comp.chunk_id
)
-- for each overlapping component, keep the single row with smallest cosine distance (tie-broken by chunk_id)
SELECT chunk_id, file_id, chunk_index, start_offset, end_offset, text, cos_distance
FROM ranked
WHERE rn = 1
ORDER BY cos_distance
LIMIT (SELECT k FROM params);
```

Beginner-friendly explanation (English):

- Goal: We want the closest chunks (by cosine distance) to a query vector. However, when two or more chunks come from overlapping character ranges in the original document, we want to return only one representative from that overlapping group to avoid duplicate or redundant results.

- Steps the query performs:
 1. params: Put the query vector and its norm into a small table so we can reuse them.
 2. scored: For every stored embedding, compute the Euclidean distance to the query vector using `array_distance`. From the euclidean distance and the two vector norms we compute the dot product, then compute cosine distance = 1 - (dot / (||a|| * ||q||)). Lower cosine distance means more similar (closer) in angle.
 3. edges: Find pairs of chunks whose `[start_offset, end_offset]` intervals overlap. These overlapping pairs are treated as connected in a graph.
 4. groups + component: Using the edges, build connected components (groups) of overlapping intervals. Each connected component represents a set of chunks that overlap each other directly or transitively.
 5. final SELECT: For each overlapping component, pick the single chunk that has the smallest cosine distance, then order the chosen rows by cosine distance and limit to `:k` results.

	- You must compute and pass the query vector's L2 norm ($qnorm) from your application if you compute cosine manually. Many vector libraries expose a norm function.
  - If your embeddings table stores the vector norm in `embeddings.norm`, ensure it contains the L2 length (not squared). If you store squared norms, adapt the math accordingly.
	- The connected-component logic uses a recursive expansion; for very large candidate sets prefer two-stage search: ANN candidate retrieval (vss/HNSW) -> dedupe on the reduced candidate set -> final ranking.
  - Replace `array_distance` with your DB's function for Euclidean distance if different.

This file documents the approach and a ready-to-run SQL pattern you can adapt for DuckDB with the vss extension or a compatible setup.

## Node.js (TypeScript) usage — prepared statement example

The following example shows how to safely bind a query vector and other parameters using a prepared statement with the `@duckdb/node-api` client. It uses `arrayValue` to wrap the JS array so the client treats it as a database array.

Key points
- Compute the L2 norm (qnorm) of the query vector on the application side and pass it into the query
- Use `arrayValue` to bind the vector to the statement and avoid SQL injection
- For very large corpora, prefer a two-stage approach: ANN (e.g. HNSW) to retrieve candidate ids, then run this dedupe+final-ranking query against the candidate set

```ts
// Example: prepared-statement usage with @duckdb/node-api
import { DuckDBConnection, arrayValue } from '@duckdb/node-api'

async function searchNearest(vec: number[], k = 10) {
	// compute L2 norm of the query vector
	const qnorm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0))

	const sql = `
WITH RECURSIVE params AS (
	SELECT $1 AS q, $2 AS qnorm, $3 AS k
),
scored AS (
	SELECT
		e.chunk_id,
		c.file_id,
		c.chunk_index,
		c.start_offset,
		c.end_offset,
		c.text,
		e.norm AS emb_norm,
		array_cosine_distance(e.vec, params.q) AS cos_distance
	FROM embeddings e
	JOIN chunks c ON e.chunk_id = c.id
	CROSS JOIN params
),
edges AS (
	SELECT a.chunk_id AS u, b.chunk_id AS v
	FROM scored a
	JOIN scored b
		ON a.chunk_id < b.chunk_id
	 AND a.start_offset < b.end_offset
	 AND b.start_offset < a.end_offset
),
edge_dir AS (
	SELECT u, v FROM edges
	UNION ALL
	SELECT v AS u, u AS v FROM edges
),
reach AS (
	SELECT s.chunk_id AS seed, s.chunk_id AS node FROM scored s
	UNION ALL
	SELECT r.seed, e.v AS node
	FROM reach r
	JOIN edge_dir e ON e.u = r.node
),
component AS (
	SELECT node AS chunk_id, MIN(seed) AS component_id
	FROM reach
	GROUP BY node
),
ranked AS (
	SELECT
		s.*,
		comp.component_id,
		ROW_NUMBER() OVER (PARTITION BY comp.component_id ORDER BY s.cos_distance, s.chunk_id) AS rn
	FROM scored s
	JOIN component comp ON s.chunk_id = comp.chunk_id
)
SELECT chunk_id, file_id, chunk_index, start_offset, end_offset, text, cos_distance
FROM ranked
WHERE rn = 1
ORDER BY cos_distance
LIMIT (SELECT k FROM params);
`

	const conn = await DuckDBConnection.create()
	try {
		const prepared = await conn.prepare(sql)
		// bind parameters: [ query vector, qnorm, k ]
		prepared.bind([arrayValue(vec), qnorm, k])
		const reader = await prepared.runAndReadAll()
		return reader.getRowObjects()
	} finally {
		conn.disconnectSync()
	}
}

// Example usage
;(async () => {
	const vec = [0.1, -0.2, 0.3, 0.4]
	const results = await searchNearest(vec, 5)
	for (const r of results) console.log(r)
})().catch(err => console.error(err))
```

Notes
- Ensure `embeddings.norm` stores the L2 norm (not squared). If you store squared norms, adapt the math accordingly
- If your DuckDB build requires explicit casting for fixed-length arrays, cast the bound array appropriately or use a small wrapper query
- Recursive connected-component expansion can be expensive for very large candidate sets; in production prefer retrieving a modest-sized candidate set from an ANN index first


