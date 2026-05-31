<script setup lang="ts">
import type { ChartSpec } from '~/lib/chart-spec'
import type { WorkRecord } from '~/lib/store'
import { defaultSpec, guessFields, parseCsv } from '~/lib/chart-spec'
import { getWorkBySlug, makeSlug, newId, saveWork } from '~/lib/store'

const route = useRoute()

// ── 数据状态 ──
const hasData = ref(false)
const csvText = ref('')
const columns = ref<string[]>([])
const previewRows = ref<Record<string, string>[]>([])
const rowCount = ref(0)
const fileName = ref('')
const loadError = ref('')
const dragOver = ref(false)

// ── 作品状态 ──
const title = ref('')
const spec = reactive<ChartSpec>(defaultSpec())
const saving = ref(false)
const editingId = ref<string | null>(null)
const existingSlug = ref<string | null>(null)
const createdAt = ref(0)

const canvas = ref<{ captureThumbnail: () => Promise<string | undefined> } | null>(null)

const SAMPLES: Record<string, { file: string, title: string, preset?: Partial<ChartSpec> }> = {
  basic: { file: '/samples/sample-basic.csv', title: '基础示例' },
  llm: {
    file: '/samples/sample-llm.csv',
    title: 'LLM Elo 天梯榜',
    preset: { idField: 'model', valueField: 'rating', stepField: 'date', stepMode: 'seconds', colorField: 'company', topN: 12 },
  },
}

const stepModeOptions = [
  { label: '自动识别', value: 'auto' },
  { label: '日期字符串', value: 'date' },
  { label: 'Unix 秒', value: 'seconds' },
  { label: 'Unix 毫秒', value: 'milliseconds' },
  { label: '纯数字', value: 'number' },
]
const scaleOptions = [
  { label: '自适应', value: 'adaptive' },
  { label: '从 0 起', value: 'from-zero' },
  { label: '放大差异', value: 'from-min' },
]

// 把一份 CSV 文本灌进编辑器：解析列、预览前几行、初始化字段映射。
function loadText(text: string, name: string, preset?: Partial<ChartSpec>) {
  loadError.value = ''
  try {
    const rows = parseCsv(text)
    if (!rows.columns?.length || rows.length === 0)
      throw new Error('未解析到任何列，请确认是带表头的 CSV')

    csvText.value = text
    columns.value = [...rows.columns]
    previewRows.value = rows.slice(0, 5) as Record<string, string>[]
    rowCount.value = rows.length
    fileName.value = name

    const guessed = defaultSpec(columns.value)
    Object.assign(spec, guessed, preset)
    // 映射越界保护：preset/猜测的列若不存在，回退到首列。
    const g = guessFields(columns.value)
    if (!columns.value.includes(spec.idField))
      spec.idField = g.id
    if (!columns.value.includes(spec.valueField))
      spec.valueField = g.value
    if (!columns.value.includes(spec.stepField))
      spec.stepField = g.step

    if (!title.value)
      title.value = name.replace(/\.[^.]+$/, '')
    hasData.value = true
  }
  catch (e) {
    loadError.value = e instanceof Error ? e.message : '解析失败'
  }
}

async function onFile(file: File | undefined | null) {
  if (!file)
    return
  if (file.size > 50 * 1024 * 1024) {
    loadError.value = '文件过大，上限 50 MB'
    return
  }
  const text = await file.text()
  loadText(text, file.name)
}

function onPick(e: Event) {
  onFile((e.target as HTMLInputElement).files?.[0])
}
function onDrop(e: DragEvent) {
  dragOver.value = false
  onFile(e.dataTransfer?.files?.[0])
}

async function loadSample(key: string) {
  const s = SAMPLES[key]
  if (!s)
    return
  const text = await (await fetch(s.file)).text()
  title.value = s.title
  loadText(text, s.title, s.preset)
}

// 进入编辑既有作品（详情页「编辑」跳转）。
async function loadExisting(slug: string) {
  const rec = await getWorkBySlug(slug)
  if (!rec)
    return
  editingId.value = rec.id
  existingSlug.value = rec.slug
  createdAt.value = rec.createdAt
  title.value = rec.title
  loadText(rec.csvText, rec.title)
  Object.assign(spec, rec.spec)
}

onMounted(() => {
  const sample = route.query.sample as string | undefined
  const edit = route.query.edit as string | undefined
  if (edit)
    loadExisting(edit)
  else if (sample)
    loadSample(sample)
})

const colorOptions = computed(() => [{ label: '跟随 id（每项一色）', value: '' }, ...columns.value.map(c => ({ label: c, value: c }))])
const labelOptions = computed(() => [{ label: '跟随 id', value: '' }, ...columns.value.map(c => ({ label: c, value: c }))])

async function save() {
  if (!hasData.value || saving.value)
    return
  saving.value = true
  try {
    const thumbnail = await canvas.value?.captureThumbnail()
    const now = Date.now()
    const slug = existingSlug.value ?? makeSlug(title.value || '未命名作品')
    const record: WorkRecord = {
      id: editingId.value ?? newId(),
      slug,
      title: title.value || '未命名作品',
      spec: JSON.parse(JSON.stringify(spec)),
      csvText: csvText.value,
      columns: [...columns.value],
      rowCount: rowCount.value,
      thumbnail,
      createdAt: createdAt.value || now,
      updatedAt: now,
    }
    await saveWork(record)
    await navigateTo(`/w/${slug}`)
  }
  finally {
    saving.value = false
  }
}

