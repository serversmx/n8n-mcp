#!/usr/bin/env node
/**
 * Generate the Chatwoot node snapshot (fork-specific).
 *
 * Reads the BUILT @renatoascencio/n8n-nodes-chatwoot package (the files listed in its package.json
 * `n8n.nodes` / `n8n.credentials`), parses every node with the same NodeParser used for core nodes and
 * writes src/integrations/chatwoot/chatwoot-node-snapshot.json. chatwoot-node-catalog.ts derives the
 * MCP catalog (resources, operations, parameters, trigger events, credentials) from that snapshot, so the
 * catalog never drifts from the node again: regenerate it on every node release.
 *
 * Usage (from the n8n-mcp root):
 *   npx ts-node --transpile-only src/scripts/generate-chatwoot-catalog.ts \
 *     --package <path to the n8n-nodes-chatwoot package root, built: dist/ present> \
 *     [--version 0.9.0] [--source "n8n-nodes-chatwoot@<git ref>"] [--out <file>] [--check]
 *
 * The package's own dependencies (n8n-workflow...) must be resolvable from its directory
 * (its node_modules) or through NODE_PATH.
 * See docs/CHATWOOT_CATALOG.md for the pinned source and reproducibility check.
 */
import * as fs from 'fs';
import * as path from 'path';
import { NodeParser } from '../parsers/node-parser';

const DEFAULT_OUT = path.join(__dirname, '../../src/integrations/chatwoot/chatwoot-node-snapshot.json');

export interface ChatwootCatalogArgs {
  packageRoot: string;
  version?: string;
  source?: string;
  out: string;
  check: boolean;
}

export function parseArgs(argv: string[]): ChatwootCatalogArgs {
  const args: Partial<ChatwootCatalogArgs> = { out: DEFAULT_OUT, check: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--check') {
      args.check = true;
      continue;
    }
    if (!['--package', '--version', '--source', '--out'].includes(flag)) {
      throw new Error(`Unknown argument: ${flag}`);
    }
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    if (flag === '--package') args.packageRoot = value;
    else if (flag === '--version') args.version = value;
    else if (flag === '--source') args.source = value;
    else if (flag === '--out') args.out = value;
    i++;
  }
  if (!args.packageRoot) {
    throw new Error('Missing --package <path to the built n8n-nodes-chatwoot package root>');
  }
  return args as ChatwootCatalogArgs;
}

/** Return the first exported class of a compiled node/credential module. */
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

export function generateChatwootSnapshot(args: Pick<ChatwootCatalogArgs, 'packageRoot' | 'version' | 'source'>) {
  const root = path.resolve(args.packageRoot);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const packageName: string = pkg.name;
  if (packageName !== '@renatoascencio/n8n-nodes-chatwoot') {
    throw new Error(`Expected @renatoascencio/n8n-nodes-chatwoot, got ${packageName}`);
  }
  const nodeFiles: string[] = pkg.n8n?.nodes ?? [];
  const credentialFiles: string[] = pkg.n8n?.credentials ?? [];
  if (nodeFiles.length === 0) throw new Error(`${packageName} declares no n8n.nodes`);
  if (credentialFiles.length === 0) throw new Error(`${packageName} declares no n8n.credentials`);

  const parser = new NodeParser();
  const nodes = nodeFiles.map((relative) => {
    const file = path.join(root, relative);
    const NodeClass = loadExportedClass(file);
    const description = new NodeClass().description;
    const parsed = parser.parse(NodeClass as any, packageName);
    return {
      ...parsed,
      // NodeParser prefixes core packages; installed community nodes are `<npm package>.<name>`
      nodeType: `${packageName}.${description.name}`,
      category: readCodexCategory(file) ?? 'Communication',
      // n8n only creates the "<name>Tool" variant when the description sets usableAsTool
      isAITool: Boolean(description.usableAsTool),
      usableAsTool: Boolean(description.usableAsTool),
      packageName,
    };
  });

  const credentials = credentialFiles.map((relative) => {
    const CredentialClass = loadExportedClass(path.join(root, relative));
    const credential = new CredentialClass();
    return {
      name: credential.name as string,
      displayName: credential.displayName as string,
      documentationUrl: credential.documentationUrl as string | undefined,
      properties: (credential.properties as any[]).map((prop) => ({
        name: prop.name,
        displayName: prop.displayName,
        type: prop.type,
        required: prop.required === true,
        // Never copy defaults of secret fields
        default: prop.typeOptions?.password ? '' : prop.default,
        description: prop.description,
        ...(Array.isArray(prop.options)
          ? { options: prop.options.map((o: any) => ({ name: o.name, value: o.value })) }
          : {}),
        ...(prop.displayOptions ? { displayOptions: prop.displayOptions } : {}),
      })),
    };
  });

  return {
    packageName,
    packageVersion: args.version ?? pkg.version,
    ...(args.source ? { source: args.source } : {}),
    nodes,
    credentials,
  };
}

export function runChatwootCatalogGenerator(argv: string[]): void {
  const args = parseArgs(argv);
  const snapshot = generateChatwootSnapshot(args);
  const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;
  if (args.check) {
    if (!fs.existsSync(args.out) || fs.readFileSync(args.out, 'utf8') !== serialized) {
      throw new Error(`Chatwoot snapshot differs: ${args.out}. Regenerate it without --check.`);
    }
  } else {
    fs.writeFileSync(args.out, serialized);
  }
  const operationCount = snapshot.nodes.reduce((sum, node) => sum + node.operations.length, 0);
  console.log(
    `${args.check ? 'Verified' : 'Wrote'} ${args.out}: ${snapshot.packageName}@${snapshot.packageVersion}, ` +
      `${snapshot.nodes.length} nodes, ${operationCount} operations, ${snapshot.credentials.length} credentials`,
  );
}

if (require.main === module) runChatwootCatalogGenerator(process.argv.slice(2));
