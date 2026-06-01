<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import TemplateMatchDisplay from './TemplateMatchDisplay.vue'
import TemplateConfigPanel from './TemplateConfigPanel.vue'
import {
  checkAssistantHealth,
  fetchHistory,
  fetchSampleSuggestions,
  askAssistant,
  requestSessionId,
  type AskResult,
  type BackendHistoryMessage,
  type DetectedMode,
  type TemplateMatch,
} from '../services/reportAiAssistant'

type ChatMode = DetectedMode

interface ChatMessage {
  id: number
  role: 'assistant' | 'user'
  content: string
  timestamp: string
  suggestions?: string[]
  isLoading?: boolean
  isWelcomeMessage?: boolean
  mode?: ChatMode
  // SQL fields
  sqlQuery?: string | null
  sqlQueryReasoning?: string | null
  sqlQuerySources?: string[] | null
  sqlQueryAggregations?: string[] | null
  queryResult?: Array<Record<string, unknown>> | null
  chartConfig?: Record<string, unknown> | null
  // Template match fields
  templateMatches?: TemplateMatch[] | null
  totalMatches?: number | null
  configuringTemplate?: TemplateMatch | null
  // Shared
  metadata?: { processingTime?: number; modelUsed?: string; fromCache?: boolean } | null
  activeTab?: string
}

const FALLBACK_SUGGESTIONS = [
  'How many purchase orders were created this month?',
  'Show me late purchase order analysis',
  'Which suppliers have the best PO completion rate?',
]

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true })

const messages = ref<ChatMessage[]>([])
const userInput = ref('')
const sessionId = ref('')
const isSending = ref(false)
const isChatReady = ref(false)
const isNotConnected = ref(false)
const isCheckingConnection = ref(false)
const apiBase = (import.meta.env.VITE_AI_API as string | undefined) || 'http://localhost:6080'

const toTimestamp = (input?: string) => {
  if (!input) return new Date().toLocaleString()
  const d = new Date(input)
  return Number.isNaN(d.getTime()) ? new Date().toLocaleString() : d.toLocaleString()
}

const renderMarkdown = (content: string) =>
  DOMPurify.sanitize(markdown.render(content ?? ''))

const formatMs = (ms?: number) =>
  ms && Number.isFinite(ms) ? `${(ms / 1000).toFixed(2)}s` : ''

const scrollToBottom = async () => {
  await nextTick()
  const el = document.querySelector('.cv-scroll .el-scrollbar__wrap')
  if (el) el.scrollTop = el.scrollHeight
}

const defaultSqlTab = (msg: Partial<ChatMessage>) => {
  if (msg.queryResult?.length) return 'data'
  if (msg.sqlQueryReasoning) return 'explanation'
  if (msg.sqlQuery) return 'sql'
  return 'data'
}

const createWelcome = (suggestions: string[]): ChatMessage => ({
  id: Date.now(),
  role: 'assistant',
  content:
    'Hi, I am Report AI. Ask me anything — I will automatically detect whether you need a direct data answer or a specific report template.',
  timestamp: new Date().toLocaleString(),
  suggestions: suggestions.slice(0, 3),
  isWelcomeMessage: true,
})

const mapHistory = (history: BackendHistoryMessage[]): ChatMessage[] =>
  history
    .filter((e) => e && (e.content || e.message))
    .map((e, i) => ({
      id: Number(e.id) || Date.now() + i,
      role: e.role === 'user' ? ('user' as const) : ('assistant' as const),
      content: e.content ?? e.message ?? '',
      timestamp: toTimestamp(e.timestamp),
      suggestions:
        e.role === 'assistant' && Array.isArray(e.suggestions) ? e.suggestions : undefined,
    }))

