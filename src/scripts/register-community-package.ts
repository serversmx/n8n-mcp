#!/usr/bin/env node
/**
 * Register a BUILT community node package in an EXISTING node database (fork-specific).
 *
 * Generic counterpart of register-chatwoot-nodes.ts for packages without a hand-curated catalog (for example
 * @renatoascencio/n8n-nodes-evolution-api). It reads the files listed in the package's `n8n.nodes`, parses
 * every node with the same NodeParser used for core nodes, adds the AI Agent Tool variant when the node sets
 * `usableAsTool`, and atomically replaces the package's previous rows (retaining fetched README data).
 *
 *   npm run build && npm run register:community -- --package <built package root> \
 *     [--author-name "Renato Ascencio"] [--author-github-url https://github.com/RenatoAscencio] [--db ./data/nodes.db]
 *
 * The package root must contain dist/ and its dependencies (n8n-workflow...) must be resolvable from it or
 * through NODE_PATH. Databases with FTS5 require better-sqlite3 (the sql.js fallback cannot update that index).
 */
import * as fs from 'fs';
import * as path from 'path';
import { createDatabaseAdapter, DatabaseAdapter } from '../database/database-adapter';
import { NodeRepository, type CommunityNodeFields } from '../database/node-repository';
import { NodeParser, type ParsedNode } from '../parsers/node-parser';
import { ToolVariantGenerator } from '../services/tool-variant-generator';

export interface CommunityPackageArgs {
  packageRoot: string;
  authorName?: string;
  authorGithubUrl?: string;
  db: string;
}

export interface CommunityPackageNodes {
  packageName: string;
  packageVersion: string;
  nodes: Array<ParsedNode & CommunityNodeFields>;
}

export function parseArgs(argv: string[]): CommunityPackageArgs {
  const args: Partial<CommunityPackageArgs> = { db: process.env.NODE_DB_PATH || './data/nodes.db' };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!['--package', '--author-name', '--author-github-url', '--db'].includes(flag)) {
      throw new Error(`Unknown argument: ${flag}`);
    }
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    if (flag === '--package') args.packageRoot = value;
    else if (flag === '--author-name') args.authorName = value;
    else if (flag === '--author-github-url') args.authorGithubUrl = value;
    else args.db = value;
  }
  if (!args.packageRoot) throw new Error('Missing --package <path to the built community package root>');
  return args as CommunityPackageArgs;
}

/** Return the first exported class of a compiled node module. */
function loadExportedClass(file: string): new () => any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(file);
  const exported = Object.values(mod).find((value) => typeof value === 'function');
  if (!exported) throw new Error(`No exported class in ${file}`);
  return exported as new () => any;
}

function readCodexCategory(nodeFile: string): string | undefined {
  const codexFile = nodeFile.replace(/\.js$/, '.json');
  if (!fs.existsSync(codexFile)) return undefined;
  const codex = JSON.parse(fs.readFileSync(codexFile, 'utf8'));
  return Array.isArray(codex.categories) ? codex.categories[0] : undefined;
}

export function buildCommunityPackageNodes(
  args: Pick<CommunityPackageArgs, 'packageRoot' | 'authorName' | 'authorGithubUrl'>,
): CommunityPackageNodes {
  const root = path.resolve(args.packageRoot);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const packageName: string = pkg.name;
  const nodeFiles: string[] = pkg.n8n?.nodes ?? [];
  if (nodeFiles.length === 0) throw new Error(`${packageName} declares no n8n.nodes`);

  const community: CommunityNodeFields = {
    isCommunity: true,
    isVerified: false,
    authorName: args.authorName,
    authorGithubUrl: args.authorGithubUrl,
    npmPackageName: packageName,
    npmVersion: pkg.version,
  };

  const parser = new NodeParser();
  const toolGenerator = new ToolVariantGenerator();
  const nodes: CommunityPackageNodes['nodes'] = [];
  for (const relative of nodeFiles) {
    const file = path.join(root, relative);
    const NodeClass = loadExportedClass(file);
    const description = new NodeClass().description;
    const usableAsTool = Boolean(description.usableAsTool);
    const parsed = parser.parse(NodeClass as any, packageName);
    const main: ParsedNode & CommunityNodeFields = {
      ...parsed,
      // NodeParser prefixes core packages; installed community nodes are `<npm package>.<name>`
      nodeType: `${packageName}.${description.name}`,
      category: readCodexCategory(file) ?? parsed.category ?? 'Communication',
      // n8n only creates the "<name>Tool" variant when the description sets usableAsTool
      isAITool: usableAsTool,
      hasToolVariant: usableAsTool && !parsed.isTrigger,
      packageName,
      ...community,
    };
    nodes.push(main);
    if (main.hasToolVariant) {
      const tool = toolGenerator.generateToolVariant(main);
      if (tool) nodes.push({ ...tool, ...community });
    }
  }
  return { packageName, packageVersion: pkg.version, nodes };
}

export function registerCommunityPackage(
  db: DatabaseAdapter,
  catalog: CommunityPackageNodes,
): { count: number; replaced: number } {
  const hasFTS = Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'nodes_fts'").get());
  if (hasFTS && !db.checkFTS5Support()) {
    throw new Error('This database uses FTS5. Install a working better-sqlite3 build before registering nodes.');
  }
  return db.transaction(() => {
    const pattern = `${catalog.packageName}.%`;
    const replaced = (db.prepare('SELECT COUNT(*) AS count FROM nodes WHERE node_type LIKE ?').get(pattern) as {
      count: number;
    }).count;
    // Let saveNode retain fetched README and AI documentation for existing current node types.
    const currentTypes = catalog.nodes.map((node) => node.nodeType);
    db.prepare(`DELETE FROM nodes WHERE node_type LIKE ? AND node_type NOT IN (${currentTypes.map(() => '?').join(', ')})`)
      .run(pattern, ...currentTypes);
    const repository = new NodeRepository(db);
    for (const node of catalog.nodes) repository.saveNode(node);

    if (hasFTS) {
      db.prepare("INSERT INTO nodes_fts(nodes_fts) VALUES('rebuild')").run();
    }
    return { count: catalog.nodes.length, replaced };
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  // This command updates an existing catalog; a typo must not create an empty database.
  if (!fs.statSync(args.db).isFile()) throw new Error(`Expected an existing node database at ${args.db}`);
  const catalog = buildCommunityPackageNodes(args);
  const db = await createDatabaseAdapter(args.db);
  try {
    const { count, replaced } = registerCommunityPackage(db, catalog);
    console.log(
      `Registered ${count} nodes (${catalog.packageName}@${catalog.packageVersion}) in ${args.db}; ` +
        `replaced ${replaced} previous rows: ${catalog.nodes.map((n) => n.nodeType).join(', ')}`,
    );
  } finally {
    db.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