function reset() {
  hasData.value = false
  csvText.value = ''
  columns.value = []
  previewRows.value = []
  loadError.value = ''
}
</script>

<template>
  <div class="editor">
    <!-- 顶部工具条 -->
    <div class="toolbar">
      <NuxtLink to="/" class="btn btn-ghost btn-icon" title="返回">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 12H5M11 18l-6-6 6-6" />
        </svg>
      </NuxtLink>
      <input v-model="title" class="input title-input" placeholder="作品标题" :disabled="!hasData">
      <div class="toolbar-right">
        <span v-if="hasData" class="badge">{{ rowCount }} 行 · {{ columns.length }} 列</span>
        <button class="btn btn-primary" :disabled="!hasData || saving" @click="save">
          <svg v-if="!saving" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M17 21v-8H7v8M7 3v5h8" />
          </svg>
          {{ saving ? '保存中…' : '保存作品' }}
        </button>
      </div>
    </div>

    <!-- 未导入数据：上传区 -->
    <div v-if="!hasData" class="dropzone-wrap">
      <label
        class="dropzone" :class="{ over: dragOver }"
        @dragover.prevent="dragOver = true" @dragleave="dragOver = false" @drop.prevent="onDrop"
      >
        <input type="file" accept=".csv,text/csv" hidden @change="onPick">
        <div class="dz-icon">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5-5 5 5M12 5v12" />
          </svg>
        </div>
        <strong>拖入 CSV 文件，或点击选择</strong>
        <span class="dim">需带表头，最大 50 MB。数据只在你的浏览器里处理。</span>
      </label>

      <div class="dz-samples">
        <span class="dim">没有数据？试试示例：</span>
        <button class="btn btn-sm" @click="loadSample('basic')">
          基础示例
        </button>
        <button class="btn btn-sm" @click="loadSample('llm')">
          LLM 天梯榜
        </button>
      </div>
      <p v-if="loadError" class="dz-error">
        {{ loadError }}
      </p>
    </div>

    <!-- 已导入：预览 + 配置 -->
    <div v-else class="editor-body">
      <section class="preview" :style="{ background: spec.backgroundColor }">
        <ClientOnly>
          <ChartCanvas ref="canvas" :csv-text="csvText" :spec="spec" />
        </ClientOnly>
      </section>

      <aside class="sidebar">
        <!-- 数据 -->
        <div class="panel">
          <div class="panel-title">
            <span>数据</span>
            <button class="btn btn-ghost btn-sm" @click="reset">
              更换
            </button>
          </div>
          <div class="file-row">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
            </svg>
            <span class="file-name">{{ fileName }}</span>
          </div>
          <div class="mini-table">
            <table>
              <thead>
                <tr><th v-for="c in columns" :key="c">{{ c }}</th></tr>
              </thead>
              <tbody>
                <tr v-for="(r, i) in previewRows" :key="i">
                  <td v-for="c in columns" :key="c">{{ r[c] }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 字段映射 -->
        <div class="panel">
          <div class="panel-title">
            字段映射
          </div>
          <div class="field">
            <label class="field-label">分类 (id)</label>
            <select v-model="spec.idField" class="select">
              <option v-for="c in columns" :key="c" :value="c">{{ c }}</option>
            </select>
          </div>
          <div class="field">
            <label class="field-label">数值 (value)</label>
            <select v-model="spec.valueField" class="select">
              <option v-for="c in columns" :key="c" :value="c">{{ c }}</option>
            </select>
          </div>
          <div class="grid-2">
            <div class="field">
              <label class="field-label">时间 (step)</label>
              <select v-model="spec.stepField" class="select">
                <option v-for="c in columns" :key="c" :value="c">{{ c }}</option>
              </select>
            </div>
            <div class="field">
              <label class="field-label">时间格式</label>
              <select v-model="spec.stepMode" class="select">
                <option v-for="o in stepModeOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
            </div>
          </div>
          <div class="field">
            <label class="field-label">配色依据 (color)</label>
            <select v-model="spec.colorField" class="select">
              <option v-for="o in colorOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </div>
          <div class="field">
            <label class="field-label">标签 (label)</label>
            <select v-model="spec.labelField" class="select">
              <option v-for="o in labelOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </div>
        </div>

        <!-- 图表 -->
        <div class="panel">
          <div class="panel-title">
            图表
          </div>
          <SegmentedControl
            v-model="spec.kind"
            :options="[{ label: '条形竞赛', value: 'bar' }, { label: '折线趋势', value: 'line' }]"
          />
          <div class="field">
            <label class="field-label">图内标题</label>
            <input v-model="spec.title" class="input" placeholder="（可留空）">
          </div>
          <RangeField v-model="spec.topN" label="显示名次 Top N" :min="3" :max="30" />
          <div v-if="spec.kind === 'line'" class="field">
            <label class="field-label">时间轴模式</label>
            <select v-model="spec.lineAxis" class="select">
              <option value="dynamic">动态贴合</option>
              <option value="fixed">完整时间轴</option>
              <option value="window">滚动时间窗</option>
            </select>
          </div>
          <label class="switch-row">
            <span class="field-label">显示分类标签</span>
            <input v-model="spec.showLabel" type="checkbox" class="switch">
          </label>
        </div>

        <!-- 节奏 -->
        <div class="panel">
          <div class="panel-title">
            节奏
          </div>
          <RangeField v-model="spec.totalDurationSec" label="总时长" :min="5" :max="120" suffix=" 秒" />
          <RangeField v-model="spec.transitionDurationSec" label="入场/退场过渡" :min="0" :max="10" :step="0.5" suffix=" 秒" />
          <RangeField v-model="spec.swapAccelBoost" label="换位加速度" :min="0" :max="3" :step="0.1" :format="v => v.toFixed(1)" />
          <RangeField v-model="spec.fps" label="帧率 FPS" :min="24" :max="60" :step="6" />
        </div>

        <!-- 数值与外观 -->
        <div class="panel">
          <div class="panel-title">
            数值与外观
          </div>
          <div class="field">
            <label class="field-label">数值刻度</label>
            <select v-model="spec.valueScale" class="select">
              <option v-for="o in scaleOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </div>
          <RangeField v-model="spec.valueDecimals" label="数值小数位" :min="0" :max="3" />
          <div class="field">
            <label class="field-label">背景色</label>
            <div class="color-row">
              <input v-model="spec.backgroundColor" type="color" class="color-swatch">
              <input v-model="spec.backgroundColor" class="input" spellcheck="false">
            </div>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.editor { height: calc(100vh - var(--header-h)); display: flex; flex-direction: column; }

.toolbar {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 20px; border-bottom: 1px solid var(--border); background: var(--surface);
  flex-shrink: 0;
}
.title-input { max-width: 320px; font-weight: 600; }
.toolbar-right { margin-left: auto; display: flex; align-items: center; gap: 12px; }

/* 上传区 */
.dropzone-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; padding: 24px; }
.dropzone {
  display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center;
  width: min(560px, 90vw); padding: 48px 32px;
  background: var(--surface); border: 2px dashed var(--border-strong); border-radius: var(--r-lg);
  cursor: pointer; transition: border-color 0.15s ease, background 0.15s ease;
}
.dropzone:hover { border-color: var(--accent); }
.dropzone.over { border-color: var(--accent); background: var(--accent-soft); }
.dropzone strong { font-size: 15px; }
.dropzone .dim { font-size: 13px; }
.dz-icon {
  width: 60px; height: 60px; border-radius: 50%; margin-bottom: 6px;
  display: flex; align-items: center; justify-content: center;
  color: var(--accent); background: var(--accent-soft);
}
.dz-samples { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: center; }
.dz-error { color: var(--danger); font-size: 13px; }

