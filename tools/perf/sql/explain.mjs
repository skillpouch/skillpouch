// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Generic-plans every statement pg_stat_statements has seen against the
 * seeded perf database and lists full scans of large tables. Set
 * EXPLAIN_AS_TENANT=1 to plan as sp_app with row-level security applied.
 */
import pg from 'pg';
const stats = new pg.Client({
	connectionString:
		process.env.STATS_URL ?? 'postgres://postgres:postgres@localhost:55432/postgres',
});
const perf = new pg.Client({
	connectionString:
		process.env.PERF_URL ?? 'postgres://postgres:postgres@localhost:55432/sp_perf',
});
await stats.connect();
await perf.connect();
const { rows } = await stats.query(`SELECT query, sum(calls)::int calls FROM pg_stat_statements
 WHERE query ~* '^\\s*(select|update|delete|insert|with)' AND query !~* '(pg_catalog|information_schema|schema_migrations|pg_roles|pgboss|pg_stat|pg_database|sp_template|pg_notify|pg_advisory|set_config\\(|now\\(\\)\\s*$)'
 GROUP BY query`);
const big = new Set(
	(
		await perf.query(`SELECT relname FROM pg_class WHERE relkind='r' AND reltuples > 30000`)
	).rows.map((r) => r.relname),
);
const findings = [];
function walk(node, out) {
	if (node['Node Type'] === 'Seq Scan' && big.has(node['Relation Name']))
		out.push(
			`SeqScan ${node['Relation Name']} (rows~${node['Plan Rows']}) filter=${node.Filter ?? ''}`,
		);
	for (const child of node.Plans ?? []) walk(child, out);
}
let failed = 0;
for (const { query, calls } of rows) {
	try {
		await perf.query('BEGIN');
		if (process.env.EXPLAIN_AS_TENANT) {
			await perf.query('SET LOCAL ROLE sp_app');
			await perf.query(
				"SELECT set_config('app.sa_id', md5('sa777')::uuid::text, true), set_config('app.share_id', '', true)",
			);
		}
		const res = await perf.query(`EXPLAIN (GENERIC_PLAN, FORMAT JSON) ${query}`);
		const plan = res.rows[0]['QUERY PLAN'][0];
		const out = [];
		walk(plan.Plan, out);
		if (out.length)
			findings.push({
				cost: plan.Plan['Total Cost'],
				calls,
				query: query.replace(/\s+/g, ' ').slice(0, 400),
				out,
			});
	} catch (e) {
		failed++;
	} finally {
		await perf.query('ROLLBACK');
	}
}
findings.sort((a, b) => b.cost - a.cost);
for (const f of findings)
	console.log(
		`\n[cost ${Math.round(f.cost)} calls ${f.calls}] ${f.query}\n   ${[...new Set(f.out)].join('\n   ')}`,
	);
console.log(
	`\n${rows.length} queries, ${findings.length} with big seq scans, ${failed} not explainable`,
);
await stats.end();
await perf.end();
