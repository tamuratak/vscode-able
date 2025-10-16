## Nearest by cosine distance with overlapping-interval deduplication

The SQL below returns rows whose embedding vectors are nearest to a given query vector `vec` by cosine distance. If multiple rows have overlapping character ranges `[start_offset, end_offset]`, the query keeps only the single row in each overlapping group that has the smallest cosine distance.

This implementation assumes the following schema exists in DuckDB (adjust names/types as needed):

- `embeddings` table with columns: `chunk_id`, `vec` (FLOAT[dim]), `norm` (FLOAT)
- `chunks` table with columns: `id`, `file_id`, `chunk_index`, `start_offset`, `end_offset`, `text`

Replace the placeholders `<dim>`, `[v1,v2,...]::FLOAT[<dim>]`, `:qnorm`, and `:k` with your actual values.

```sql
-- Parameters to replace:
--   [v1,v2,...]::FLOAT[<dim>]  -> the query vector literal
--   :qnorm                     -> norm (L2 length) of the query vector
--   :k                         -> max number of final results to return

WITH params AS (
	SELECT [v1,v2,...]::FLOAT[<dim>] AS q, :qnorm AS qnorm
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
		ar.euclid AS euclid_dist,
		-- dot = (||a||^2 + ||q||^2 - ||a-q||^2) / 2
		((e.norm * e.norm + params.qnorm * params.qnorm - ar.euclid * ar.euclid) / 2) AS dot,
		-- cosine distance = 1 - dot / (||a|| * ||q||)
		(1 - ( ((e.norm * e.norm + params.qnorm * params.qnorm - ar.euclid * ar.euclid) / 2) / (e.norm * params.qnorm) )) AS cos_distance
	FROM embeddings e
	JOIN chunks c ON e.chunk_id = c.id
	CROSS JOIN params
	CROSS JOIN (
		SELECT array_distance(e.vec, params.q) AS euclid
	) AS ar
),
edges AS (
	-- undirected edges between chunks whose [start_offset, end_offset] intervals overlap
	SELECT a.chunk_id AS a_id, b.chunk_id AS b_id
	FROM scored a
	JOIN scored b ON a.chunk_id < b.chunk_id
		AND a.start_offset < b.end_offset
		AND b.start_offset < a.end_offset
),
groups AS (
	-- build reachability: seed each node with itself, then expand along edges
	SELECT chunk_id, chunk_id AS group_id FROM scored
	UNION
	SELECT e.b_id AS chunk_id, g.group_id
	FROM groups g
	JOIN edges e ON e.a_id = g.chunk_id
),
component AS (
	-- assign the minimal reachable group_id as the component id for each chunk
	SELECT chunk_id, MIN(group_id) AS component_id
	FROM groups
	GROUP BY chunk_id
)
-- for each overlapping component, keep the single row with smallest cosine distance
SELECT s.chunk_id, s.file_id, s.chunk_index, s.start_offset, s.end_offset, s.text, s.cos_distance
FROM scored s
JOIN component comp ON s.chunk_id = comp.chunk_id
WHERE s.cos_distance = (
	SELECT MIN(s2.cos_distance)
	FROM scored s2
	JOIN component comp2 ON s2.chunk_id = comp2.chunk_id
	WHERE comp2.component_id = comp.component_id
)
ORDER BY s.cos_distance
LIMIT :k;
```

Beginner-friendly explanation (English):

- Goal: We want the closest chunks (by cosine distance) to a query vector. However, when two or more chunks come from overlapping character ranges in the original document, we want to return only one representative from that overlapping group to avoid duplicate or redundant results.

- Steps the query performs:
  1. params: Put the query vector and its norm into a small table so we can reuse them.
 2. scored: For every stored embedding, compute the Euclidean distance to the query vector using `array_distance`. From the euclidean distance and the two vector norms we compute the dot product, then compute cosine distance = 1 - (dot / (||a|| * ||q||)). Lower cosine distance means more similar (closer) in angle.
 3. edges: Find pairs of chunks whose `[start_offset, end_offset]` intervals overlap. These overlapping pairs are treated as connected in a graph.
 4. groups + component: Using the edges, build connected components (groups) of overlapping intervals. Each connected component represents a set of chunks that overlap each other directly or transitively.
 5. final SELECT: For each overlapping component, pick the single chunk that has the smallest cosine distance, then order the chosen rows by cosine distance and limit to `:k` results.

- Notes and tips:
  - You must compute and pass the query vector's L2 norm (:qnorm) from your application. Many vector libraries expose a norm function.
  - If your embeddings table stores the vector norm in `embeddings.norm`, ensure it contains the L2 length (not squared). If you store squared norms, adapt the math accordingly.
  - The connected-component logic uses a simple recursive expansion; for very large result sets you may prefer a more scalable approach (like windowing or client-side dedup after a small candidate set).
  - Replace `array_distance` with your DB's function for Euclidean distance if different.

This file documents the approach and a ready-to-run SQL pattern you can adapt for DuckDB with the vss extension or a compatible setup.

