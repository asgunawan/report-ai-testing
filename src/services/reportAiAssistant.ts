const API_BASE_URL = (import.meta.env.VITE_AI_API as string | undefined) || 'http://localhost:6080'
const SESSION_STORAGE_KEY = 'report_ai_test_session_id'

export interface BackendHistoryMessage {
  id?: string | number
  role?: string
  content?: string
  message?: string
  timestamp?: string
  suggestions?: string[]
}

export interface TemplateMatch {
  templateId: string
  templateName: string
  xmlPath: string
  description?: string
  matchedQuestion: string
  similarity: number
  similarityPercent: number
  isHighConfidence: boolean
}

export interface TemplateMainEntity {
  fileName: string
  dbName: string
  schemaName: string
  entityName: string
}

export interface TemplatePostColumn {
  DBName: string
  SchemaName: string
  EntityName: string
  ColName: string
  DataType: 'String' | 'Number' | 'DateTime'
  Seq: string | number
  DisplayName: string
  Aggregate?: string
  Sort?: string
}

export interface TemplatePostCondition {
  DBName: string
  SchemaName: string
  EntityName: string
  ColName: string
  DataType: 'String' | 'Number' | 'DateTime'
  Comparison: string
  Value?: string
  ConditionValue?: string
  Level?: string | number
}

export interface TemplateDefinition {
  moduleId: string
  distinct: boolean
  mainEntity: TemplateMainEntity
  columns: TemplatePostColumn[]
  conditions: TemplatePostCondition[]
}

export interface EntityColumnOption {
  colName: string
  dataType: 'String' | 'Number' | 'DateTime'
  entityName: string
}

export const COMPARATORS_BY_TYPE: Record<'String' | 'Number' | 'DateTime', string[]> = {
  String: [
    'isequalto',
    'isnotequalto',
    'isinlist',
    'isnotinlist',
    'isnull',
    'isnotnull',
    'startswith',
    'doesnotstartwith',
    'contains',
    'doesnotcontain',
  ],
  Number: [
    'isequalto',
    'isnotequalto',
    'isbetween',
    'isnotbetween',
    'isinlist',
    'isnotinlist',
    'islessthan',
    'islessthanorequalto',
    'isgreaterthan',
    'isgreaterthanorequalto',
    'isnull',
    'isnotnull',
  ],
  DateTime: [
    'today',
    'thisweek',
    'thismonth',
    'yesterday',
    'previousweek',
    'previousmonth',
    'lastndays',
    'nextndays',
    'customperiod',
    'isequalto',
    'isnotequalto',
    'islessthan',
    'islessthanorequalto',
    'isgreaterthan',
    'isgreaterthanorequalto',
  ],
}

export interface TemplateMatchResult {
  message: string
  suggestions: string[]
  timestamp: string
  totalMatches: number
  matches: TemplateMatch[]
  metadata: { processingTime?: number; modelUsed?: string } | null
}

export interface QueryResult {
  message: string
  suggestions: string[]
  timestamp: string
  sqlQuery: string | null
  sqlQueryReasoning: string | null
  sqlQuerySources: string[] | null
  sqlQueryAggregations: string[] | null
  queryResult: Array<Record<string, unknown>> | null
  metadata: { fromCache?: boolean; processingTime?: number; modelUsed?: string } | null
}

function buildUrl(path: string): string {
  return `${API_BASE_URL}${path}`
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text()
  if (!response.ok) throw new Error(`API error: ${response.status} - ${response.statusText}`)
  if (!text.trim()) throw new Error('Empty response from backend')
  return JSON.parse(text) as T
}

function getLocalSessionId(): string | null {
  return typeof window !== 'undefined' ? window.localStorage.getItem(SESSION_STORAGE_KEY) : null
}

function setLocalSessionId(id: string): void {
  if (typeof window !== 'undefined') window.localStorage.setItem(SESSION_STORAGE_KEY, id)
}

export async function checkAssistantHealth(timeoutMs = 5000): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), timeoutMs)
    const response = await fetch(buildUrl('/report/ai/health'), { signal: controller.signal })
    window.clearTimeout(timer)
    return response.ok
  } catch {
    return false
  }
}

export async function requestSessionId(forceNew = false): Promise<string> {
  const saved = getLocalSessionId()
  if (saved && !forceNew) return saved

  const response = await fetch(buildUrl('/report/ai/api/analytics/session'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ forceNew }),
  })
  const data = await parseJsonResponse<{ sessionId?: string }>(response)
  if (!data.sessionId) throw new Error('Session ID missing in response')
  setLocalSessionId(data.sessionId)
  return data.sessionId
}