const initializeChat = async () => {
  isChatReady.value = false
  isNotConnected.value = false

  let suggestions = [...FALLBACK_SUGGESTIONS]
  try {
    const fetched = await fetchSampleSuggestions()
    if (fetched.length > 0) suggestions = fetched.slice(0, 3)
  } catch {
    // keep fallback
  }

  try {
    sessionId.value = await requestSessionId()
    const history = await fetchHistory(sessionId.value)
    const mapped = mapHistory(history)
    messages.value = mapped.length > 0 ? mapped : [createWelcome(suggestions)]
  } catch {
    messages.value = [createWelcome(suggestions)]
    isNotConnected.value = true
  } finally {
    isChatReady.value = true
    await scrollToBottom()
  }
}

const retryConnection = async () => {
  if (isCheckingConnection.value) return
  isCheckingConnection.value = true
  try {
    const ok = await checkAssistantHealth(5000)
    isNotConnected.value = !ok
    if (ok && !sessionId.value) await initializeChat()
  } finally {
    isCheckingConnection.value = false
  }
}

const sendMessage = async (overridePrompt?: string) => {
  const prompt = (overridePrompt ?? userInput.value).trim()
  if (!prompt || isSending.value) return

  const now = new Date().toLocaleString()
  isSending.value = true
  isNotConnected.value = false

  messages.value.push({ id: Date.now(), role: 'user', content: prompt, timestamp: now })
  const loadingId = Date.now() + 1
  messages.value.push({ id: loadingId, role: 'assistant', content: '', timestamp: now, isLoading: true })
  if (!overridePrompt) userInput.value = ''
  await scrollToBottom()

  try {
    if (!sessionId.value) sessionId.value = await requestSessionId()
    const idx = messages.value.findIndex((m) => m.id === loadingId)
    if (idx === -1) return

    const result: AskResult = await askAssistant(prompt, sessionId.value, 5, (msg) => {
      const i = messages.value.findIndex((m) => m.id === loadingId)
      if (i !== -1) messages.value[i] = { ...messages.value[i], loadingHint: msg }
    })

    if (result.mode === 'template' || result.mode === 'list_templates') {
      messages.value[idx] = {
        id: loadingId,
        role: 'assistant',
        content: result.message,
        timestamp: toTimestamp(result.timestamp),
        suggestions: result.suggestions.slice(0, 3),
        isLoading: false,
        mode: result.mode,
        templateMatches: result.matches ?? [],
        totalMatches: result.totalMatches ?? 0,
        configuringTemplate: null,
        metadata: result.metadata,
      }
    } else {
      const partial = {
        queryResult: result.queryResult,
        sqlQueryReasoning: result.sqlQueryReasoning,
        sqlQuery: result.sqlQuery,
      }
      messages.value[idx] = {
        id: loadingId,
        role: 'assistant',
        content: result.message,
        timestamp: toTimestamp(result.timestamp),
        suggestions: result.suggestions.slice(0, 3),
        isLoading: false,
        mode: 'sql',
        sqlQuery: result.sqlQuery,
        sqlQueryReasoning: result.sqlQueryReasoning,
        sqlQuerySources: result.sqlQuerySources,
        sqlQueryAggregations: result.sqlQueryAggregations,
        queryResult: result.queryResult,
        chartConfig: result.chartConfig ?? null,
        metadata: result.metadata,
        activeTab: defaultSqlTab(partial),
      }
    }

    await scrollToBottom()
  } catch {
    isNotConnected.value = true
    const idx = messages.value.findIndex((m) => m.id === loadingId)
    if (idx !== -1) {
      messages.value[idx] = {
        ...messages.value[idx],
        content: 'Failed to get a response. Check the API connection and try again.',
        isLoading: false,
      }
    }
    await scrollToBottom()
  } finally {
    isSending.value = false
  }
}

const clearConversation = async () => {
  isNotConnected.value = false
  messages.value = []
  try {
    sessionId.value = await requestSessionId(true)
    const suggestions = await fetchSampleSuggestions().catch(() => [...FALLBACK_SUGGESTIONS])
    messages.value = [createWelcome(suggestions)]
  } catch {
    isNotConnected.value = true
  }
}

onMounted(() => void initializeChat())
</script>

