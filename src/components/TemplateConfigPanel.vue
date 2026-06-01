<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import {
  COMPARATORS_BY_TYPE,
  downloadTemplateXml,
  fetchEntityColumns,
  fetchPopularColumns,
  loadTemplate,
  type EntityColumnOption,
  type TemplateDefinition,
  type TemplateMatch,
  type TemplatePostColumn,
  type TemplatePostCondition,
} from '../services/reportAiAssistant'

const props = defineProps<{ match: TemplateMatch }>()
const emit = defineEmits<{ close: [] }>()

// ── State ────────────────────────────────────────────────────────────────
const isLoading = ref(false)
const isSaving = ref(false)
const loadError = ref('')
const template = ref<TemplateDefinition | null>(null)
const columns = ref<TemplatePostColumn[]>([])
const conditions = ref<TemplatePostCondition[]>([])
const availableColumns = ref<EntityColumnOption[]>([])

const isRecommending = ref(false)
const _aiColSuggestionsSource = ref<EntityColumnOption[]>([])
const _aiCondSuggestionsSource = ref<EntityColumnOption[]>([])

const aiColSuggestions = computed(() => {
  const existing = new Set(columns.value.map((c) => `${c.EntityName}::${c.ColName}`))
  return _aiColSuggestionsSource.value.filter((c) => !existing.has(`${c.entityName}::${c.colName}`))
})
const aiCondSuggestions = computed(() => {
  const existing = new Set(conditions.value.map((c) => `${c.EntityName}::${c.ColName}`))
  return _aiCondSuggestionsSource.value.filter((c) => !existing.has(`${c.entityName}::${c.colName}`))
})

const showColPopover = ref(false)
const colSearch = ref('')
const showCondPopover = ref(false)
const condSearch = ref('')

// ── Computed ─────────────────────────────────────────────────────────────
const isMultiEntity = computed(() => new Set(columns.value.map((c) => c.EntityName)).size > 1)
const entityList = computed(() => [...new Set(columns.value.map((c) => c.EntityName))])

const addableColumns = computed(() => {
  const existing = new Set(columns.value.map((c) => `${c.EntityName}::${c.ColName}`))
  return availableColumns.value.filter((c) => !existing.has(`${c.entityName}::${c.colName}`))
})

const filteredAddable = computed(() => {
  const q = colSearch.value.toLowerCase()
  return q ? addableColumns.value.filter((c) => c.colName.toLowerCase().includes(q)) : addableColumns.value
})

const filteredConditionColumns = computed(() => {
  const q = condSearch.value.toLowerCase()
  return q ? availableColumns.value.filter((c) => c.colName.toLowerCase().includes(q)) : availableColumns.value
})

function groupByEntity(cols: EntityColumnOption[]): { entity: string; cols: EntityColumnOption[] }[] {
  const map = new Map<string, EntityColumnOption[]>()
  for (const col of cols) {
    if (!map.has(col.entityName)) map.set(col.entityName, [])
    map.get(col.entityName)!.push(col)
  }
  return [...map.entries()].map(([entity, c]) => ({ entity, cols: c }))
}

const noValueComparators = new Set([
  'isnull', 'isnotnull', 'today', 'thisweek', 'thismonth',
  'yesterday', 'previousweek', 'previousmonth',
])
function needsValueInput(comparison: string): boolean {
  return !noValueComparators.has((comparison ?? '').toLowerCase())
}

// ── Column actions ────────────────────────────────────────────────────────
function reindex(): void {
  columns.value = columns.value.map((col, i) => ({ ...col, Seq: i + 1 }))
}
function removeColumn(i: number): void {
  columns.value.splice(i, 1)
  reindex()
}
function addColumnFromOption(col: EntityColumnOption): void {
  if (!template.value) return
  columns.value.push({
    DBName: template.value.mainEntity.dbName,
    SchemaName: template.value.mainEntity.schemaName,
    EntityName: col.entityName,
    ColName: col.colName,
    DataType: col.dataType,
    Seq: columns.value.length + 1,
    DisplayName: col.colName,
  })
  reindex()
}
function addAiColumn(col: EntityColumnOption): void {
  addColumnFromOption(col)
}

