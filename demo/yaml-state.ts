import { isMap, isScalar, isSeq, parseDocument, type Document } from 'yaml';
import { normalizeConfig } from '../src/config';
import type { CardConfig } from '../src/types';

function mapping(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Update nodes rather than reserializing objects: untouched YAML comments, styles and
// advanced keys survive visual edits, including nested vehicle settings.
function reconcile(document: Document, path: (string | number)[], value: unknown): void {
  const node = document.getIn(path, true);
  if (isMap(node) && mapping(value)) {
    for (const pair of [...node.items]) {
      const key = String(isScalar(pair.key) ? pair.key.value : pair.key);
      if (!(key in value)) document.deleteIn([...path, key]);
    }
    for (const [key, child] of Object.entries(value)) {
      if (child !== undefined) reconcile(document, [...path, key], child);
      else document.deleteIn([...path, key]);
    }
  } else if (isSeq(node) && Array.isArray(value)) {
    while (node.items.length > value.length) node.delete(node.items.length - 1);
    value.forEach((child, index) => reconcile(document, [...path, index], child));
  } else if (isScalar(node)) {
    node.value = value;
  } else {
    document.setIn(path, value);
  }
}

export class YamlState {
  text = '';
  error = '';
  config?: CardConfig;
  private document?: Document;

  constructor(text: string) {
    this.edit(text);
  }

  edit(text: string): boolean {
    this.text = text;
    try {
      const document = parseDocument(text);
      if (document.errors.length) throw document.errors[0];
      const config: unknown = document.toJS();
      if (!mapping(config)) throw new Error('Card configuration must be a YAML mapping.');
      normalizeConfig(config as unknown as CardConfig);
      this.config = config as unknown as CardConfig;
      this.document = document;
      this.error = '';
      return true;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  update(config: CardConfig): boolean {
    if (this.error || !this.document) return false;
    const document = this.document.clone();
    reconcile(document, [], config);
    // Invalid visual edits stay visible as an invalid draft, never a false preview.
    return this.edit(document.toString());
  }
}
