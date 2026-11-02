#!/usr/bin/env node

/**
 * Sanity gate for a rebuilt data/nodes.db (fork-specific). Fails when the rebuild lost something the deployed
 * image depends on: community nodes, templates, the fork's own packages or the core node documentation.
 *
 *   node scripts/verify-nodes-db.js [--db ./data/nodes.db]
 *
 * The minimums sit below today's values (core docs 750, community 2300, templates 2300) so normal drift passes.
 */

const Database = require('better-sqlite3');

const FORK_PACKAGES = {
  '@renatoascencio/n8n-nodes-chatwoot': 3,
  '@renatoascencio/n8n-nodes-evolution-api': 3
};
const MIN = { coreNodes: 800, coreWithDocs: 650, community: 2300, templates: 2300 };

const dbIndex = process.argv.indexOf('--db');
const dbPath = dbIndex > -1 ? process.argv[dbIndex + 1] : './data/nodes.db';
const db = new Database(dbPath, { readonly: true });
const count = (sql, ...params) => db.prepare(sql).pluck().get(...params);

const checks = [
  ['integrity_check', db.pragma('integrity_check', { simple: true }) === 'ok'],
  ['core nodes', count('SELECT COUNT(*) FROM nodes WHERE is_community = 0 OR is_community IS NULL') >= MIN.coreNodes],
  [
    'core nodes with documentation',
    count("SELECT COUNT(*) FROM nodes WHERE (is_community = 0 OR is_community IS NULL) AND documentation <> ''") >= MIN.coreWithDocs
  ],
  ['community nodes', count('SELECT COUNT(*) FROM nodes WHERE is_community = 1') >= MIN.community],
  ['templates', count('SELECT COUNT(*) FROM templates') >= MIN.templates],
  ['FTS index', count("SELECT COUNT(*) FROM nodes_fts WHERE nodes_fts MATCH 'webhook'") > 0]
];
for (const [pkg, expected] of Object.entries(FORK_PACKAGES)) {
  checks.push([`${pkg} (${expected} nodes)`, count('SELECT COUNT(*) FROM nodes WHERE package_name = ?', pkg) === expected]);
}

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}
process.exit(failed ? 1 : 0);