// ── Condition actions ─────────────────────────────────────────────────────
function addConditionFromCol(col: EntityColumnOption): void {
  if (!template.value) return
  conditions.value.push({
    DBName: template.value.mainEntity.dbName,
    SchemaName: template.value.mainEntity.schemaName,
    EntityName: col.entityName,
    ColName: col.colName,
    DataType: col.dataType,
    Comparison: COMPARATORS_BY_TYPE[col.dataType][0],
    Value: '',
    ConditionValue: 'value',
    Level: 0,
  })
  showCondPopover.value = false
  condSearch.value = ''
}
function addAiCondition(col: EntityColumnOption): void {
  addConditionFromCol(col)
}
function onConditionColChange(condition: TemplatePostCondition, key: string): void {
  const separatorIdx = key.indexOf('::')
  const entityName = key.slice(0, separatorIdx)
  const colName = key.slice(separatorIdx + 2)
  const source = availableColumns.value.find((c) => c.colName === colName && c.entityName === entityName)
  if (!source || !template.value) return
  condition.ColName = source.colName
  condition.EntityName = source.entityName
  condition.DBName = template.value.mainEntity.dbName
  condition.SchemaName = template.value.mainEntity.schemaName
  condition.DataType = source.dataType
  condition.Comparison = COMPARATORS_BY_TYPE[source.dataType][0]
  condition.Value = ''
}

// ── Download ──────────────────────────────────────────────────────────────
async function handleDownload(): Promise<void> {
  if (!template.value) return
  isSaving.value = true
  try {
    await downloadTemplateXml({
      ...template.value,
      columns: columns.value.map((col, i) => ({ ...col, Seq: i + 1 })),
      conditions: conditions.value,
    })
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Failed to download'
  } finally {
    isSaving.value = false
  }
}

// ── AI recommendations (background, non-blocking) ────────────────────────
async function fireRecommendations(loaded: TemplateDefinition, entityNames: string[]): Promise<void> {
  isRecommending.value = true
  try {
    const result = await fetchPopularColumns(
      entityNames,
      loaded.mainEntity.schemaName,
      loaded.mainEntity.dbName,
      loaded.columns.map((c) => c.ColName),
    )
    _aiColSuggestionsSource.value = result.columns
    _aiCondSuggestionsSource.value = result.conditionColumns
  } catch {
    // silent — suggestions are best-effort
  } finally {
    isRecommending.value = false
  }
}

// ── Mount ─────────────────────────────────────────────────────────────────
onMounted(async () => {
  isLoading.value = true
  loadError.value = ''
  try {
    const loaded = await loadTemplate(props.match.xmlPath)
    template.value = loaded
    columns.value = [...loaded.columns].sort((a, b) => Number(a.Seq) - Number(b.Seq))
    conditions.value = [...loaded.conditions]
    const entityNames = [...new Set(loaded.columns.map((c) => c.EntityName))]
    availableColumns.value = await fetchEntityColumns(
      entityNames.length === 1 ? entityNames[0] : entityNames,
      loaded.mainEntity.schemaName,
      loaded.mainEntity.dbName,
    )
    fireRecommendations(loaded, entityNames)
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Failed to load template'
  } finally {
    isLoading.value = false
  }
})

// ── Popover blur-close ────────────────────────────────────────────────────
function onColPopoverBlur(e: FocusEvent): void {
  if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
    showColPopover.value = false
    colSearch.value = ''
  }
}
function onCondPopoverBlur(e: FocusEvent): void {
  if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
    showCondPopover.value = false
    condSearch.value = ''
  }
}
</script>