/* 主体 */
.editor-body { flex: 1; display: flex; min-height: 0; }
.preview { flex: 1; min-width: 0; position: relative; }
.sidebar {
  width: 340px; flex-shrink: 0; overflow-y: auto;
  border-left: 1px solid var(--border); background: var(--bg);
  padding: 16px; display: flex; flex-direction: column; gap: 14px;
}

.panel {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--r);
  padding: 14px; display: flex; flex-direction: column; gap: 12px;
}
.panel-title {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 12px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-3);
}

.file-row {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 11px; background: var(--surface-2); border-radius: var(--r-sm); color: var(--text-2);
}
.file-name { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.mini-table { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--r-sm); }
.mini-table table { border-collapse: collapse; width: 100%; font-size: 11.5px; }
.mini-table th, .mini-table td {
  padding: 5px 8px; text-align: left; white-space: nowrap;
  border-bottom: 1px solid var(--border); color: var(--text-2);
}
.mini-table th { background: var(--surface-2); color: var(--text); font-weight: 600; position: sticky; top: 0; }
.mini-table tr:last-child td { border-bottom: none; }

.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

.switch-row { display: flex; align-items: center; justify-content: space-between; cursor: pointer; }
.switch { position: relative; width: 38px; height: 22px; appearance: none; background: var(--surface-3); border-radius: 999px; cursor: pointer; transition: background 0.18s ease; flex-shrink: 0; }
.switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: var(--shadow-sm); transition: transform 0.18s ease; }
.switch:checked { background: var(--accent); }
.switch:checked::after { transform: translateX(16px); }

.color-row { display: flex; gap: 8px; }
.color-swatch { width: 42px; height: 38px; padding: 3px; border: 1px solid var(--border-strong); border-radius: var(--r-sm); background: var(--surface); cursor: pointer; flex-shrink: 0; }

@media (max-width: 900px) {
  .editor { height: auto; }
  .editor-body { flex-direction: column; }
  .preview { aspect-ratio: 16 / 9; flex: none; }
  .sidebar { width: 100%; border-left: none; border-top: 1px solid var(--border); }
}
</style>
