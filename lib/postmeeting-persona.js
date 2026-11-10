/** Post-meeting persona growth. Only committed offline lines with explicitly mapped
 * user identity are eligible. A numbered diarization label alone is not identity.
 * No mutable live session input is accepted. Errors propagate to the pipeline. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readLogText } from './transcript-log.js'
import { renderSpeakerTranscript } from './persona-source.js'
import { loadProfile, saveProfile, appendPersonaSection } from './persona.js'
import { mergeProfile, renderProfile, emptyProfile } from './persona-growth.js'
import { appendJournal, appendWarm, consolidate, convergence, layersStatus } from './memory-layers.js'
import { routeItem, readRules } from './tripartite.js'
import { renderPersonaDoc, syncPersonaDoc } from './persona-kb.js'

export async function updatePostMeetingPersona({ dir, cfg = {}, personaDir, completer, logger,
  assertActive = () => {}, signal, resolveHostPort = () => 0, sync = syncPersonaDoc,
  fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  if (!cfg.personaAutoUpdate) return { status: 'skip', reason: '已关闭自动画像沉淀' }
  if (!dir || !personaDir) throw new Error('画像沉淀缺少会议目录或画像目录')
  assertActive()
  const lines = readLogText(readFileSync(join(dir, 'transcript-offline.jsonl'), 'utf8')).lines
  // Exact identity only: never infer ownership from a mention of the user's name.
  const names = [cfg.userName, ...(cfg.personaUserNames || [])].map(x => String(x || '').trim()).filter(Boolean)
  const speakers = new Set(names)
  const own = lines.filter(x => x && x.role !== 'assistant' && x.src !== 'gap' &&
    String(x.text || '').trim() && speakers.has(String(x.speaker || '').trim()))
  if (!own.length) return { status: 'skip', reason: '没有可靠映射到用户本人的说话人；编号或他人提及姓名不足以确认身份' }
  if (typeof completer !== 'function') throw new Error('画像沉淀没有可用 DSH 会话模型')
  const existing = loadProfile(personaDir)
  const knownText = existing ? renderProfile(existing, { maxChars: 1500 }) : ''
  const spoken = renderSpeakerTranscript(own, { maxChars: 6000 })
  const out = await completer([
    { role:'system', content: '仅从明确属于用户本人的发言提取画像，不能把会议其他人的观点或会议事实当成用户属性。五个分区：identity（身份）、style（表达风格）、stance（立场偏好）、facts（稳定事实）、state（当前状态）。只输出 JSON {"items":[{"section":"stance","key":"主题","value":"可证实的一句话","confidence":0.8}]}。key用2~8字，value不超过40字，证据不足不写，不编造。相同主题沿用既有key。' },
    ...(knownText ? [{role:'user',content:'已知画像（避免重复）：\n'+knownText}] : []),
    {role:'user',content:'本场会议明确属于用户本人的发言：\n'+spoken.text},
  ])
  assertActive()
  const parsed = JSON.parse(String(out).replace(/^```(?:json)?|```$/gm,'').trim())
  const items = Array.isArray(parsed) ? parsed : parsed.items
  if (!Array.isArray(items)) throw new Error('画像模型结果缺少 items 数组')
  const sections = new Set(['identity','style','stance','facts','state'])
  if (items.some(x=>!x || !sections.has(x.section) || typeof x.key !== 'string' || !x.key.trim() || typeof x.value !== 'string' || !x.value.trim())) throw new Error('画像模型返回无效分区或条目，未写入')
  const merged = mergeProfile(existing || emptyProfile(), items)
  assertActive()
  saveProfile(personaDir, merged.profile)
  const at = now(), memDir = join(personaDir,'memory')
  appendJournal({dir:memDir,at,title:'会议 · '+dir.split(/[\\/]/).pop(),lines:own.map(x=>x.text)})
  for (const it of items) { assertActive(); appendWarm({dir:memDir,text:it.value,kind:it.section==='stance'?'rule':'fact',confidence:it.confidence,at,source:dir}) }
  const cons = consolidate({dir:memDir,now:at})
  const conv = convergence({profile:merged.profile,dir:memDir})
  const layers = layersStatus(memDir)
  const routed = {knowledge:0,memory:0,rule:0}
  for (const item of items) { assertActive(); const r=routeItem({dir:join(personaDir,'ontology'),item,at}); if(r?.kind) routed[r.kind]=(routed[r.kind]||0)+1 }
  const bySection = s=>items.filter(x=>x.section===s).map(x=>x.value)
  const stamp = new Date(at).toISOString().slice(0,16).replace('T',' ')
  const r1=appendPersonaSection(personaDir,'user',[...bySection('identity'),...bySection('facts')],{stamp})
  const r2=appendPersonaSection(personaDir,'state',bySection('state'),{stamp})
  let personaKb='未开启自动同步（knowledge.personaSync=false）'
  if (cfg.knowledge?.personaSync === true) {
    assertActive()
    const port=resolveHostPort()
    if (!port) throw new Error('画像已保存本地，但知识库同步无法取得宿主端口')
    const markdown=renderPersonaDoc({profile:merged.profile,layers,convergence:conv,rules:readRules({dir:join(personaDir,'ontology'),maxTopics:8,maxPerTopic:4}),at})
    const guardedFetch = async (url, options={}) => { assertActive(); const r=await fetchImpl(url,{...options,signal}); assertActive(); return r }
    const kb=await sync({origin:'http://127.0.0.1:'+port,name:cfg.knowledge.personaBaseName || undefined,markdown,profile:merged.profile,convergence:conv,minItems:Number(cfg.knowledge.personaMinItems)||5,minScore:Number(cfg.knowledge.personaMinScore)||0.2,fetchImpl:guardedFetch})
    assertActive()
    if (!kb.ok && !kb.skipped) throw new Error('画像写库失败（'+(kb.stage||'?')+'）：'+kb.error)
    personaKb=kb.skipped ? '暂不写入（'+kb.reason+'）' : '已同步画像知识库：'+(kb.kbName||kb.id||'已确认')
  }
  const detail='画像：新增 '+merged.stats.added+' 条、强化 '+merged.stats.reinforced+' 条、取代 '+merged.stats.superseded+' 条、过期 '+merged.stats.expired+' 条（markdown 追加 '+(r1.added+r2.added)+' 条）'
  logger?.info?.('[soulmirror] '+detail)
  return {status:'done',result:detail,persona:items.length+' 条',memory:'暖态 '+layers.warm+' / 冷储 '+layers.cold+' / 流水 '+layers.journalDays+' 天（本次晋升 '+cons.promoted.length+'、归档 '+cons.archived+'）',convergence:conv.score+'（'+conv.label+'）',ontology:routed,personaKb}
}