<template>
  <div class="tcp-root">

    <!-- Header -->
    <div class="tcp-header">
      <button class="tcp-back" type="button" @click="emit('close')">&larr; Back</button>
      <div class="tcp-title-wrap">
        <div class="tcp-title">{{ match.templateName }}</div>
        <div v-if="match.description" class="tcp-subtitle">{{ match.description }}</div>
      </div>
    </div>

    <div v-if="isLoading" class="tcp-loading">Loading template...</div>
    <div v-else-if="loadError" class="tcp-error">{{ loadError }}</div>

    <div v-else-if="template" class="tcp-content">

      <!-- ── COLUMNS ──────────────────────────────────────── -->
      <section class="tcp-section">
        <div class="tcp-section-head">
          <h4>Fields &amp; measures</h4>
          <span class="tcp-hint">Drag to reorder &middot; click &times; to remove</span>
        </div>

        <!-- Draggable pills -->
        <VueDraggable
          v-model="columns"
          class="tcp-pills"
          :animation="180"
          handle=".pill-drag"
          @end="reindex"
        >
          <div
            v-for="(col, idx) in columns"
            :key="`${col.EntityName}::${col.ColName}::${idx}`"
            class="pill"
            :class="{ 'pill--aggregate': col.Aggregate }"
            :data-tooltip="`${col.ColName} · ${col.DataType}${isMultiEntity ? ' · ' + col.EntityName : ''}${col.Aggregate ? ' · Σ ' + col.Aggregate : ''}`"
          >
            <span class="pill-drag" title="Drag to reorder">&#8286;</span>
            <input v-model="col.DisplayName" class="pill-label" />
            <span v-if="isMultiEntity" class="pill-entity">{{ col.EntityName }}</span>
            <span class="pill-type" :title="col.DataType">{{ col.DataType[0] }}</span>
            <span v-if="col.Aggregate" class="pill-agg" :title="'Aggregate: ' + col.Aggregate">Σ</span>
            <button class="pill-remove" type="button" title="Remove" @click="removeColumn(idx)">&times;</button>
          </div>
        </VueDraggable>

        <!-- AI suggestions strip -->
        <div v-if="isRecommending" class="tcp-ai-loading">
          <span class="tcp-ai-icon">&#x2736;</span> Getting AI suggestions...
        </div>
        <div v-else-if="aiColSuggestions.length" class="tcp-suggestions">
          <span class="tcp-ai-icon">&#x2736;</span>
          <span class="tcp-sugg-label">Add suggested:</span>
          <button
            v-for="col in aiColSuggestions"
            :key="`${col.entityName}::${col.colName}`"
            type="button"
            class="sugg-pill"
            @click="addAiColumn(col)"
          >
            + {{ col.colName }}<span v-if="isMultiEntity" class="sugg-entity">&nbsp;{{ col.entityName }}</span>
          </button>
        </div>

        <!-- Add column popover trigger -->
        <div class="tcp-add-wrap" @focusout="onColPopoverBlur">
          <button type="button" class="tcp-add-btn" @click="showColPopover = !showColPopover">
            + Add column
          </button>
          <div v-if="showColPopover" class="tcp-popover" tabindex="-1">
            <input
              v-model="colSearch"
              class="tcp-pop-search"
              placeholder="Search columns..."
              autofocus
            />
            <div class="tcp-pop-list">
              <div v-if="filteredAddable.length === 0" class="tcp-pop-empty">No more columns available</div>
              <template v-for="group in groupByEntity(filteredAddable)" :key="group.entity">
                <div v-if="isMultiEntity" class="tcp-pop-group">{{ group.entity }}</div>
                <button
                  v-for="col in group.cols"
                  :key="`${col.entityName}::${col.colName}`"
                  type="button"
                  class="tcp-pop-item"
                  @click="addColumnFromOption(col); showColPopover = false; colSearch = ''"
                >
                  <span class="pop-col-name">{{ col.colName }}</span>
                  <span class="pop-col-type">{{ col.dataType }}</span>
                </button>
              </template>
            </div>
          </div>
        </div>
      </section>

      <!-- ── CONDITIONS ────────────────────────────────────── -->
      <section class="tcp-section">
        <div class="tcp-section-head">
          <h4>Conditions</h4>
        </div>

        <div
          v-if="conditions.length === 0 && !isRecommending && !aiCondSuggestions.length"
          class="tcp-empty"
        >
          No conditions configured.
        </div>

        <div
          v-for="(cond, idx) in conditions"
          :key="`cond-${idx}`"
          class="tcp-cond-row"
        >
          <select
            :value="`${cond.EntityName}::${cond.ColName}`"
            class="tcp-select cond-col"
            @change="onConditionColChange(cond, ($event.target as HTMLSelectElement).value)"
          >
            <template v-for="group in groupByEntity(availableColumns)" :key="group.entity">
              <optgroup v-if="isMultiEntity" :label="group.entity">
                <option
                  v-for="col in group.cols"
                  :key="`${col.entityName}::${col.colName}`"
                  :value="`${col.entityName}::${col.colName}`"
                >{{ col.colName }}</option>
              </optgroup>
              <template v-else>
                <option
                  v-for="col in group.cols"
                  :key="`${col.entityName}::${col.colName}`"
                  :value="`${col.entityName}::${col.colName}`"
                >{{ col.colName }}</option>
              </template>
            </template>
          </select>

          <select v-model="cond.Comparison" class="tcp-select cond-comp">
            <option
              v-for="comp in COMPARATORS_BY_TYPE[cond.DataType]"
              :key="comp"
              :value="comp"
            >{{ comp }}</option>
          </select>

          <input
            v-if="needsValueInput(cond.Comparison)"
            v-model="cond.Value"
            class="tcp-input cond-val"
            :placeholder="cond.Comparison === 'customperiod' ? 'YYYY-MM-DD|YYYY-MM-DD' : 'Value'"
          />

          <button
            type="button"
            class="pill-remove cond-del"
            title="Remove"
            @click="conditions.splice(idx, 1)"
          >&times;</button>
        </div>

        <!-- AI condition suggestions -->
        <div v-if="isRecommending" class="tcp-ai-loading">
          <span class="tcp-ai-icon">&#x2736;</span> Getting AI suggestions...
        </div>
        <div v-else-if="aiCondSuggestions.length" class="tcp-suggestions">
          <span class="tcp-ai-icon">&#x2736;</span>
          <span class="tcp-sugg-label">Suggested filters:</span>
          <button
            v-for="col in aiCondSuggestions"
            :key="`${col.entityName}::${col.colName}`"
            type="button"
            class="sugg-pill cond-sugg"
            @click="addAiCondition(col)"
          >
            + {{ col.colName }}<span v-if="isMultiEntity" class="sugg-entity">&nbsp;{{ col.entityName }}</span>
          </button>
        </div>

        <!-- Add condition popover trigger -->
        <div class="tcp-add-wrap" @focusout="onCondPopoverBlur">
          <button type="button" class="tcp-add-btn" @click="showCondPopover = !showCondPopover">
            + Add condition
          </button>
          <div v-if="showCondPopover" class="tcp-popover" tabindex="-1">
            <input
              v-model="condSearch"
              class="tcp-pop-search"
              placeholder="Search columns..."
              autofocus
            />
            <div class="tcp-pop-list">
              <div v-if="filteredConditionColumns.length === 0" class="tcp-pop-empty">No columns found</div>
              <template v-for="group in groupByEntity(filteredConditionColumns)" :key="group.entity">
                <div v-if="isMultiEntity" class="tcp-pop-group">{{ group.entity }}</div>
                <button
                  v-for="col in group.cols"
                  :key="`${col.entityName}::${col.colName}`"
                  type="button"
                  class="tcp-pop-item"
                  @click="addConditionFromCol(col)"
                >
                  <span class="pop-col-name">{{ col.colName }}</span>
                  <span class="pop-col-type">{{ col.dataType }}</span>
                </button>
              </template>
            </div>
          </div>
        </div>
      </section>

      <!-- Footer -->
      <div class="tcp-footer">
        <button
          type="button"
          class="tcp-btn-primary"
          :disabled="isSaving"
          @click="handleDownload"
        >
          {{ isSaving ? 'Preparing...' : 'Download XML' }}
        </button>
      </div>

    </div>
  </div>
