#!/usr/bin/env node
/**
 * Register the Chatwoot community nodes in an EXISTING node database (fork-specific).
 *
 * `npm run rebuild` registers them as part of a full rebuild. Use this script when data/nodes.db came from
 * upstream (sync) or the Chatwoot snapshot was regenerated, without rebuilding every n8n node:
 *   npm run build && npm run register:chatwoot            # NODE_DB_PATH defaults to ./data/nodes.db
 *
 * Atomically replaces previous @renatoascencio/n8n-nodes-chatwoot definitions (main node, Tool variant,
 * trigger), retaining fetched README data and removing obsolete node types, then rebuilds the FTS5 index
 * when present. Databases with FTS5 require better-sqlite3; the sql.js fallback cannot update that index.
 */
import { statSync } from 'fs';
import { createDatabaseAdapter, DatabaseAdapter } from '../database/database-adapter';
import { NodeRepository } from '../database/node-repository';
import {
  CHATWOOT_CATALOG_NODES,
  CHATWOOT_PACKAGE_NAME,
  CHATWOOT_PACKAGE_VERSION,
  registerChatwootNodes,
} from '../integrations/chatwoot/chatwoot-node-catalog';

export function refreshChatwootNodes(db: DatabaseAdapter): { count: number; replaced: number } {
  const hasFTS = Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'nodes_fts'").get());
  if (hasFTS && !db.checkFTS5Support()) {
    throw new Error('This database uses FTS5. Install a working better-sqlite3 build before registering Chatwoot nodes.');
  }
  return db.transaction(() => {
    const pattern = `${CHATWOOT_PACKAGE_NAME}.%`;
    const replaced = (db.prepare('SELECT COUNT(*) AS count FROM nodes WHERE node_type LIKE ?').get(pattern) as {
      count: number;
    }).count;
    // Let saveNode retain fetched README and AI documentation for existing current node types.
    const currentTypes = CHATWOOT_CATALOG_NODES.map((node) => node.nodeType);
    db.prepare(`DELETE FROM nodes WHERE node_type LIKE ? AND node_type NOT IN (${currentTypes.map(() => '?').join(', ')})`)
      .run(pattern, ...currentTypes);
    const repository = new NodeRepository(db);
    const count = registerChatwootNodes(repository);

    if (hasFTS) {
      db.prepare("INSERT INTO nodes_fts(nodes_fts) VALUES('rebuild')").run();
    }
    return { count, replaced };
  });
}

async function main(): Promise<void> {
  const dbPath = process.env.NODE_DB_PATH || './data/nodes.db';
  // This command updates an existing catalog; a typo must not create an empty database.
  if (!statSync(dbPath).isFile()) throw new Error(`Expected an existing node database at ${dbPath}`);
  const db = await createDatabaseAdapter(dbPath);
  try {
    const { count, replaced } = refreshChatwootNodes(db);
    console.log(
      `Registered ${count} Chatwoot nodes (${CHATWOOT_PACKAGE_NAME}@${CHATWOOT_PACKAGE_VERSION}) in ${dbPath}; ` +
        `replaced ${replaced} previous rows: ${CHATWOOT_CATALOG_NODES.map((n) => n.nodeType).join(', ')}`,
    );
  } finally {
    db.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Could not register the Chatwoot nodes:', (error as Error).message);
    process.exit(1);
  });
}
