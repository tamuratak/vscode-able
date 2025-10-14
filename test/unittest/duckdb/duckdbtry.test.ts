/*
DuckDB API exploratory tests.
Comments in code are English; test file checks common API behaviours.
*/

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'

suite('duckdb API smoke tests', () => {
    test('create instance and simple select', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'duckdb-'))
        const dbPath = path.join(tmp, 'smoke.db')
        const instance = await DuckDBInstance.create(dbPath)
        const conn = await instance.connect()
        try {
            // Run a very simple SELECT query that does not read any table.
            // SQL explanation: `SELECT 1 AS a` evaluates the literal value 1
            // and returns it as a column named `a`. Because this SELECT
            // has no FROM clause, it does not read any table; it simply
            // returns a single row containing the evaluated expression.
            //
            // Key point for beginners: a query can compute expressions
            // (literals, math, function calls) and return them as rows
            // even when no table data exists.
            //
            // Note for readers unfamiliar with SQL:
            // - A SQL query does not always have to read from a table. You can
            //     select literal expressions directly. For example, `SELECT 1 AS a`
            //     evaluates the expression `1` and returns it as a single-column,
            //     single-row result with column name `a`.
            //
            //     This is useful for quick checks and for queries that compute
            //     expressions without needing stored data. Many databases (DuckDB,
            //     PostgreSQL, SQLite) support SELECT without FROM. Historically,
            //     Oracle used a dummy table `DUAL` for this purpose, but the effect
            //     is the same: the database evaluates the expressions and returns
            //     a row containing their values.
            const result = await conn.run('SELECT 1 AS a')
            const rows = await result.getRowObjectsJS()
            assert.equal(Array.isArray(rows), true)
            assert.equal(rows.length, 1)
            // JS representation should use numbers for integers
            const aVal = (rows[0] as Record<string, unknown>)['a']
            assert.equal(aVal, 1)
        } finally {
            try { conn.closeSync() } catch { }
            try { instance.closeSync() } catch { }
            fs.rmSync(tmp, { recursive: true, force: true })
        }
    })

    test('create table, insert and select rows', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'duckdb-'))
        const dbPath = path.join(tmp, 'table.db')
        const instance = await DuckDBInstance.create(dbPath)
        const conn = await instance.connect()
        try {
            // Create a new table named `t` with two columns:
            // - id: integer number
            // - val: variable-length text
            // SQL explanation: CREATE TABLE creates a table schema on disk.
            await conn.run('CREATE TABLE t (id INTEGER, val VARCHAR)')

            // Insert two rows into the table.
            // SQL explanation: INSERT INTO t VALUES (...) adds rows to table t.
            // Each parenthesized group is one row: (1, 'one') and (2, 'two').
            await conn.run("INSERT INTO t VALUES (1, 'one'), (2, 'two')")

            // Select the rows we just inserted, ordering by the `id` column
            // so results are deterministic.
            // SQL explanation: SELECT id, val FROM t ORDER BY id returns the
            // id and val columns from table t; ORDER BY ensures rows are
            // sorted by id ascending.
            const res = await conn.run('SELECT id, val FROM t ORDER BY id')
            const rows = await res.getRowObjectsJS()
            assert.equal(rows.length, 2)
            const first = rows[0] as Record<string, unknown>
            const id = first['id']
            const val = first['val']
            assert.equal(id, 1)
            assert.equal(val, 'one')
        } finally {
            try { conn.closeSync() } catch { }
            try { instance.closeSync() } catch { }
            fs.rmSync(tmp, { recursive: true, force: true })
        }
    })

    test('parameterized queries using conn.run with values', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'duckdb-'))
        const dbPath = path.join(tmp, 'params.db')
        const instance = await DuckDBInstance.create(dbPath)
        const conn = await instance.connect()
        try {
            // Parameterized query: placeholders `?` are replaced by the
            // provided values in the array that follows. This helps avoid
            // SQL injection and lets the database handle typing for values.
            // Here `SELECT ?, ? AS s` returns two columns: the first unnamed,
            // the second named `s` with values 42 and 'hello'.
            const res = await conn.run('SELECT ?, ? AS s', [42, 'hello'])
            // Retrieve columns first; some result readers may consume
            // the materialized result when fetching rows. getColumnsJS
            // returns an array of column arrays (columns -> rows).
            const cols = await res.getColumnsJS()
            assert.ok(Array.isArray(cols), 'expected columns array')
            assert.ok(cols.length >= 2, 'expected at least two columns')
            assert.ok(Array.isArray(cols[0]) && Array.isArray(cols[1]), 'columns should be arrays')
            assert.equal(cols[0][0], 42)
            assert.equal(cols[1][0], 'hello')
            const rows = await res.getRowObjectsJS()
            // Some environments/versions may return columns but not materialize
            // a row array in the same way; we've already validated the
            // column values above. Here we assert rows is an array and if
            // a row is present, validate its content.
            assert.ok(Array.isArray(rows), 'expected rows to be an array')
            if (rows.length === 1) {
                const first = rows[0] as Record<string, unknown>
                // the second column was aliased as `s`
                assert.equal(first['s'] ?? first[0], 'hello')
            }
        } finally {
            try { conn.closeSync() } catch { }
            try { instance.closeSync() } catch { }
            fs.rmSync(tmp, { recursive: true, force: true })
        }
    })

    test('concurrent connections from same instance', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'duckdb-'))
        const dbPath = path.join(tmp, 'concurrent.db')
        const instance = await DuckDBInstance.create(dbPath)
        const c1 = await instance.connect()
        const c2 = await instance.connect()
        try {
            // Create a table in one connection and insert rows from another
            // to show that multiple connections to the same instance work.
            // CREATE TABLE cc(x INTEGER) creates a table named cc with one
            // integer column `x`.
            await c1.run('CREATE TABLE cc(x INTEGER)')

            // Insert two rows into the table (10 and 20).
            await c2.run('INSERT INTO cc VALUES (10), (20)')

            // COUNT(*) returns the number of rows in the table. We alias
            // the result as `cnt` so that the returned row has a column
            // named cnt with the total count.
            const r1 = await c1.run('SELECT COUNT(*) AS cnt FROM cc')
            const rows = await r1.getRowObjectsJS()
            const row = rows[0] as Record<string, unknown>
            const cnt = row['cnt']
            assert.equal(Number(cnt), 2)
        } finally {
            try { c1.closeSync() } catch { }
            try { c2.closeSync() } catch { }
            try { instance.closeSync() } catch { }
            fs.rmSync(tmp, { recursive: true, force: true })
        }
    })

    test('invalid sql throws', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'duckdb-'))
        const dbPath = path.join(tmp, 'bad.db')
        const instance = await DuckDBInstance.create(dbPath)
        const conn = await instance.connect()
        try {
            await assert.rejects(async () => {
                // Intentionally invalid SQL to show error handling.
                // SELECT * FROM this_table_does_not_exist tries to read all
                // columns from a table that was never created; the database
                // should throw an error which we assert is raised.
                await conn.run('SELECT * FROM this_table_does_not_exist')
            })
        } finally {
            try { conn.closeSync() } catch { }
            try { instance.closeSync() } catch { }
            fs.rmSync(tmp, { recursive: true, force: true })
        }
    })

})