export async function fetchHistory(sessionId: string): Promise<BackendHistoryMessage[]> {
  const response = await fetch(
    buildUrl(`/report/ai/api/analytics/history/${encodeURIComponent(sessionId)}`),
  )
  const data = await parseJsonResponse<{ history?: { messages?: BackendHistoryMessage[] } }>(response)
  return data.history?.messages ?? []
}

export async function fetchSampleSuggestions(): Promise<string[]> {
  const response = await fetch(buildUrl('/report/ai/api/analytics/samples'))
  const data = await parseJsonResponse<{ samples?: Array<{ query?: string } | string> }>(response)
  return (data.samples ?? [])
    .map((s) => (typeof s === 'string' ? s.trim() : s.query?.trim()))
    .filter((q): q is string => Boolean(q))
}

export async function queryAssistant(query: string, sessionId: string): Promise<QueryResult> {
  type Resp = {
    timestamp?: string
    suggestions?: string[]
    content?: {
      message?: string
      data?: Array<Record<string, unknown>>
      metadata?: { fromCache?: boolean; processingTime?: number; modelUsed?: string }
      sql?: {
        sqlQuery?: string
        sqlQueryReasoning?: string
        sqlQuerySources?: string[]
        sqlQueryAggregations?: string[]
      }
    }
  }

  const response = await fetch(buildUrl('/report/ai/api/analytics/query'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, sessionId }),
  })
  const data = await parseJsonResponse<Resp>(response)
  const content = data.content ?? {}

  return {
    message: content.message ?? '',
    suggestions: data.suggestions ?? [],
    timestamp: data.timestamp ?? new Date().toISOString(),
    sqlQuery: content.sql?.sqlQuery ?? null,
    sqlQueryReasoning: content.sql?.sqlQueryReasoning ?? null,
    sqlQuerySources: content.sql?.sqlQuerySources ?? null,
    sqlQueryAggregations: content.sql?.sqlQueryAggregations ?? null,
    queryResult: Array.isArray(content.data) ? content.data : null,
    metadata: content.metadata ?? null,
  }
}

export type DetectedMode = 'sql' | 'template' | 'list_templates'

export interface AskResult {
  mode: DetectedMode
  message: string
  suggestions: string[]
  timestamp: string
  // SQL fields
  sqlQuery?: string | null
  sqlQueryReasoning?: string | null
  sqlQuerySources?: string[] | null
  sqlQueryAggregations?: string[] | null
  queryResult?: Array<Record<string, unknown>> | null
  chartConfig?: Record<string, unknown> | null
  // Template fields
  totalMatches?: number | null
  matches?: TemplateMatch[] | null
  // Shared
  metadata: { processingTime?: number; modelUsed?: string; fromCache?: boolean } | null
}

type AskRespPayload = {
  mode?: string
  timestamp?: string
  suggestions?: string[]
  content?: {
    message?: string
    data?:
      | { totalMatches?: number; matches?: TemplateMatch[] }
      | Array<Record<string, unknown>>
      | null
    metadata?: { processingTime?: number; modelUsed?: string; fromCache?: boolean }
    sql?: {
      sqlQuery?: string
      sqlQueryReasoning?: string
      sqlQuerySources?: string[]
      sqlQueryAggregations?: string[]
    }
    visualization?: {
      chartConfig?: Record<string, unknown>
      chartType?: string
    } | null
  }
}

function parseAskPayload(data: AskRespPayload): AskResult {
  const rawMode = data.mode
  const mode: DetectedMode =
    rawMode === 'template' ? 'template'
    : rawMode === 'list_templates' ? 'list_templates'
    : 'sql'
  const content = data.content ?? {}
  const baseFields = {
    mode,
    message: content.message ?? '',
    suggestions: data.suggestions ?? [],
    timestamp: data.timestamp ?? new Date().toISOString(),
    metadata: content.metadata ?? null,
  }

  if (mode === 'template' || mode === 'list_templates') {
    const payload = (content.data as { totalMatches?: number; matches?: TemplateMatch[] }) ?? {}
    return {
      ...baseFields,
      totalMatches: payload.totalMatches ?? 0,
      matches: payload.matches ?? [],
    }
  }

  return {
    ...baseFields,
    sqlQuery: content.sql?.sqlQuery ?? null,
    sqlQueryReasoning: content.sql?.sqlQueryReasoning ?? null,
    sqlQuerySources: content.sql?.sqlQuerySources ?? null,
    sqlQueryAggregations: content.sql?.sqlQueryAggregations ?? null,
    queryResult: Array.isArray(content.data) ? content.data : null,
    chartConfig: content.visualization?.chartConfig ?? null,
  }
}

