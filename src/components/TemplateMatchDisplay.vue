<script setup lang="ts">
import type { TemplateMatch } from '../services/reportAiAssistant'

defineProps<{
  matches: TemplateMatch[]
  totalMatches: number
  displayMode?: 'recommendation' | 'catalogue'
}>()

const emit = defineEmits<{
  configure: [match: TemplateMatch]
}>()
</script>

<template>
  <!-- ── RECOMMENDATION MODE (similarity search result) ── -->
  <div v-if="displayMode !== 'catalogue'" class="tmd-root">
    <div class="tmd-header">
      <span class="tmd-count">{{ totalMatches }} template match{{ totalMatches === 1 ? '' : 'es' }} found</span>
    </div>

    <div v-if="matches.length === 0" class="tmd-empty">
      No templates matched above the similarity threshold. Try rephrasing your question.
    </div>

    <div v-else class="tmd-list">
      <div
        v-for="(match, index) in matches"
        :key="match.templateId"
        class="tmd-card"
        :class="{ 'is-high-confidence': match.isHighConfidence }"
        role="button"
        tabindex="0"
        @click="emit('configure', match)"
        @keydown.enter="emit('configure', match)"
      >
        <div class="tmd-rank">#{{ index + 1 }}</div>

        <div class="tmd-body">
          <div class="tmd-title-row">
            <span class="tmd-name">{{ match.templateName }}</span>
            <span v-if="match.isHighConfidence" class="tmd-hc-badge">HIGH CONFIDENCE</span>
            <span class="tmd-configure-hint">Configure →</span>
          </div>

          <div class="tmd-similarity-row">
            <div class="tmd-bar-track">
              <div class="tmd-bar-fill" :style="{ width: `${match.similarityPercent}%` }"></div>
            </div>
            <span class="tmd-pct">{{ match.similarityPercent }}%</span>
          </div>

          <div class="tmd-meta-row">
            <span class="tmd-label">Matched question:</span>
            <span class="tmd-matched-q">{{ match.matchedQuestion }}</span>
          </div>

          <div class="tmd-meta-row">
            <span class="tmd-label">Template file:</span>
            <code class="tmd-xml-path">{{ match.xmlPath }}</code>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ── CATALOGUE MODE (full template directory) ── -->
  <div v-else class="cat-root">
    <div class="cat-header">
      <span class="cat-icon">⊞</span>
      <span class="cat-title">{{ totalMatches }} available report templates</span>
    </div>

    <div class="cat-grid">
      <div
        v-for="match in matches"
        :key="match.templateId"
        class="cat-card"
        role="button"
        tabindex="0"
        @click="emit('configure', match)"
        @keydown.enter="emit('configure', match)"
      >
        <div class="cat-card-icon">📋</div>
        <div class="cat-card-body">
          <span class="cat-card-name">{{ match.templateName }}</span>
          <code class="cat-card-path">{{ match.xmlPath }}</code>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ══ RECOMMENDATION styles ══════════════════════════════════ */
.tmd-root {
  margin-top: 14px;
}

.tmd-header {
  margin-bottom: 10px;
  font-size: 13px;
  color: #606266;
}

.tmd-count {
  font-weight: 600;
}

.tmd-empty {
  font-size: 13px;
  color: #909399;
  font-style: italic;
  padding: 10px 0;
}

.tmd-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tmd-card {
  display: flex;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: #fff;
  cursor: pointer;
  transition: box-shadow 0.2s, border-color 0.2s;
}

.tmd-card:hover {
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.09);
  border-color: rgba(52, 176, 233, 0.35);
}

.tmd-card:focus-visible {
  outline: 2px solid #34b0e9;
  outline-offset: 2px;
}

.tmd-card.is-high-confidence {
  border-color: rgba(52, 176, 233, 0.35);
  background: rgba(52, 176, 233, 0.03);
}

.tmd-rank {
  font-size: 13px;
  font-weight: 700;
  color: #c0c4cc;
  min-width: 26px;
  padding-top: 2px;
}

.tmd-body {
  flex: 1;
  min-width: 0;
}

.tmd-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 7px;
  flex-wrap: wrap;
}

.tmd-name {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.tmd-hc-badge {
  font-size: 10px;
  font-weight: 700;
  color: #34b0e9;
  background: rgba(52, 176, 233, 0.12);
  border-radius: 4px;
  padding: 1px 5px;
  letter-spacing: 0.4px;
  flex-shrink: 0;
}

.tmd-similarity-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.tmd-bar-track {
  flex: 1;
  height: 6px;
  background: rgba(0, 0, 0, 0.08);
  border-radius: 3px;
  overflow: hidden;
}

.tmd-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #34b0e9, #bd56f8);
  border-radius: 3px;
  transition: width 0.5s ease;
}

.tmd-pct {
  font-size: 13px;
  font-weight: 600;
  color: #606266;
  min-width: 46px;
  text-align: right;
}

.tmd-meta-row {
  display: flex;
  align-items: baseline;
  gap: 5px;
  font-size: 12px;
  color: #606266;
  margin-top: 4px;
  flex-wrap: wrap;
}

.tmd-label {
  font-weight: 600;
  color: #909399;
  flex-shrink: 0;
}

.tmd-matched-q {
  color: #606266;
}

.tmd-xml-path {
  font-family: Consolas, 'Courier New', monospace;
  font-size: 11px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 3px;
  padding: 1px 5px;
  color: #909399;
  word-break: break-all;
}

.tmd-configure-hint {
  margin-left: auto;
  font-size: 11px;
  font-weight: 600;
  color: #aab4c0;
  white-space: nowrap;
  transition: color 0.18s;
}

.tmd-card:hover .tmd-configure-hint {
  color: #34b0e9;
}

/* ══ CATALOGUE styles ════════════════════════════════════════ */
.cat-root {
  margin-top: 14px;
}

.cat-header {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 12px;
  font-size: 13px;
  font-weight: 600;
  color: #606266;
}

.cat-icon {
  font-size: 15px;
  color: #67c23a;
}

.cat-title {
  color: #606266;
}

.cat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 10px;
}

.cat-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 13px;
  border-radius: 10px;
  border: 1px solid rgba(103, 194, 58, 0.25);
  background: linear-gradient(135deg, rgba(103, 194, 58, 0.04) 0%, rgba(255, 255, 255, 1) 100%);
  cursor: pointer;
  transition: box-shadow 0.18s, border-color 0.18s;
}

.cat-card:hover {
  box-shadow: 0 3px 12px rgba(103, 194, 58, 0.18);
  border-color: rgba(103, 194, 58, 0.6);
}

.cat-card:focus-visible {
  outline: 2px solid #67c23a;
  outline-offset: 2px;
}

.cat-card-icon {
  font-size: 18px;
  flex-shrink: 0;
  margin-top: 1px;
}

.cat-card-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.cat-card-name {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
  line-height: 1.35;
}

.cat-card-path {
  font-family: Consolas, 'Courier New', monospace;
  font-size: 10px;
  color: #b0b8c4;
  background: transparent;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
</style>
