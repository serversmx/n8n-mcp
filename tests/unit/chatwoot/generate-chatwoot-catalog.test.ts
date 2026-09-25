import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  generateChatwootSnapshot,
  parseArgs,
  runChatwootCatalogGenerator,
} from '@/scripts/generate-chatwoot-catalog';

const PACKAGE_NAME = '@renatoascencio/n8n-nodes-chatwoot';
const nestedParameter = {
  name: 'formValues', displayName: 'Form Values', type: 'fixedCollection', default: {},
  displayOptions: { show: { resource: ['publicMessage'], operation: ['update'], responseType: ['form'] } },
  typeOptions: { multipleValues: true },
  options: [{ name: 'values', displayName: 'Value', values: [
    { name: 'name', displayName: 'Field Name', type: 'string', default: '', required: true },
    { name: 'value', displayName: 'Value', type: 'string', default: '' },
  ] }],
};

describe('Chatwoot snapshot generator', () => {
  let packageRoot: string;
  let output: string;

  beforeEach(() => {
    packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chatwoot-generator-test-'));
    output = path.join(packageRoot, 'snapshot.json');
    fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({
      name: PACKAGE_NAME, version: '0.8.3',
      n8n: { nodes: ['Chatwoot.node.js', 'ChatwootTrigger.node.js'], credentials: ['ChatwootApi.credentials.js'] },
    }));
    const description = {
      name: 'chatwoot', displayName: 'Chatwoot', group: ['transform'], version: 1,
      inputs: ['main'], outputs: ['main'], usableAsTool: true,
      credentials: [{ name: 'chatwootApi', required: true, displayOptions: { show: { resource: ['publicMessage'] } } }],
      properties: [
        { name: 'resource', type: 'options', default: 'publicMessage', options: [{ name: 'Public Message', value: 'publicMessage' }] },
        { name: 'operation', type: 'options', default: 'update',
          displayOptions: { show: { resource: ['publicMessage'] } },
          options: [{ name: 'Update', value: 'update' }, { name: 'Get', value: 'get' }] },
        nestedParameter,
      ],
    };
    writeClass('Chatwoot.node.js', { description });
    fs.writeFileSync(path.join(packageRoot, 'Chatwoot.node.json'), JSON.stringify({ categories: ['Communication'] }));
    writeClass('ChatwootTrigger.node.js', { description: {
      name: 'chatwootTrigger', displayName: 'Chatwoot Trigger', group: ['trigger'], version: 1,
      inputs: [], outputs: ['main'], webhooks: [{ name: 'default' }],
      credentials: [{ name: 'chatwootApi', required: true, displayOptions: { show: { source: ['accountWebhook'] } } }],
      properties: [{ name: 'manualEvents', type: 'multiOptions', default: [],
        displayOptions: { show: { source: ['manual'] } },
        options: [{ name: 'Conversation Opened', value: 'conversation_opened' }] }],
    } });
    writeClass('ChatwootApi.credentials.js', {
      name: 'chatwootApi', displayName: 'Chatwoot API', properties: [
        { name: 'baseUrl', displayName: 'Base URL', type: 'string', default: 'https://example.test', required: true },
        { name: 'apiAccessToken', displayName: 'API Token', type: 'string', default: 'fixture-secret',
          typeOptions: { password: true }, displayOptions: { show: { tokenType: ['user'] } } },
      ],
    });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(packageRoot, { recursive: true, force: true });
  });

  function writeClass(filename: string, instance: object): void {
    fs.writeFileSync(path.join(packageRoot, filename),
      `exports.Fixture = class { constructor() { Object.assign(this, ${JSON.stringify(instance)}); } };\n`);
  }

  it.each(['--package', '--version', '--source', '--out'])('rejects a missing %s value before generation', (flag) => {
    expect(() => parseArgs(['--package', packageRoot, flag])).toThrow(`Missing value for ${flag}`);
    expect(() => parseArgs(['--package', packageRoot, flag, '--check'])).toThrow(`Missing value for ${flag}`);
  });

  it('reads declared nodes, operations, nested fields and conditional credentials without losing metadata', () => {
    const snapshot = generateChatwootSnapshot({ packageRoot });
    expect(snapshot.packageName).toBe(PACKAGE_NAME);
    expect(snapshot.packageVersion).toBe('0.8.3');
    expect(snapshot.nodes.map((node) => node.nodeType)).toEqual([`${PACKAGE_NAME}.chatwoot`, `${PACKAGE_NAME}.chatwootTrigger`]);
    const [main, trigger] = snapshot.nodes;
    expect(main.category).toBe('Communication');
    expect(main.usableAsTool).toBe(true);
    expect(main.operations.map((operation) => [operation.resource, operation.operation])).toEqual([
      ['publicMessage', 'update'], ['publicMessage', 'get'],
    ]);
    expect(main.properties.find((property) => property.name === 'formValues')).toMatchObject(nestedParameter);
    expect(trigger.isTrigger).toBe(true);
    expect(trigger.isWebhook).toBe(true);
    expect(trigger.usableAsTool).toBe(false);
    expect(trigger.credentials).toEqual([
      { name: 'chatwootApi', required: true, displayOptions: { show: { source: ['accountWebhook'] } } },
    ]);
    expect(trigger.properties[0]).toMatchObject({
      name: 'manualEvents', displayOptions: { show: { source: ['manual'] } },
      options: [{ name: 'Conversation Opened', value: 'conversation_opened' }],
    });
    expect(snapshot.credentials).toHaveLength(1);
    expect(snapshot.credentials[0].properties).toHaveLength(2);
    expect(snapshot.credentials[0].properties[0].default).toBe('https://example.test');
    expect(snapshot.credentials[0].properties[1]).toMatchObject({
      name: 'apiAccessToken', default: '', displayOptions: { show: { tokenType: ['user'] } },
    });
    expect(JSON.stringify(snapshot)).not.toContain('fixture-secret');
  });

  it('reproduces the same bytes and checks drift without modifying the snapshot', () => {
    const args = ['--package', packageRoot, '--version', '0.9.0', '--source', 'fixture@abc123', '--out', output];
    runChatwootCatalogGenerator(args);
    const first = fs.readFileSync(output, 'utf8');
    expect(JSON.parse(first)).toMatchObject({ packageVersion: '0.9.0', source: 'fixture@abc123' });
    runChatwootCatalogGenerator(args);
    expect(fs.readFileSync(output, 'utf8')).toBe(first);
    expect(() => runChatwootCatalogGenerator([...args, '--check'])).not.toThrow();
    fs.writeFileSync(output, `${first}\n`);
    expect(() => runChatwootCatalogGenerator([...args, '--check'])).toThrow('Chatwoot snapshot differs');
    expect(fs.readFileSync(output, 'utf8')).toBe(`${first}\n`);
    fs.unlinkSync(output);
    expect(() => runChatwootCatalogGenerator([...args, '--check'])).toThrow('Chatwoot snapshot differs');
    expect(fs.existsSync(output)).toBe(false);
  });

  it('refuses unrelated packages and empty manifests instead of writing a vacuous snapshot', () => {
    const manifest = path.join(packageRoot, 'package.json');
    fs.writeFileSync(manifest, JSON.stringify({ name: 'unrelated-package', n8n: { nodes: [], credentials: [] } }));
    expect(() => generateChatwootSnapshot({ packageRoot })).toThrow(`Expected ${PACKAGE_NAME}`);
    fs.writeFileSync(manifest, JSON.stringify({ name: PACKAGE_NAME, n8n: { nodes: [], credentials: [] } }));
    expect(() => generateChatwootSnapshot({ packageRoot })).toThrow('declares no n8n.nodes');
    fs.writeFileSync(manifest, JSON.stringify({ name: PACKAGE_NAME, n8n: { nodes: ['Chatwoot.node.js'], credentials: [] } }));
    expect(() => generateChatwootSnapshot({ packageRoot })).toThrow('declares no n8n.credentials');
  });
});