<template>
  <div class="cv-root">
    <!-- Header -->
    <header class="cv-header">
      <div class="cv-header-left">
        <span class="cv-title">Report AI</span>
        <span class="cv-dev-badge">DEV</span>
      </div>
      <div class="cv-header-right">
        <el-button size="small" plain @click="clearConversation">Clear</el-button>
      </div>
    </header>

    <!-- Init loading -->
    <div v-if="!isChatReady" class="cv-init">
      <div class="cv-spinner"></div>
      <span class="cv-init-label">Connecting to Report AI...</span>
    </div>

    <!-- Messages -->
    <el-scrollbar v-else class="cv-scroll">
      <div class="cv-messages">
        <!-- Disconnected banner -->
        <div
          v-if="isNotConnected && !messages.some((m) => m.isLoading)"
          class="cv-conn-error"
        >
          <span>Unable to reach backend ({{ apiBase }})</span>
          <el-button size="small" :loading="isCheckingConnection" @click="retryConnection">
            {{ isCheckingConnection ? 'Checking…' : 'Retry' }}
          </el-button>
        </div>

        <div
          v-for="msg in messages"
          :key="msg.id"
          class="cv-row"
          :class="msg.role"
        >
          <div class="cv-bubble" :class="[msg.role, { 'is-template-result': msg.mode === 'template' || msg.mode === 'list_templates' }]">
            <!-- Loading -->
            <div v-if="msg.isLoading" class="cv-loading">
              <div class="cv-spinner small"></div>
              <span>{{ (msg as any).loadingHint ?? 'Processing…' }}</span>
            </div>

            <!-- Assistant message -->
            <template v-else-if="msg.role === 'assistant'">
              <div class="cv-md" v-html="renderMarkdown(msg.content)"></div>

              <!-- Template match / catalogue results -->
              <TemplateMatchDisplay
                v-if="!msg.configuringTemplate && (msg.mode === 'template' || msg.mode === 'list_templates') && Array.isArray(msg.templateMatches)"
                :matches="msg.templateMatches"
                :total-matches="msg.totalMatches ?? 0"
                :display-mode="msg.mode === 'list_templates' ? 'catalogue' : 'recommendation'"
                @configure="msg.configuringTemplate = $event"
              />

              <TemplateConfigPanel
                v-else-if="msg.configuringTemplate"
                :match="msg.configuringTemplate"
                @close="msg.configuringTemplate = null"
              />

              <!-- SQL results -->
              <el-tabs
                v-if="
                  msg.mode === 'sql' &&
                  ((msg.queryResult && msg.queryResult.length > 0) ||
                    msg.sqlQueryReasoning ||
                    msg.sqlQuery ||
                    msg.chartConfig)
                "
                v-model="msg.activeTab"
                type="border-card"
                class="cv-sql-tabs"
              >
                <el-tab-pane
                  v-if="msg.queryResult && msg.queryResult.length > 0"
                  label="Data"
                  name="data"
                >
                  <el-table :data="msg.queryResult" size="small" stripe max-height="300">
                    <el-table-column
                      v-for="col in Object.keys(msg.queryResult[0] ?? {})"
                      :key="col"
                      :prop="col"
                      :label="col"
                      min-width="120"
                      show-overflow-tooltip
                    />
                  </el-table>
                </el-tab-pane>

                <el-tab-pane v-if="msg.sqlQueryReasoning" label="Explanation" name="explanation">
                  <p class="cv-sql-reasoning">{{ msg.sqlQueryReasoning }}</p>
                  <div v-if="msg.sqlQuerySources?.length" class="cv-sql-meta">
                    <strong>Sources:</strong> {{ msg.sqlQuerySources.join(', ') }}
                  </div>
                  <div v-if="msg.sqlQueryAggregations?.length" class="cv-sql-meta">
                    <strong>Aggregations:</strong> {{ msg.sqlQueryAggregations.join('; ') }}
                  </div>
                </el-tab-pane>

                <el-tab-pane v-if="msg.sqlQuery" label="SQL" name="sql">
                  <pre class="cv-sql-code">{{ msg.sqlQuery }}</pre>
                </el-tab-pane>

                <el-tab-pane v-if="msg.chartConfig" label="Chart Config" name="chart">
                  <pre class="cv-sql-code cv-chart-config">{{ JSON.stringify(msg.chartConfig, null, 2) }}</pre>
                </el-tab-pane>
              </el-tabs>

              <!-- Metadata -->
              <div v-if="!msg.isWelcomeMessage && (msg.metadata || msg.mode)" class="cv-meta">
                <span v-if="msg.mode" class="cv-meta-chip cv-mode-chip" :class="'cv-mode-' + msg.mode">
                  {{ msg.mode === 'template' ? '◈ Template Match' : msg.mode === 'list_templates' ? '⊞ Template Catalogue' : '⟡ SQL Analytics' }}
                </span>
                <span v-if="msg.metadata?.modelUsed" class="cv-meta-chip">{{ msg.metadata.modelUsed }}</span>
                <span v-if="msg.metadata?.processingTime" class="cv-meta-chip">
                  {{ formatMs(msg.metadata.processingTime) }}
                </span>
                <span v-if="msg.metadata?.fromCache" class="cv-meta-chip">cached</span>
              </div>

              <!-- Follow-up suggestions -->
              <div v-if="msg.suggestions?.length" class="cv-suggestions">
                <button
                  v-for="s in msg.suggestions"
                  :key="s"
                  class="cv-suggestion"
                  @click="sendMessage(s)"
                >
                  {{ s }}
                </button>
              </div>
            </template>

            <!-- User message -->
            <template v-else>
              <span class="cv-user-text">{{ msg.content }}</span>
            </template>

            <!-- Timestamp -->
            <div class="cv-ts">{{ msg.timestamp }}</div>
          </div>
        </div>
      </div>
    </el-scrollbar>

    <!-- Input -->
    <footer class="cv-footer">
      <div class="cv-input-row">
        <el-input
          v-model="userInput"
          type="textarea"
          :rows="2"
          resize="none"
          placeholder="Ask a reporting question…"
          maxlength="500"
          show-word-limit
          :disabled="isSending"
          @keydown.enter.prevent="sendMessage()"
        />
        <el-button
          type="primary"
          :disabled="!userInput.trim() || isSending"
          :loading="isSending"
          @click="sendMessage()"
        >
          Send
        </el-button>
      </div>
      <p class="cv-disclaimer">AI-generated content. Verify results carefully.</p>
    </footer>
  </div>
