import { nanoid } from 'nanoid'

export const COLUMN_TYPES = ['title','rich_text','number','select','multi_select','status','date','people','files','checkbox','url','email','phone_number','formula','relation','rollup','created_time','created_by','last_edited_time','last_edited_by','unique_id','button']

export const VIEW_TYPES = ['table','kanban','calendar','gallery','list','timeline']

export const VIEW_ICONS = { table:'riTableLine', kanban:'riLayoutColumnLine', calendar:'riCalendarLine', gallery:'riGalleryLine', list:'riListUnordered', timeline:'riBarChartHorizontalLine' }

/** @type {Record<string, string>} */
export const VIEW_NAMES = { table:'Table', kanban:'Board', calendar:'Calendar', gallery:'Gallery', list:'List', timeline:'Timeline' }

export function defaultConfig(type) {
  switch (type) {
    case 'number': return { format: 'plain' }
    case 'select':
    case 'multi_select':
    case 'status': return { options: [], groups: type === 'status' ? [] : undefined }
    case 'formula': return { expression: '' }
    case 'relation': return { databaseId: null }
    case 'rollup': return { relationPropertyId: null, rollupPropertyId: null, function: 'count_all' }
    case 'unique_id': return { prefix: null }
    case 'button': return { action: '' }
    default: return {}
  }
}

export function createColumn(type, name = '') {
  if (!COLUMN_TYPES.includes(type)) throw new Error(`Unknown column type: ${type}`)
  return { id: nanoid(10), type, name, config: defaultConfig(type) }
}

function baseViewConfig() {
  return {
    filters: { conjunction: 'and', list: [] },
    sorts: [],
    columnOrder: [],
    hiddenColumns: [],
    wrapCells: false,
    groupColumnId: null,
    cardFields: [],
    coverColumnId: null,
    dateColumnId: null,
    granularity: 'month',
    startColumnId: null,
    endColumnId: null,
  }
}

export function createView(type = 'table') {
  return { id: nanoid(10), name: '', type, icon: VIEW_ICONS[type], config: baseViewConfig() }
}

export function createDatabase({ title = 'Untitled', icon = 'riLayoutGridLine' } = {}) {
  const now = Date.now()
  const primary = createColumn('title', 'Name')
  return {
    id: nanoid(10), title, icon,
    createdAt: now, updatedAt: now,
    primaryColumnId: primary.id,
    columns: [primary],
    views: [createView('table')],
    lastViewId: null,
    deletedColumnIds: {},
  }
}

export function isDeleted(schema, columnId) {
  return Boolean(schema.deletedColumnIds[columnId])
}
