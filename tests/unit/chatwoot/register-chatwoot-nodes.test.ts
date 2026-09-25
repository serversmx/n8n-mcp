import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshChatwootNodes } from '@/scripts/register-chatwoot-nodes';
import { CHATWOOT_NODE_TYPES, CHATWOOT_PACKAGE_NAME } from '@/integrations/chatwoot/chatwoot-node-catalog';
import { createTestDatabase, TestDatabase } from '@tests/utils/database-utils';

vi.mock('@/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

describe('refreshChatwootNodes', () => {
  let database: TestDatabase;

  beforeEach(async () => { database = await createTestDatabase(); });
  afterEach(async () => { await database.cleanup(); });

  function seedPreviousCatalog() {
    database.adapter.prepare(`INSERT INTO nodes (node_type, package_name, display_name, npm_version, npm_readme)
      VALUES (?, ?, 'Old Chatwoot', '0.8.0', 'Fetched README')`)
      .run(CHATWOOT_NODE_TYPES.main, CHATWOOT_PACKAGE_NAME);
    database.adapter.prepare(`INSERT INTO nodes (node_type, package_name, display_name)
      VALUES (?, ?, 'Obsolete node')`).run(`${CHATWOOT_PACKAGE_NAME}.obsolete`, CHATWOOT_PACKAGE_NAME);
    database.adapter.prepare(`INSERT INTO nodes (node_type, package_name, display_name)
      VALUES ('nodes-base.unrelated', 'n8n-nodes-base', 'Unrelated node')`).run();
  }

  it('refreshes current definitions, preserves fetched docs, removes obsolete nodes, and leaves other packages intact', () => {
    seedPreviousCatalog();

    expect(refreshChatwootNodes(database.adapter)).toEqual({ count: 3, replaced: 2 });

    const main = database.adapter.prepare('SELECT npm_version, npm_readme FROM nodes WHERE node_type = ?').get(CHATWOOT_NODE_TYPES.main);
    expect(main).toEqual({ npm_version: '0.9.0', npm_readme: 'Fetched README' });
    expect(database.nodeRepository.getNode(CHATWOOT_NODE_TYPES.tool)).toMatchObject({ isToolVariant: true });
    expect(database.nodeRepository.getNode(CHATWOOT_NODE_TYPES.trigger)).toMatchObject({ isTrigger: true });
    expect(database.nodeRepository.getNode(`${CHATWOOT_PACKAGE_NAME}.obsolete`)).toBeNull();
    expect(database.nodeRepository.getNode('nodes-base.unrelated')).not.toBeNull();
    expect(refreshChatwootNodes(database.adapter)).toEqual({ count: 3, replaced: 3 });
  });

  it('rolls back replacements and obsolete-node deletion if any registration fails', () => {
    seedPreviousCatalog();
    database.adapter.exec(`CREATE TRIGGER reject_chatwoot_trigger BEFORE INSERT ON nodes
      WHEN NEW.node_type = '${CHATWOOT_NODE_TYPES.trigger}'
      BEGIN SELECT RAISE(ABORT, 'registration failed'); END;`);

    expect(() => refreshChatwootNodes(database.adapter)).toThrow('registration failed');

    const main = database.adapter.prepare('SELECT npm_version, display_name FROM nodes WHERE node_type = ?').get(CHATWOOT_NODE_TYPES.main);
    expect(main).toEqual({ npm_version: '0.8.0', display_name: 'Old Chatwoot' });
    expect(database.nodeRepository.getNode(`${CHATWOOT_PACKAGE_NAME}.obsolete`)).not.toBeNull();
    expect(database.nodeRepository.getNode(CHATWOOT_NODE_TYPES.tool)).toBeNull();
  });
});
