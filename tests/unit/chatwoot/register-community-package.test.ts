import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildCommunityPackageNodes,
  parseArgs,
  registerCommunityPackage,
} from '@/scripts/register-community-package';
import { createTestDatabase, TestDatabase } from '@tests/utils/database-utils';

vi.mock('@/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const PACKAGE_NAME = '@example/n8n-nodes-widgets';

describe('register-community-package', () => {
  let packageRoot: string;
  let database: TestDatabase;

  function writeNode(filename: string, description: object): void {
    fs.writeFileSync(
      path.join(packageRoot, filename),
      `module.exports = { Fixture: class Fixture { constructor() { this.description = ${JSON.stringify(description)}; } } };`,
    );
  }

  function writePackage(version: string, nodeFiles: string[]): void {
    fs.writeFileSync(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({ name: PACKAGE_NAME, version, n8n: { nodes: nodeFiles } }),
    );
  }

  beforeEach(async () => {
    packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'community-package-test-'));
    database = await createTestDatabase();
    writeNode('Widget.node.js', {
      name: 'widget', displayName: 'Widget', group: ['transform'], version: 1,
      inputs: ['main'], outputs: ['main'], usableAsTool: true,
      properties: [{ name: 'operation', type: 'options', default: 'get', options: [{ name: 'Get', value: 'get' }] }],
    });
    writeNode('WidgetTrigger.node.js', {
      name: 'widgetTrigger', displayName: 'Widget Trigger', group: ['trigger'], version: 1,
      inputs: [], outputs: ['main'], webhooks: [{ name: 'default' }], usableAsTool: true,
      properties: [],
    });
    writePackage('1.2.0', ['Widget.node.js', 'WidgetTrigger.node.js']);
  });

  afterEach(async () => {
    fs.rmSync(packageRoot, { recursive: true, force: true });
    await database.cleanup();
  });

  it('builds community entries with a Tool variant for tool-capable nodes but never for triggers', () => {
    const catalog = buildCommunityPackageNodes({ packageRoot, authorName: 'Example Dev' });

    expect(catalog.packageName).toBe(PACKAGE_NAME);
    expect(catalog.nodes.map((n) => n.nodeType)).toEqual([
      `${PACKAGE_NAME}.widget`,
      `${PACKAGE_NAME}.widgetTool`,
      `${PACKAGE_NAME}.widgetTrigger`,
    ]);
    for (const node of catalog.nodes) {
      expect(node).toMatchObject({ isCommunity: true, isVerified: false, npmPackageName: PACKAGE_NAME, npmVersion: '1.2.0' });
    }
  });

  it('registers the nodes, replaces previous rows, keeps fetched docs and leaves other packages intact', () => {
    database.adapter.prepare(`INSERT INTO nodes (node_type, package_name, display_name, npm_readme)
      VALUES (?, ?, 'Old widget', 'Fetched README')`).run(`${PACKAGE_NAME}.widget`, PACKAGE_NAME);
    database.adapter.prepare(`INSERT INTO nodes (node_type, package_name, display_name)
      VALUES (?, ?, 'Obsolete')`).run(`${PACKAGE_NAME}.obsolete`, PACKAGE_NAME);
    database.adapter.prepare(`INSERT INTO nodes (node_type, package_name, display_name)
      VALUES ('nodes-base.unrelated', 'n8n-nodes-base', 'Unrelated')`).run();

    const result = registerCommunityPackage(database.adapter, buildCommunityPackageNodes({ packageRoot }));

    expect(result).toEqual({ count: 3, replaced: 2 });
    const widget = database.adapter.prepare('SELECT npm_version, npm_readme FROM nodes WHERE node_type = ?').get(`${PACKAGE_NAME}.widget`);
    expect(widget).toEqual({ npm_version: '1.2.0', npm_readme: 'Fetched README' });
    expect(database.nodeRepository.getNode(`${PACKAGE_NAME}.widgetTool`)).toMatchObject({ isToolVariant: true });
    expect(database.nodeRepository.getNode(`${PACKAGE_NAME}.widgetTrigger`)).toMatchObject({ isTrigger: true });
    expect(database.nodeRepository.getNode(`${PACKAGE_NAME}.obsolete`)).toBeNull();
    expect(database.nodeRepository.getNode('nodes-base.unrelated')).not.toBeNull();
  });

  it('rejects a package without n8n.nodes', () => {
    writePackage('1.0.0', []);
    expect(() => buildCommunityPackageNodes({ packageRoot })).toThrow('declares no n8n.nodes');
  });

  it('parses arguments and rejects unknown or incomplete flags', () => {
    expect(parseArgs(['--package', '/tmp/pkg', '--author-name', 'A', '--db', '/tmp/x.db']))
      .toMatchObject({ packageRoot: '/tmp/pkg', authorName: 'A', db: '/tmp/x.db' });
    expect(() => parseArgs([])).toThrow('Missing --package');
    expect(() => parseArgs(['--bogus', 'x'])).toThrow('Unknown argument');
    expect(() => parseArgs(['--package'])).toThrow('Missing value');
  });
});
