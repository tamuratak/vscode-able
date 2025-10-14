
/*
CLI for running SQL against a DuckDB file using @duckdb/node-api
This script exposes runCli(args) for tests and can be executed directly.
*/

import fs from 'fs'
import fsPromises from 'fs/promises'
import path from 'path'

// Import the DuckDB Node API as a namespace
import { DuckDBInstance } from '@duckdb/node-api'
import type { DuckDBConnection, JS } from '@duckdb/node-api'

type Row = Record<string, JS>

type Format = 'table' | 'json' | 'csv'

// Parse simple argv style options
function parseArgs(argv: string[]) {
	const opts: { db?: string, file?: string, sql?: string, format?: Format, limit?: number, stream?: boolean } = {}
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]
		if (a === '--db') {
			opts.db = argv[++i]
			continue
		}
		if (a === '--file') {
			opts.file = argv[++i]
			continue
		}
		if (a === '--sql') {
			opts.sql = argv[++i]
			continue
		}
		if (a === '--format') {
			const f = argv[++i]
			if (f === 'table' || f === 'json' || f === 'csv') {
				opts.format = f
			}
			continue
		}
		if (a === '--limit') {
			opts.limit = Number(argv[++i])
			continue
		}
		if (a === '--stream') {
			opts.stream = true
			continue
		}
	}
	return opts
}

function ensureDirForFile(filepath: string) {
	const dir = path.dirname(filepath)
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true })
	}
}

async function allAsync(conn: DuckDBConnection, sql: string): Promise<Row[]> {
	// Use the modern async API on DuckDBConnection
	const result = await conn.run(sql)
	// DuckDBResult provides getRowObjectsJS which returns Promise<Record<string, JS>[]>
	const rows = await result.getRowObjectsJS()
	return rows
}

function formatCsv(rows: Row[]) {
	if (rows.length === 0) {
		return ''
	}
	const keys = Object.keys(rows[0])
	const lines = [keys.join(',')]
	for (const r of rows) {
		const vals = keys.map(k => {
			const v = r[k]
			if (v === null || v === undefined) return ''
			const s = String(v)
			if (s.includes(',') || s.includes('"') || s.includes('\n')) {
				return '"' + s.replace(/"/g, '""') + '"'
			}
			return s
		})
		lines.push(vals.join(','))
	}
	return lines.join('\n')
}

export async function runCli(cliArgs: string[]) {
	const opts = parseArgs(cliArgs)
	const dbPath = opts.db ?? './data/duckdb.db' // assumption: default path when not provided
	if (!opts.file && !opts.sql) {
		console.error('Either --file <sqlfile> or --sql "..." must be provided')
		return 2
	}
	let sql = opts.sql ?? ''
	if (opts.file) {
		try {
			sql = await fsPromises.readFile(opts.file, { encoding: 'utf8' })
		} catch (err) {
			console.error('Failed to read SQL file', String(err))
			return 3
		}
	}

	ensureDirForFile(dbPath)

	// create database instance and connection (async API)
	const instance = await DuckDBInstance.create(dbPath)
	const conn = await instance.connect()

	try {
		const rows = await allAsync(conn, sql)
		const limited = (typeof opts.limit === 'number') ? rows.slice(0, opts.limit) : rows
		const format = opts.format ?? 'table'
		if (format === 'json') {
			console.log(JSON.stringify(limited, null, 2))
		} else if (format === 'csv') {
			console.log(formatCsv(limited))
		} else {
			// table
			// console.table is convenient for humans
			// but to keep behaviour deterministic we convert to plain objects
			console.table(limited)
		}
			// close connection and instance
			try {
				conn.closeSync()
			} catch {}
			try {
				instance.closeSync()
			} catch {}
		return 0
	} catch (err) {
		console.error('Query failed:', String(err))
		try {
				conn.closeSync()
				instance.closeSync()
		} catch {}
		return 4
	}
}

// If executed directly, run with process.argv
if (require.main === module) {
	runCli(process.argv.slice(2)).then(code => process.exit(code)).catch(err => {
		console.error(err)
		process.exit(1)
	})
}