</template>

<style scoped>
/* Root */
.tcp-root {
  margin-top: 14px;
  border: 1px solid rgba(52, 176, 233, 0.2);
  border-radius: 12px;
  padding: 14px;
  background: #fff;
}

/* Header */
.tcp-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.tcp-back {
  border: 1px solid rgba(0, 0, 0, 0.15);
  background: #fff;
  border-radius: 6px;
  font-size: 12px;
  padding: 5px 9px;
  cursor: pointer;
  flex-shrink: 0;
}
.tcp-back:hover { background: #f5f7fa; }
.tcp-title-wrap { min-width: 0; }
.tcp-title { font-size: 14px; font-weight: 700; color: #303133; }
.tcp-subtitle { font-size: 11px; color: #909399; margin-top: 2px; }

/* Layout */
.tcp-content { display: flex; flex-direction: column; gap: 12px; }
.tcp-section {
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
  padding: 12px;
}
.tcp-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.tcp-section-head h4 {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: #303133;
}
.tcp-hint { font-size: 11px; color: #c0c4cc; }

/* Draggable pills area */
.tcp-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 36px;
  margin-bottom: 10px;
}

/* Individual pill */
.pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: #f0f7ff;
  border: 1px solid rgba(52, 176, 233, 0.3);
  border-radius: 999px;
  padding: 4px 8px 4px 6px;
  font-size: 12px;
  user-select: none;
  cursor: default;
}
.pill:hover { border-color: rgba(52, 176, 233, 0.55); }
.pill-drag {
  color: #c0c4cc;
  cursor: grab;
  font-size: 14px;
  line-height: 1;
  flex-shrink: 0;
}
.pill-drag:active { cursor: grabbing; }
.pill-label {
  border: none;
  background: transparent;
  font-size: 12px;
  color: #303133;
  width: 90px;
  min-width: 40px;
  max-width: 150px;
  outline: none;
  padding: 0;
  cursor: text;
}
.pill-label:focus { border-bottom: 1px solid #34b0e9; }
.pill-entity {
  font-size: 10px;
  color: #4a9926;
  background: rgba(103, 194, 58, 0.1);
  border-radius: 999px;
  padding: 1px 5px;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
}
.pill-type {
  font-size: 10px;
  font-weight: 700;
  color: #34b0e9;
  background: rgba(52, 176, 233, 0.1);
  border-radius: 999px;
  width: 16px;
  text-align: center;
  flex-shrink: 0;
}
.pill-remove {
  border: none;
  background: none;
  color: #c0c4cc;
  font-size: 15px;
  cursor: pointer;
  line-height: 1;
  padding: 0;
  flex-shrink: 0;
}
.pill-remove:hover { color: #f56c6c; }

/* Aggregate variant */
.pill--aggregate {
  border-color: rgba(230, 162, 60, 0.45);
  background: #fffbf0;
}
.pill--aggregate:hover { border-color: rgba(230, 162, 60, 0.7); }
.pill-agg {
  font-size: 10px;
  font-weight: 700;
  color: #d48806;
  background: rgba(230, 162, 60, 0.12);
  border-radius: 999px;
  width: 16px;
  text-align: center;
  flex-shrink: 0;
}

/* Rich CSS tooltip */
.pill[data-tooltip] {
  position: relative;
}
.pill[data-tooltip]::after {
  content: attr(data-tooltip);
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  background: #1d2329;
  color: #e8eaed;
  font-size: 11px;
  font-family: inherit;
  line-height: 1.5;
  white-space: nowrap;
  padding: 5px 9px;
  border-radius: 6px;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s;
  z-index: 300;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.25);
}
.pill[data-tooltip]:hover::after {
  opacity: 1;
}

/* AI loading / suggestions strip */
.tcp-ai-loading {
  font-size: 12px;
  color: #bd56f8;
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  animation: pulse 1.4s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
.tcp-suggestions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  padding: 7px 10px;
  background: rgba(189, 86, 248, 0.04);
  border: 1px dashed rgba(189, 86, 248, 0.28);
  border-radius: 8px;
}
.tcp-ai-icon { color: #bd56f8; font-size: 13px; flex-shrink: 0; }
.tcp-sugg-label { font-size: 11px; font-weight: 600; color: #909399; }
.sugg-pill {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid rgba(189, 86, 248, 0.35);
  background: rgba(189, 86, 248, 0.06);
  color: #8b3dba;
  cursor: pointer;
  transition: background 0.14s;
}
.sugg-pill:hover { background: rgba(189, 86, 248, 0.14); }
.sugg-entity {
  font-size: 10px;
  color: #4a9926;
  background: rgba(103, 194, 58, 0.12);
  border-radius: 999px;
  padding: 0 4px;
}
.cond-sugg { border-radius: 7px; }

/* Add column / condition popover */
.tcp-add-wrap {
  position: relative;
  display: inline-block;
}
.tcp-add-btn {
  font-size: 12px;
  color: #34b0e9;
  border: 1px dashed rgba(52, 176, 233, 0.45);
  background: rgba(52, 176, 233, 0.04);
  border-radius: 6px;
  padding: 5px 11px;
  cursor: pointer;
  transition: background 0.14s;
}
.tcp-add-btn:hover { background: rgba(52, 176, 233, 0.1); }
.tcp-popover {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 200;
  width: 290px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 10px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.13);
  overflow: hidden;
}
.tcp-pop-search {
  display: block;
  width: 100%;
  box-sizing: border-box;
  border: none;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  padding: 9px 12px;
  font-size: 12px;
  outline: none;
}
.tcp-pop-list {
  max-height: 230px;
  overflow-y: auto;
}
.tcp-pop-group {
  padding: 5px 12px 3px;
  font-size: 10px;
  font-weight: 700;
  color: #909399;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  background: #fafafa;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  position: sticky;
  top: 0;
}
.tcp-pop-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 7px 12px;
  border: none;
  background: none;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  color: #303133;
  box-sizing: border-box;
}
.tcp-pop-item:hover { background: #f5f7fa; }
.pop-col-name { flex: 1; }
.pop-col-type { font-size: 10px; color: #c0c4cc; margin-left: 8px; }
.tcp-pop-empty { padding: 14px 12px; font-size: 12px; color: #c0c4cc; text-align: center; }

/* Conditions */
.tcp-cond-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 7px;
  flex-wrap: wrap;
}
.tcp-select {
  border: 1px solid rgba(0, 0, 0, 0.15);
  border-radius: 6px;
  padding: 5px 7px;
  font-size: 12px;
  background: #fff;
  min-height: 30px;
}
.cond-col { flex: 2; min-width: 120px; }
.cond-comp { flex: 1.5; min-width: 100px; }
.tcp-input {
  border: 1px solid rgba(0, 0, 0, 0.15);
  border-radius: 6px;
  padding: 5px 8px;
  font-size: 12px;
  min-height: 30px;
  box-sizing: border-box;
}
.cond-val { flex: 1.5; min-width: 80px; }
.cond-del { font-size: 17px; flex-shrink: 0; }

/* Footer */
.tcp-footer {
  display: flex;
  justify-content: flex-end;
  padding-top: 4px;
}
.tcp-btn-primary {
  background: #34b0e9;
  color: #fff;
  border: none;
  border-radius: 7px;
  padding: 8px 18px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.14s;
}
.tcp-btn-primary:not(:disabled):hover { background: #1a9fd4; }
.tcp-btn-primary:disabled { opacity: 0.55; cursor: default; }

/* Misc */
.tcp-loading, .tcp-empty { font-size: 12px; color: #909399; padding: 4px 0; }
.tcp-error { font-size: 12px; color: #f56c6c; padding: 4px 0; }
</style>
