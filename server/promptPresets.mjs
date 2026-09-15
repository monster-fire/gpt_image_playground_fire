import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export const DEFAULT_PROMPT_PRESETS = [
  {
    id: 'female-portrait-curvy',
    name: '女性写真 · 丰腴曲线',
    content: `默认主体为年轻成年东方女性，视觉年龄约 20–26 岁。整体为真实拍摄质感，年轻、美丽、清透、有吸引力；具有明确的东方女性特征，避免欧美混血感过强、年龄偏大或未成年感。画面具有高级写真感、真实摄影感和社交平台传播感，避免普通自拍和廉价影楼效果。

默认表现成熟丰腴、自然协调的曲线型身材：胸部饱满自然，轮廓清晰但克制得体；腰线清晰，腰胯转折明显，臀腿曲线圆润流畅，肩颈线柔和，形成优雅、有吸引力的 S 型身姿。身体比例协调，不夸张变形，不低俗。

构图、服装与姿态重点呈现肩颈线、锁骨线、上半身轮廓、胸部线条、胸腰关系、腰线、腰胯转折、腿部比例和整体身体轮廓。姿态自然放松，有重心变化，避免僵硬站姿；根据风格形成自然或明显的 S 型身姿。

若本次要求性感，以高级、克制、氛围化的女性魅力表现，通过姿态、服装剪裁、面料、光线、身体线条和眼神表达，不依赖低俗暴露。上述内容作为默认设定，具体人物、服装、场景和风格以用户本次明确要求为准。

结合本次需求完善人物气质、五官方向、丰腴曲线型身形细节、女性身体线条重点、姿态动作、服装细节、场景细节、镜头构图、光线氛围和第一眼吸睛点，使这些要素在最终画面中自然协调。`,
  },
]

export function revisionForPromptPresets(data) {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex')
}

async function atomicWriteJson(path, data) {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  await rename(tmp, path)
}

function presetRevision(preset) {
  return createHash('sha256')
    .update(JSON.stringify({ id: preset.id, name: preset.name, content: preset.content, updatedAt: preset.updatedAt }))
    .digest('hex')
}

function normalizePreset(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid prompt preset')
  const preset = {
    id: String(value.id || '').trim(),
    name: String(value.name || '').trim(),
    content: String(value.content || '').trim(),
    createdAt: Number(value.createdAt),
    updatedAt: Number(value.updatedAt),
  }
  if (!preset.id || preset.id.length > 100) throw new Error('invalid prompt preset id')
  if (!preset.name || preset.name.length > 120) throw new Error('invalid prompt preset name')
  if (!preset.content || preset.content.length > 100_000) throw new Error('invalid prompt preset content')
  if (!Number.isFinite(preset.createdAt) || preset.createdAt <= 0) throw new Error('invalid prompt preset createdAt')
  if (!Number.isFinite(preset.updatedAt) || preset.updatedAt <= 0) throw new Error('invalid prompt preset updatedAt')
  return { ...preset, revision: presetRevision(preset) }
}

function normalizeLibrary(value) {
  const presets = Array.isArray(value?.presets) ? value.presets.map(normalizePreset) : null
  if (!presets) throw new Error('invalid prompt preset library')
  const ids = new Set()
  for (const preset of presets) {
    if (ids.has(preset.id)) throw new Error('duplicate prompt preset id')
    ids.add(preset.id)
  }
  return { presets }
}

export function createInitialPromptPresetLibrary(now = Date.now()) {
  return {
    presets: DEFAULT_PROMPT_PRESETS.map((preset) => normalizePreset({
      ...preset,
      createdAt: now,
      updatedAt: now,
    })),
  }
}

export async function readPromptPresets(path) {
  try {
    const library = normalizeLibrary(JSON.parse(await readFile(path, 'utf8')))
    return { presets: library.presets, revision: revisionForPromptPresets(library) }
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err
    const library = createInitialPromptPresetLibrary()
    await atomicWriteJson(path, library)
    return { presets: library.presets, revision: revisionForPromptPresets(library) }
  }
}

export function preparePromptPresetWrite(presets, current, now = Date.now()) {
  if (!Array.isArray(presets) || presets.length > 100) throw new Error('invalid prompt preset list')
  const previous = new Map(current.presets.map((preset) => [preset.id, preset]))
  const normalized = presets.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid prompt preset')
    const id = String(value.id || '').trim()
    const name = String(value.name || '').trim()
    const content = String(value.content || '').trim()
    if (!id || id.length > 100) throw new Error('invalid prompt preset id')
    if (!name || name.length > 120) throw new Error('invalid prompt preset name')
    if (!content || content.length > 100_000) throw new Error('invalid prompt preset content')
    const existing = previous.get(id)
    const changed = !existing || existing.name !== name || existing.content !== content
    return normalizePreset({
      id,
      name,
      content,
      createdAt: existing?.createdAt ?? now,
      updatedAt: changed ? now : existing.updatedAt,
    })
  })
  return normalizeLibrary({ presets: normalized })
}

export async function writePromptPresets(path, library) {
  await atomicWriteJson(path, normalizeLibrary(library))
}