export async function askAssistant(
  query: string,
  sessionId: string,
  limit = 5,
  onProgress?: (message: string) => void,
): Promise<AskResult> {
  const response = await fetch(buildUrl('/report/ai/api/analytics/ask'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, sessionId, limit }),
  })

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`)
  }

  // The backend streams SSE events: 'progress', 'result', 'timeout', 'error'
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let pendingEvent = 'message'

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        pendingEvent = line.slice(7).trim()
      } else if (line.startsWith('data: ')) {
        const raw = line.slice(6)
        let data: Record<string, unknown>
        try {
          data = JSON.parse(raw)
        } catch {
          pendingEvent = 'message'
          continue
        }

        if (pendingEvent === 'progress') {
          onProgress?.(data.message as string)
        } else if (pendingEvent === 'result') {
          reader.cancel()
          return parseAskPayload(data as AskRespPayload)
        } else if (pendingEvent === 'timeout') {
          reader.cancel()
          throw new Error((data.error as string) ?? 'Query timed out')
        } else if (pendingEvent === 'error') {
          reader.cancel()
          throw new Error((data.error as string) ?? (data.message as string) ?? 'Unknown error')
        }

        pendingEvent = 'message'
      }
    }
  }

  throw new Error('Stream ended without a result')
}

export async function matchReportTemplates(
  query: string,
  sessionId: string,
  limit = 5,
): Promise<TemplateMatchResult> {
  type Resp = {
    timestamp?: string
    suggestions?: string[]
    content?: {
      message?: string
      data?: { totalMatches?: number; matches?: TemplateMatch[] }
      metadata?: { processingTime?: number; modelUsed?: string }
    }
  }

  const response = await fetch(buildUrl('/report/ai/api/analytics/template-match'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, sessionId, limit }),
  })
  const data = await parseJsonResponse<Resp>(response)
  const content = data.content ?? {}
  const payload = content.data ?? {}

  return {
    message: content.message ?? '',
    suggestions: data.suggestions ?? [],
    timestamp: data.timestamp ?? new Date().toISOString(),
    totalMatches: payload.totalMatches ?? 0,
    matches: payload.matches ?? [],
    metadata: content.metadata ?? null,
  }
}

export async function loadTemplate(xmlPath: string): Promise<TemplateDefinition> {
  const response = await fetch(
    buildUrl(`/report/ai/api/analytics/template/load?xmlPath=${encodeURIComponent(xmlPath)}`),
  )
  const data = await parseJsonResponse<{ template?: TemplateDefinition }>(response)
  if (!data.template) {
    throw new Error('Template payload missing in load response')
  }
  return data.template
}

export async function fetchEntityColumns(
  entity: string | string[],
  schema: string,
  dbname: string,
): Promise<EntityColumnOption[]> {
  const entities = Array.isArray(entity) ? entity.join(',') : entity
  const params = new URLSearchParams({ entities, schema, dbname })
  const response = await fetch(buildUrl(`/report/ai/api/analytics/template/columns?${params.toString()}`))
  const data = await parseJsonResponse<{ columns?: EntityColumnOption[] }>(response)
  return data.columns ?? []
}

export interface PopularColumnsResult {
  columns: EntityColumnOption[]
  conditionColumns: EntityColumnOption[]
}

export async function fetchPopularColumns(
  entities: string | string[],
  schema: string,
  dbname: string,
  existingColumns: string[],
): Promise<PopularColumnsResult> {
  const entitiesParam = Array.isArray(entities) ? entities.join(',') : entities
  const params = new URLSearchParams({
    entities: entitiesParam,
    schema,
    dbname,
    existing: existingColumns.join(','),
  })
  const response = await fetch(
    buildUrl(`/report/ai/api/analytics/template/popular-columns?${params.toString()}`),
  )
  const data = await parseJsonResponse<PopularColumnsResult>(response)
  return {
    columns: data.columns ?? [],
    conditionColumns: data.conditionColumns ?? [],
  }
}

export async function downloadTemplateXml(template: TemplateDefinition): Promise<void> {
  const response = await fetch(buildUrl('/report/ai/api/analytics/template/download'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(template),
  })

  if (!response.ok) {
    throw new Error(`Failed to download template XML (${response.status})`)
  }

  const blob = await response.blob()
  const disposition = response.headers.get('content-disposition') ?? ''
  const fileNameMatch = /filename="?([^";]+)"?/i.exec(disposition)
  const fileName = fileNameMatch?.[1] ?? 'edited_template.xml'
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
}
