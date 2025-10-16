# Selecting non-overlapping ranges ([startoffset, endoffset])

This note summarizes how to work with rows that carry inclusive ranges [startoffset, endoffset] and how to return results that do not overlap.

## Overlap and non-overlap tests

- Two inclusive intervals a = [a_s, a_e] and b = [b_s, b_e] overlap iff:
	a_s <= b_e AND b_s <= a_e
- They are non-overlapping iff:
	a_e < b_s OR b_e < a_s

Half-open variant [s, e):
- Overlap: a_s < b_e AND b_s < a_e
- Non-overlap: a_e <= b_s OR b_e <= a_s

## 1) Return only rows that do not overlap any other row (anti-join)

Given a table `intervals(id, startoffset, endoffset)`, keep a row only if there exists no other row that overlaps it.

```sql
SELECT i.*
FROM intervals i
WHERE NOT EXISTS (
	SELECT 1
	FROM intervals j
	WHERE j.id <> i.id
		AND j.startoffset <= i.endoffset
		AND i.startoffset <= j.endoffset
)
```

Notes:
- Works on PostgreSQL, MySQL 8+, SQLite, DuckDB.
- To scope “non-overlap within a group”, add `AND j.group_id = i.group_id` to the inner predicate.
- For [s, e) (half-open), replace the two conditions with `j.startoffset < i.endoffset AND i.startoffset < j.endoffset`.

## 2) Build a mutually non-overlapping result set (maximal set, greedy by earliest finish)

If you want a set of rows that are pairwise non-overlapping, a standard approach is the interval scheduling greedy: repeatedly pick the interval that finishes earliest, then discard all intervals that start at or before that finish, and continue.

Portable recursive CTE (PostgreSQL, DuckDB, MySQL 8+):

```sql
WITH RECURSIVE picked AS (
	-- Seed: the earliest-finishing interval overall
	SELECT i.id, i.startoffset, i.endoffset
	FROM intervals i
	ORDER BY i.endoffset, i.startoffset, i.id
	LIMIT 1
	UNION ALL
	-- Step: among intervals that start after the last finish, pick the earliest-finishing next one
	SELECT i2.id, i2.startoffset, i2.endoffset
	FROM picked p
	JOIN intervals i2
		ON i2.startoffset > p.endoffset    -- strict > because ranges are inclusive [s, e]
	WHERE i2.endoffset = (
		SELECT MIN(i3.endoffset)
		FROM intervals i3
		WHERE i3.startoffset > p.endoffset
	)
)
SELECT *
FROM picked
```

PostgreSQL variant using LATERAL to break ties deterministically by (end, start, id):

```sql
WITH RECURSIVE picked AS (
	SELECT i.id, i.startoffset, i.endoffset
	FROM intervals i
	ORDER BY i.endoffset, i.startoffset, i.id
	LIMIT 1
	UNION ALL
	SELECT nxt.id, nxt.startoffset, nxt.endoffset
	FROM picked p
	JOIN LATERAL (
		SELECT i.*
		FROM intervals i
		WHERE i.startoffset > p.endoffset
		ORDER BY i.endoffset, i.startoffset, i.id
		LIMIT 1
	) AS nxt ON true
)
SELECT *
FROM picked
```

Adapting for half-open ranges [s, e): replace `i2.startoffset > p.endoffset` with `i2.startoffset >= p.endoffset` (and same inside the subquery).

Per-group selection (one non-overlapping set per `group_id`) can be implemented by introducing `group_id` in the CTE state and scoping each step to the same group; for large data, consider splitting by group in separate runs.

## Practical tips

- Indices: consider adding indexes on (endoffset), (startoffset) or a composite index (endoffset, startoffset) to support the greedy selection efficiently; for the anti-join, (startoffset) and (endoffset) help range checks.
- Ties: when multiple intervals share the same `endoffset`, add a deterministic tie-breaker (e.g., `ORDER BY endoffset, startoffset, id`).
- Data hygiene: ensure `startoffset <= endoffset`. If not guaranteed, normalize or filter invalid rows before running the queries.

## DuckDB: notes and examples

The queries above are compatible with DuckDB. Below are DuckDB-specific notes and small examples showing how to run the anti-join, the greedy recursive CTE, and a window-based merge on inclusive `[startoffset, endoffset]` intervals.

- Anti-join (keep rows that do not overlap any other row):

```sql
-- DuckDB: returns intervals that do not overlap any other interval
SELECT i.*
FROM intervals i
WHERE NOT EXISTS (
	SELECT 1
	FROM intervals j
	WHERE j.id <> i.id
		AND j.startoffset <= i.endoffset
		AND i.startoffset <= j.endoffset
)
```

- Greedy interval scheduling using a recursive CTE (portable and works in DuckDB):

```sql
WITH RECURSIVE picked AS (
	-- seed: earliest-finishing interval overall
	SELECT i.id, i.startoffset, i.endoffset
	FROM intervals i
	ORDER BY i.endoffset, i.startoffset, i.id
	LIMIT 1
	UNION ALL
	-- step: pick the earliest-finishing interval that starts after the last finish
	SELECT i2.id, i2.startoffset, i2.endoffset
	FROM picked p
	JOIN intervals i2
		ON i2.startoffset > p.endoffset  -- strict > for inclusive ranges
	WHERE i2.endoffset = (
		SELECT MIN(i3.endoffset)
		FROM intervals i3
		WHERE i3.startoffset > p.endoffset
	)
)
SELECT * FROM picked
```

- Merge overlapping intervals per group using window functions (fast and idiomatic in DuckDB):

```sql
WITH ordered AS (
	SELECT *,
		LAG(endoffset) OVER (PARTITION BY group_id ORDER BY startoffset, endoffset) AS prev_end
	FROM intervals
),
flags AS (
	SELECT *,
		CASE WHEN prev_end IS NULL OR prev_end < startoffset THEN 1 ELSE 0 END AS new_group
	FROM ordered
),
grp AS (
	SELECT *,
		SUM(new_group) OVER (PARTITION BY group_id ORDER BY startoffset, endoffset ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS grp_no
	FROM flags
)
SELECT group_id, grp_no, MIN(startoffset) AS startoffset, MAX(endoffset) AS endoffset
FROM grp
GROUP BY group_id, grp_no
ORDER BY group_id, startoffset
```

Notes specific to DuckDB
- DuckDB supports WITH RECURSIVE, LATERAL (using CROSS JOIN LATERAL), window functions, and the standard SQL used above
- For large datasets, sort orders and partitioning matter; DuckDB is optimized for analytical workloads but consider adding explicit ORDER BY or filtering by group_id before the recursive step
- If you need deterministic tie-breaking, include `ORDER BY endoffset, startoffset, id` when selecting seeds or using LATERAL
- Ensure your data follows `startoffset <= endoffset`; if not, normalize with `LEAST`/`GREATEST` or a preprocess step

If you'd like, I can also add runnable DuckDB examples (CREATE TABLE, INSERT sample rows, and run the queries) to this file or a nearby `examples` file

