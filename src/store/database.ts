import { defineStore } from 'pinia';
import {
  createDatabase as createDatabaseSchema,
  createColumn,
  createView as createViewSchema,
} from '@/lib/database/schema';
import { defaultViewConfig } from '@/lib/database/view-engine';
import {
  syncDatabaseSchema,
  removeDatabaseSchema,
  syncDeletedDatabaseIds,
  observeWorkspace,
} from '@/lib/yjs/workspace-doc';
import { getWorkspaceDoc } from '@/lib/yjs/meta-doc';
import { yMapToObj } from '@/lib/yjs/helpers';
import { deleteUpdates } from '@/lib/native/yjs.js';

export interface Column { id: string; name: string; type: string; config?: any }
export interface View { id: string; name: string; type: string; icon: string; config: any }
export interface DatabaseSchemaPlain {
  id: string;
  title: string;
  icon: string;
  columns: Column[];
  views: View[];
  deletedColumnIds: Record<string, number>;
  lastViewId: string | null;
  createdAt: number;
  updatedAt: number;
}

// ponytail: canonical row-doc id prefix (useDatabaseYjs reuses this constant).
const ROW_DOC_PREFIX = 'db:';

const COLUMN_NAMES: Record<string, string> = {
  rich_text: 'Text',
  number: 'Number',
  select: 'Select',
  multi_select: 'Multi-select',
  status: 'Status',
  date: 'Date',
  checkbox: 'Checkbox',
  url: 'URL',
  email: 'Email',
  phone_number: 'Phone',
  files: 'Files',
  people: 'People',
  relation: 'Relation',
  rollup: 'Rollup',
  formula: 'Formula',
};

const VIEW_NAMES: Record<string, string> = {
  table: 'Table',
  kanban: 'Board',
  calendar: 'Calendar',
  gallery: 'Gallery',
  list: 'List',
  timeline: 'Timeline',
};

function normalize(raw: any): DatabaseSchemaPlain {
  const r = raw || {};
  return {
    deletedColumnIds: {},
    lastViewId: null,
    ...r,
    columns: Array.isArray(r.columns) ? r.columns : [],
    views: Array.isArray(r.views) ? r.views : [],
  };
}

export const useDatabaseStore = defineStore('database', {
  state: () => ({
    data: {} as Record<string, DatabaseSchemaPlain>,
    deletedIds: {} as Record<string, number>,
    hydrated: false,
  }),

  getters: {
    databases(s): DatabaseSchemaPlain[] {
      return Object.values(s.data).sort((a, b) => b.updatedAt - a.updatedAt);
    },
    getById(s) {
      return (id: string) => s.data[id];
    },
  },

  actions: {
    hydrate() {
      if (this.hydrated) return;
      this.hydrated = true;
      observeWorkspace((_changedIds: unknown, flags?: { databases?: boolean; deletedDatabases?: boolean }) => {
        if (flags?.databases) this.pullFromMeta();
        if (flags?.deletedDatabases) this.pullTombstones();
      });
      this.pullFromMeta();
      this.pullTombstones();
    },

    pullFromMeta() {
      const next: Record<string, DatabaseSchemaPlain> = {};
      for (const [id, yDb] of getWorkspaceDoc().getMap('databases').entries()) {
        next[id] = normalize(yMapToObj(yDb));
      }
      this.data = next;
    },

    pullTombstones() {
      this.deletedIds = yMapToObj(getWorkspaceDoc().getMap('deletedDatabaseIds'));
    },

    createDatabase(opts: { title?: string; icon?: string } = {}) {
      const schema = createDatabaseSchema({
        title: opts.title || 'Untitled database',
        icon: opts.icon || 'riLayoutGridLine',
      }) as DatabaseSchemaPlain;
      this.data[schema.id] = schema;
      syncDatabaseSchema(schema);
      return schema.id;
    },

    updateSchema(dbId: string, patch: Partial<DatabaseSchemaPlain>) {
      const schema = this.data[dbId];
      if (!schema) return;
      Object.assign(schema, patch, { updatedAt: Date.now() });
      syncDatabaseSchema(schema);
    },

    deleteDatabase(dbId: string) {
      if (!this.data[dbId]) return;
      removeDatabaseSchema(dbId);
      deleteUpdates(`${ROW_DOC_PREFIX}${dbId}`).catch((error) => {
        console.warn('[database] failed to purge row updates for', dbId, error);
      });
      const { [dbId]: _removed, ...rest } = this.data;
      this.data = rest;
      this.deletedIds[dbId] = Date.now();
      syncDeletedDatabaseIds(this.deletedIds);
    },

    addColumn(dbId: string, partial: { type: string; name?: string; config?: any }): Column {
      const schema = this.data[dbId];
      if (!schema) throw new Error(`no such database: ${dbId}`);
      const base = partial.type === 'title' ? 'Title' : COLUMN_NAMES[partial.type] || 'Field';
      let name = partial.name || base;
      let n = 2;
      while (schema.columns.some((c) => c.name === name)) name = `${base} ${n++}`;
      const column = { ...createColumn(partial.type, name), ...(partial.config !== undefined ? { config: partial.config } : {}) } as Column;
      schema.columns.push(column);
      this.updateSchema(dbId, { columns: [...schema.columns] });
      return column;
    },

    updateColumn(dbId: string, columnId: string, patch: Partial<Column>) {
      const schema = this.data[dbId];
      if (!schema) return;
      schema.columns = schema.columns.map((c) => (c.id === columnId ? { ...c, ...patch } : c));
      this.updateSchema(dbId, { columns: [...schema.columns] });
    },

    removeColumn(dbId: string, columnId: string) {
      const schema = this.data[dbId];
      if (!schema) return;
      schema.columns = schema.columns.filter((c) => c.id !== columnId);
      schema.deletedColumnIds = { ...schema.deletedColumnIds, [columnId]: Date.now() };
      this.updateSchema(dbId, { columns: [...schema.columns], deletedColumnIds: { ...schema.deletedColumnIds } });
    },

    createView(dbId: string, type: string, extra: Partial<View> = {}): View {
      const schema = this.data[dbId];
      if (!schema) throw new Error(`no such database: ${dbId}`);
      const base = createViewSchema(type) as View;
      const view: View = {
        ...base,
        name: extra.name || VIEW_NAMES[type] || 'View',
        icon: extra.icon || base.icon,
        config: { ...base.config, ...defaultViewConfig(type, schema.columns), ...extra.config },
      };
      schema.views = [...schema.views, view];
      this.updateSchema(dbId, { views: schema.views, lastViewId: view.id });
      return view;
    },

    updateView(dbId: string, viewId: string, patch: Partial<View>) {
      const schema = this.data[dbId];
      if (!schema) return;
      schema.views = schema.views.map((v) =>
        v.id === viewId ? { ...v, ...patch, config: { ...v.config, ...patch.config } } : v
      );
      this.updateSchema(dbId, { views: [...schema.views] });
    },

    deleteView(dbId: string, viewId: string) {
      const schema = this.data[dbId];
      if (!schema) return;
      if (schema.views.length <= 1) return;
      schema.views = schema.views.filter((v) => v.id !== viewId);
      const patch: Partial<DatabaseSchemaPlain> = { views: [...schema.views] };
      if (schema.lastViewId === viewId) patch.lastViewId = schema.views[0]?.id ?? null;
      this.updateSchema(dbId, patch);
    },

    setLastView(dbId: string, viewId: string) {
      this.updateSchema(dbId, { lastViewId: viewId });
    },
  },
});