</template>

<style scoped>
.cv-root {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  background: #f5f7fa;
  overflow: hidden;
}

/* ── Header ─────────────────────────────────── */
.cv-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  background: #fff;
  border-bottom: 1px solid #e4e7ed;
  flex-shrink: 0;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}

.cv-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cv-title {
  font-size: 16px;
  font-weight: 700;
  color: #303133;
}

.cv-dev-badge {
  font-size: 10px;
  font-weight: 700;
  color: #e6a23c;
  background: rgba(230, 162, 60, 0.12);
  border-radius: 4px;
  padding: 1px 6px;
  letter-spacing: 0.5px;
}

.cv-header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* ── Init loading ────────────────────────────── */
.cv-init {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  color: #909399;
  font-size: 14px;
}

.cv-init-label {
  color: #909399;
}

/* ── Messages ────────────────────────────────── */
.cv-scroll {
  flex: 1;
  min-height: 0;
}

.cv-messages {
  padding: 24px 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-width: 900px;
  margin: 0 auto;
  width: 100%;
}

.cv-conn-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  background: #fdf6ec;
  border: 1px solid #faecd8;
  border-radius: 8px;
  color: #e6a23c;
  font-size: 13px;
}

.cv-row {
  display: flex;
  width: 100%;
  animation: fadeIn 0.25s ease;
}

.cv-row.user {
  justify-content: flex-end;
}

.cv-row.assistant {
  justify-content: flex-start;
}

.cv-bubble {
  max-width: 80%;
  padding: 12px 16px 8px;
  border-radius: 16px;
  font-size: 14px;
  line-height: 1.55;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.07);
}

