/**
 * Chatwoot workflow checker
 *
 * Checks the Chatwoot nodes of a workflow (templates included) against the node catalog, which is generated
 * from the node package itself:
 * - resource / operation exist and every parameter is a real parameter of that operation, shown for the
 *   current values (a top-level `name` on Public Contact > Create is reported: the node reads
 *   `additionalFields.name`), with valid option values and collection fields;
 * - required parameters are set and credentials match the resource's API;
 * - trigger events are valid Chatwoot events for the selected source;
 * - expressions that read the trigger output (`$json.x` right after the trigger, `$('Chatwoot Trigger').item.json.x`
 *   anywhere) use keys that exist in the Chatwoot 4.18 payload of the selected events.
 */

import {
  CHATWOOT_DEFAULT_RESOURCE,
  CHATWOOT_NODE_TYPES,
  CHATWOOT_RESOURCES,
  CHATWOOT_TRIGGER_MANUAL_EVENTS,
  CHATWOOT_TRIGGER_OUTPUT_EXTRAS,
  CHATWOOT_TRIGGER_PARAMETERS,
  CHATWOOT_WEBHOOK_PAYLOADS,
  ChatwootParameterInfo,
  ChatwootPayloadShape,
  getChatwootDefaultOperation,
  getChatwootOperationParameters,
} from './chatwoot-node-catalog';

export interface ChatwootWorkflowIssue {
  node: string;
  message: string;
}

interface WorkflowNodeLike {
  name: string;
  type: string;
  parameters?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
}

interface WorkflowLike {
  nodes?: WorkflowNodeLike[];
  connections?: Record<string, { main?: Array<Array<{ node: string }> | null> }>;
}

/** Parameters n8n adds to every Tool variant */
const TOOL_PARAMETERS = ['toolDescription', 'descriptionType'];

