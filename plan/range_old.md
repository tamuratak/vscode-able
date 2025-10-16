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