.cv-bubble.assistant {
  background: #fff;
  border-bottom-left-radius: 4px;
  color: #303133;
}

.cv-bubble.user {
  background: linear-gradient(135deg, #34b0e9, #6b8dfe);
  color: #fff;
  border-bottom-right-radius: 4px;
}

.cv-bubble.assistant.is-template-result {
  max-width: 96%;
}

.cv-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #909399;
  font-size: 13px;
  padding: 4px 0;
}

/* ── Markdown content ────────────────────────── */
.cv-md :deep(p) { margin: 0 0 8px; }
.cv-md :deep(p:last-child) { margin-bottom: 0; }
.cv-md :deep(ul), .cv-md :deep(ol) { margin: 6px 0 8px 18px; }
.cv-md :deep(strong) { font-weight: 700; }
.cv-md :deep(code) {
  font-family: Consolas, monospace;
  font-size: 0.88em;
  background: rgba(0, 0, 0, 0.06);
  border-radius: 3px;
  padding: 1px 4px;
}

.cv-user-text {
  white-space: pre-wrap;
  word-break: break-word;
}

/* ── SQL tabs ────────────────────────────────── */
.cv-sql-tabs {
  margin-top: 14px;
  border-radius: 8px;
  overflow: hidden;
}

.cv-sql-reasoning {
  font-size: 13px;
  color: #606266;
  line-height: 1.55;
  margin: 0 0 8px;
}

.cv-sql-meta {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}

.cv-sql-code {
  font-family: Consolas, 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
  padding: 12px;
  background: #f7f8fb;
  border-radius: 6px;
  color: #303133;
}

.cv-chart-config {
  background: #fefbf2;
  border: 1px solid rgba(230, 162, 60, 0.2);
}

/* ── Metadata ────────────────────────────────── */
.cv-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.cv-meta-chip {
  font-size: 11px;
  color: #c0c4cc;
  background: rgba(0, 0, 0, 0.04);
  border-radius: 10px;
  padding: 1px 7px;
}

.cv-mode-chip {
  font-weight: 600;
  font-size: 11px;
}

.cv-mode-template {
  color: #34b0e9;
  background: rgba(52, 176, 233, 0.1);
}

.cv-mode-list_templates {
  color: #67c23a;
  background: rgba(103, 194, 58, 0.12);
}

.cv-mode-sql {
  color: #bd56f8;
  background: rgba(189, 86, 248, 0.1);
}

/* ── Suggestions ─────────────────────────────── */
.cv-suggestions {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.cv-suggestion {
  font-size: 12px;
  padding: 5px 12px;
  border-radius: 14px;
  border: 1px solid #e4e7ed;
  background: #f5f7fa;
  color: #606266;
  cursor: pointer;
  transition: all 0.2s;
  line-height: 1.4;
  text-align: left;
  word-break: break-word;
}

.cv-suggestion:hover {
  background: #ecf5ff;
  border-color: #b3d8ff;
  color: #409eff;
}

/* ── Timestamp ───────────────────────────────── */
.cv-ts {
  font-size: 10px;
  color: #c0c4cc;
  text-align: right;
  margin-top: 6px;
}

.cv-bubble.user .cv-ts {
  color: rgba(255, 255, 255, 0.6);
}

/* ── Footer ──────────────────────────────────── */
.cv-footer {
  flex-shrink: 0;
  padding: 14px 24px;
  border-top: 1px solid #e4e7ed;
  background: #fff;
}

.cv-input-row {
  display: flex;
  gap: 10px;
  align-items: flex-end;
}

.cv-input-row :deep(.el-textarea) {
  flex: 1;
}

.cv-disclaimer {
  font-size: 11px;
  text-align: center;
  margin: 8px 0 0;
  color: #c0c4cc;
}

/* ── Spinner ─────────────────────────────────── */
.cv-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #e5e7eb;
  border-top-color: #409eff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  flex-shrink: 0;
}

.cv-spinner.small {
  width: 16px;
  height: 16px;
  border-width: 2px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
</style>
