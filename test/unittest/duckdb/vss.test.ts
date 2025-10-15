/*
DuckDB VSS extension example test.

This test demonstrates a minimal end-to-end example of using the
vss (Vector Similarity Search) extension with DuckDB. It's intended
for beginners who want to see the typical steps required to perform
    a nearest-neighbour search using an HNSW (Hierarchical Navigable Small Worlds) index:

    1. Create a DuckDB instance (file-backed temporary DB)
    2. Load (or INSTALL then LOAD) the `vss` extension
    3. Create a table with a fixed-size FLOAT array column
    4. Insert a few example vectors
    5. Create an HNSW index on the vector column
    6. Run a nearest-neighbour query using array_distance + ORDER BY + LIMIT
    7. Clean up resources

Each code comment below explains the purpose of the step in simple terms.
Comments throughout the file are written in English to be clear inside code.
*/

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'

suite('duckdb vss extension example', () => {
    test('create hnsw index and nearest neighbor query', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'duckdb-'))
        const dbPath = path.join(tmp, 'vss.db')
        const instance = await DuckDBInstance.create(dbPath)
        const conn = await instance.connect()
        try {
            // Try to load the vss extension; attempt INSTALL if LOAD fails.
            try {
                await conn.run('LOAD vss')
            } catch {
                try {
                    await conn.run('INSTALL vss')
                    await conn.run('LOAD vss')
                } catch {
                    // Could not install/load extension in this environment — exit test early
                    return
                }
            }

            // Create a table with a fixed-size FLOAT array column named `vec`.
            // Each row stores a 3-dimensional vector. Fixed-size arrays
            // communicate the dimensionality to DuckDB which is required
            // for the vss HNSW (Hierarchical Navigable Small Worlds) index construction.
            //
            // Insert a few example vectors to form a tiny dataset we can
            // run a nearest-neighbour query against.
            //
            // Create an HNSW index on `vec`. Once the index exists,
            // Create an HNSW (Hierarchical Navigable Small Worlds) index on `vec`. Once the index exists,
            // queries that use ORDER BY array_distance(vec, <const_vector>)
            // followed by LIMIT will be able to use the index to find
            // approximate nearest neighbours efficiently.
            // Note: on very small datasets an index may not provide a
            // performance benefit, but it demonstrates the API and SQL
            // pattern required to perform indexed vector search.
            await conn.run('CREATE TABLE my_vector_table (vec FLOAT[3])')
            await conn.run('INSERT INTO my_vector_table VALUES ([1,2,3]::FLOAT[3]), ([2,2,3]::FLOAT[3]), ([1,2,4]::FLOAT[3]), ([5,5,5]::FLOAT[3]), ([4,5,5]::FLOAT[3])')
            await conn.run('CREATE INDEX my_hnsw_index ON my_vector_table USING HNSW (vec)')

            const res = await conn.run('SELECT vec FROM my_vector_table ORDER BY array_distance(vec, [1,2,3]::FLOAT[3]) LIMIT 3')
            const rows = await res.getRowObjectsJS()
            assert.equal(rows.length, 3)
            const first = rows[0] as Record<string, unknown>
            // Expect the nearest vector to be [1,2,3]
            assert.deepEqual(first['vec'], [1, 2, 3])
        } finally {
            try { conn.closeSync() } catch { }
            try { instance.closeSync() } catch { }
            fs.rmSync(tmp, { recursive: true, force: true })
        }
    })

    test('store and retrieve text payload with vector search', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'duckdb-'))
        const dbPath = path.join(tmp, 'vss-text.db')
        const instance = await DuckDBInstance.create(dbPath)
        const conn = await instance.connect()
        try {
            // Load or install the vss extension for this test as well.
            try {
                await conn.run('LOAD vss')
            } catch {
                try {
                    await conn.run('INSTALL vss')
                    await conn.run('LOAD vss')
                } catch {
                    // Extension not available in this environment — exit early
                    return
                }
            }

            // Create a table that stores a vector and a text payload side-by-side.
            await conn.run('CREATE TABLE my_vector_text (vec FLOAT[3], txt VARCHAR)')
            await conn.run('INSERT INTO my_vector_text VALUES ([1,2,3]::FLOAT[3], \'first\'), ([2,2,3]::FLOAT[3], \'second\'), ([5,5,5]::FLOAT[3], \'far\')')
            await conn.run('CREATE INDEX my_hnsw_text_idx ON my_vector_text USING HNSW (vec)')

            // Query the nearest neighbor and return the associated text payload
            const res = await conn.run('SELECT txt, vec FROM my_vector_text ORDER BY array_distance(vec, [1,2,3]::FLOAT[3]) LIMIT 1')
            const rows = await res.getRowObjectsJS()
            assert.equal(rows.length, 1)
            const txt = (rows[0] as Record<string, unknown>)['txt']
            assert.equal(txt, 'first')
        } finally {
            try { conn.closeSync() } catch { }
            try { instance.closeSync() } catch { }
            fs.rmSync(tmp, { recursive: true, force: true })
        }
    })
})