function isExpression(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith('=');
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '' || value === 0 ||
    (Array.isArray(value) && value.length === 0);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// ----------------------------------------------------------------------------
// Parameters
// ----------------------------------------------------------------------------

function effectiveValue(
  name: string,
  params: Record<string, unknown>,
  parameters: ChatwootParameterInfo[],
): unknown {
  const [root, ...path] = name.replace(/^\//, '').split('.');
  let value = root in params ? params[root] : parameters.find((p) => p.name === root)?.default;
  for (const key of path) {
    // A collection expression may supply the nested value at runtime.
    if (isExpression(value)) return value;
    value = isPlainObject(value) ? value[key] : undefined;
  }
  return value;
}

function conditionMatches(value: unknown, condition: unknown): boolean {
  // n8n's exists predicate is used for fields moved out of legacy Options collections.
  if (isPlainObject(condition) && isPlainObject(condition._cnd) && condition._cnd.exists === true) {
    return value !== undefined && value !== null && value !== '';
  }
  return value === condition;
}

/**
 * Whether the parameter's non resource/operation conditions hold: 'unknown' when a condition depends on an
 * expression, which is only resolved at runtime
 */
function conditionsMet(
  param: ChatwootParameterInfo,
  params: Record<string, unknown>,
  parameters: ChatwootParameterInfo[],
): 'yes' | 'no' | 'unknown' {
  let state: 'yes' | 'unknown' = 'yes';
  for (const [name, allowed] of Object.entries(param.showWhen ?? {})) {
    const value = effectiveValue(name, params, parameters);
    if (isExpression(value)) state = 'unknown';
    else if (!allowed.some((condition) => conditionMatches(value, condition))) return 'no';
  }
  for (const [name, blocked] of Object.entries(param.hideWhen ?? {})) {
    const value = effectiveValue(name, params, parameters);
    if (isExpression(value)) state = 'unknown';
    else if (blocked.some((condition) => conditionMatches(value, condition))) return 'no';
  }
  return state;
}

function describeConditions(param: ChatwootParameterInfo): string {
  const conditions = Object.entries(param.showWhen ?? {})
    .map(([name, allowed]) => `${name} is ${allowed.map((v) => JSON.stringify(v)).join(' or ')}`);
  for (const [name, blocked] of Object.entries(param.hideWhen ?? {})) {
    const label = name.replace(/^\//, '');
    for (const condition of blocked) {
      conditions.push(isPlainObject(condition) && isPlainObject(condition._cnd) && condition._cnd.exists === true
        ? `${label} is not set`
        : `${label} is not ${JSON.stringify(condition)}`);
    }
  }
  return conditions.join(' and ');
}

function checkValue(
  param: ChatwootParameterInfo,
  value: unknown,
  path: string,
  report: (message: string) => void,
): void {
  if (isExpression(value)) return;

  if (param.type === 'options' && param.values && !param.dynamicOptions) {
    if (!param.values.includes(value as string)) {
      report(`"${path}" must be one of ${param.values.map((v) => JSON.stringify(v)).join(', ')} (got ${JSON.stringify(value)})`);
    }
    return;
  }

  if (param.type === 'multiOptions' && param.values && !param.dynamicOptions) {
    if (!Array.isArray(value)) {
      report(`"${path}" must be an array`);
      return;
    }
    const invalid = value.filter((v) => !isExpression(v) && !param.values!.includes(v as string));
    if (invalid.length > 0) {
      report(`"${path}" has invalid values ${invalid.map((v) => JSON.stringify(v)).join(', ')}; allowed: ${param.values.join(', ')}`);
    }
    return;
  }

  if (param.type === 'boolean' && typeof value !== 'boolean') {
    report(`"${path}" must be a boolean`);
    return;
  }

  if (param.type === 'number' && typeof value !== 'number') {
    report(`"${path}" must be a number or an expression`);
    return;
  }

  if (param.type === 'collection') {
    if (!isPlainObject(value)) {
      report(`"${path}" must be an object`);
      return;
    }
    for (const [key, nested] of Object.entries(value)) {
      const field = param.fields?.find((f) => f.name === key);
      if (!field) {
        report(`"${path}.${key}" is not a field of "${path}" (fields: ${(param.fields ?? []).map((f) => f.name).join(', ')})`);
        continue;
      }
      checkValue(field, nested, `${path}.${key}`, report);
    }
    return;
  }

  if (param.type === 'fixedCollection') {
    if (!isPlainObject(value)) {
      report(`"${path}" must be an object`);
      return;
    }
    for (const [groupName, entries] of Object.entries(value)) {
      const group = param.fields?.find((f) => f.name === groupName);
      if (!group) {
        report(`"${path}.${groupName}" is not a group of "${path}"`);
        continue;
      }
      if (param.property.typeOptions?.multipleValues && !Array.isArray(entries) && !isExpression(entries)) {
        report(`"${path}.${groupName}" must be an array`);
        continue;
      }
      for (const entry of Array.isArray(entries) ? entries : [entries]) {
        if (isExpression(entry)) continue;
        if (!isPlainObject(entry)) {
          report(`"${path}.${groupName}" entries must be objects`);
          continue;
        }
        for (const [key, nested] of Object.entries(entry)) {
          const field = group.fields?.find((f) => f.name === key);
          if (!field) report(`"${path}.${groupName}.${key}" is not a field of "${path}.${groupName}"`);
          else checkValue(field, nested, `${path}.${groupName}.${key}`, report);
        }
      }
    }
  }
}

function checkParameters(
  params: Record<string, unknown>,
  parameters: ChatwootParameterInfo[],
  context: string,
  skip: string[],
  report: (message: string) => void,
): void {
  for (const [key, value] of Object.entries(params)) {
    if (skip.includes(key)) continue;
    const candidates = parameters.filter((p) => p.name === key);
    if (candidates.length === 0) {
      // Collection fields use Chatwoot's snake_case names (messageType → options.message_type)
      const names = [key, key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)];
      const holder = parameters.find((p) => p.fields?.some((f) => names.includes(f.name)));
      const field = holder?.fields?.find((f) => names.includes(f.name));
      report(
        `"${key}" is not a parameter of ${context}` +
          (holder && field ? `; the node reads it from "${holder.name}.${field.name}"` : ''),
      );
      continue;
    }
    const shown = candidates.find((p) => conditionsMet(p, params, parameters) !== 'no');
    if (!shown) {
      report(`"${key}" is ignored by ${context} unless ${describeConditions(candidates[0])}`);
      continue;
    }
    checkValue(shown, value, key, report);
  }

  for (const param of parameters) {
    if (!param.required || conditionsMet(param, params, parameters) !== 'yes') continue;
    const value = param.name in params ? params[param.name] : param.default;
    if (isEmpty(value) && !isExpression(value)) {
      report(`required parameter "${param.name}" of ${context} is not set`);
    }
  }
}

function checkCredentials(
  node: WorkflowNodeLike,
  expected: string | undefined,
  report: (message: string) => void,
): void {
  if (!expected || !node.credentials) return;
  if (!(expected in node.credentials)) {
    report(`uses credentials ${Object.keys(node.credentials).join(', ') || '(none)'} but this operation needs "${expected}"`);
  }
}

function checkMainNode(node: WorkflowNodeLike, report: (message: string) => void): void {
  const params = node.parameters ?? {};
  const resource = (params.resource as string | undefined) ?? CHATWOOT_DEFAULT_RESOURCE;
  if (isExpression(resource)) return;
  const resourceInfo = CHATWOOT_RESOURCES.find((r) => r.value === resource);
  if (!resourceInfo) {
    report(`unknown resource "${resource}"`);
    return;
  }
  const operation = (params.operation as string | undefined) ?? getChatwootDefaultOperation(resource);
  if (isExpression(operation)) return;
  const parameters = operation ? getChatwootOperationParameters(resource, operation) : undefined;
  if (!parameters) {
    report(`unknown operation "${operation}" for resource "${resource}"`);
    return;
  }
  const skip = ['resource', 'operation', ...(node.type === CHATWOOT_NODE_TYPES.tool ? TOOL_PARAMETERS : [])];
  checkParameters(params, parameters, `${resource} > ${operation}`, skip, report);
  checkCredentials(node, resourceInfo.credential, report);
}

function checkTriggerNode(node: WorkflowNodeLike, report: (message: string) => void): void {
  const params = node.parameters ?? {};
  checkParameters(params, CHATWOOT_TRIGGER_PARAMETERS, 'Chatwoot Trigger', [], report);
  const source = effectiveValue('source', params, CHATWOOT_TRIGGER_PARAMETERS);
  checkCredentials(node, source === 'accountWebhook' ? 'chatwootApi' : undefined, report);
}

// ----------------------------------------------------------------------------
// Trigger payload paths
// ----------------------------------------------------------------------------

/** Events a trigger node delivers, per its source */
export function getChatwootTriggerEvents(params: Record<string, unknown> = {}): string[] {
  const source = effectiveValue('source', params, CHATWOOT_TRIGGER_PARAMETERS);
  if (source === 'manual') {
    const manual = Array.isArray(params.manualEvents) ? (params.manualEvents as string[]) : [];
    return manual.length > 0 ? manual : CHATWOOT_TRIGGER_MANUAL_EVENTS;
  }
  return Array.isArray(params.events) ? (params.events as string[]) : [];
}

function mergeShapes(shapes: ChatwootPayloadShape[]): ChatwootPayloadShape {
  const merged: ChatwootPayloadShape = {};
  for (const shape of shapes) {
    for (const [key, value] of Object.entries(shape)) {
      const current = merged[key];
      if (current === undefined) merged[key] = value;
      else if (current !== true && value !== true) merged[key] = mergeShapes([current, value]);
      else merged[key] = true;
    }
  }
  return merged;
}

/** Output shape of a trigger node: union of its events' payloads plus the keys the node adds */
export function getChatwootTriggerOutputShape(params: Record<string, unknown> = {}): ChatwootPayloadShape {
  const events = getChatwootTriggerEvents(params).filter((e) => CHATWOOT_WEBHOOK_PAYLOADS[e]);
  return mergeShapes([...events.map((e) => CHATWOOT_WEBHOOK_PAYLOADS[e]), CHATWOOT_TRIGGER_OUTPUT_EXTRAS]);
}

const PATH_SEGMENT = /^(?:\?\.|\.)([A-Za-z_$][\w$]*)|^(?:\?\.)?\[\s*['"]([^'"]+)['"]\s*\]/;

/** Property path that follows `.json` in an expression, e.g. `?.meta.sender['name']` → [meta, sender, name] */
function readPath(text: string): string[] {
  const path: string[] = [];
  let rest = text;
  for (;;) {
    const match = PATH_SEGMENT.exec(rest);
    if (!match) return path;
    path.push(match[1] ?? match[2]);
    rest = rest.slice(match[0].length);
  }
}

function checkPath(path: string[], shape: ChatwootPayloadShape): string | undefined {
  let current: ChatwootPayloadShape | true = shape;
  for (let i = 0; i < path.length; i++) {
    if (current === true) return undefined;
    const next: ChatwootPayloadShape | true | undefined = current[path[i]];
    if (next === undefined) {
      const parent = i === 0 ? 'the payload' : `"${path.slice(0, i).join('.')}"`;
      return `"${path.slice(0, i + 1).join('.')}" does not exist: ${parent} has ${Object.keys(current).sort().join(', ')}`;
    }
    current = next;
  }
  return undefined;
}

function collectExpressions(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string' && isExpression(value)) out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectExpressions(v, out));
  else if (isPlainObject(value)) Object.values(value).forEach((v) => collectExpressions(v, out));
  return out;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function checkPayloadReferences(
  workflow: WorkflowLike,
  trigger: WorkflowNodeLike,
  issues: ChatwootWorkflowIssue[],
): void {
  const events = getChatwootTriggerEvents(trigger.parameters);
  if (events.length === 0) return;
  const shape = getChatwootTriggerOutputShape(trigger.parameters);
  const eventsLabel = events.join(', ');
  const name = escapeRegExp(trigger.name);
  const namedReference = new RegExp(
    `(?:\\$\\(\\s*['"]${name}['"]\\s*\\)\\.(?:item|first\\(\\)|last\\(\\)|itemMatching\\([^)]*\\))|\\$node\\[\\s*['"]${name}['"]\\s*\\])\\.json`,
    'g',
  );
  const children = new Set(
    (workflow.connections?.[trigger.name]?.main ?? []).flatMap((outputs) => (outputs ?? []).map((c) => c.node)),
  );

  for (const node of workflow.nodes ?? []) {
    const texts = collectExpressions(node.parameters);
    // Code nodes execute jsCode without the expression prefix; ordinary literal strings do not.
    if (node.type === 'n8n-nodes-base.code' && typeof node.parameters?.jsCode === 'string') {
      texts.push(node.parameters.jsCode);
    }
    const paths: string[][] = [];
    for (const text of texts) {
      for (const match of text.matchAll(namedReference)) {
        paths.push(readPath(text.slice(match.index! + match[0].length)));
      }
      if (children.has(node.name)) {
        for (const match of text.matchAll(/\$json\b/g)) {
          paths.push(readPath(text.slice(match.index! + match[0].length)));
        }
      }
    }
    for (const path of paths) {
      if (path.length === 0) continue;
      const problem = checkPath(path, shape);
      if (problem) {
        issues.push({ node: node.name, message: `reads ${problem} (${trigger.name} events: ${eventsLabel})` });
      }
    }
  }
}

// ----------------------------------------------------------------------------
// Entry point
// ----------------------------------------------------------------------------

/** Check every Chatwoot node of a workflow. Returns an empty list when the workflow is consistent. */
export function validateChatwootWorkflow(workflow: WorkflowLike): ChatwootWorkflowIssue[] {
  const issues: ChatwootWorkflowIssue[] = [];
  for (const node of workflow.nodes ?? []) {
    const report = (message: string) => issues.push({ node: node.name, message });
    if (node.type === CHATWOOT_NODE_TYPES.main || node.type === CHATWOOT_NODE_TYPES.tool) {
      checkMainNode(node, report);
    } else if (node.type === CHATWOOT_NODE_TYPES.trigger) {
      checkTriggerNode(node, report);
      checkPayloadReferences(workflow, node, issues);
    }
  }
  return issues;
}
