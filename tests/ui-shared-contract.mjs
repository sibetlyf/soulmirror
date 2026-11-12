import assert from 'node:assert/strict'
import { buildViewModel } from '../lib/view-model.js'
import {loadUI,nodes,text,workspace,source} from './ui-harness.mjs'
export function check(kind){
 const ui=loadUI();const view=buildViewModel({journal:{enabled:true,capturing:true,lastSeq:8,currentRun:'x',runs:{x:{run:'x',phase:'recording',startedAt:'2026-11-10T08:00:00Z',steps:{}}}},runtime:{now:Date.parse('2026-11-10T08:01:15Z'),activeApp:'腾讯会议',issues:[{text:'音频静音',fix:'检查采集设备'}],session:{bytes:32000,asr:{online:true,sentMs:1000}},transcript:[{t:'2026-11-10T08:01:00Z'}]},display:{width:390}})
 const tree=workspace(ui,view),txt=text(tree)
 if(kind==='shared'){assert.match(txt,/正在录音/);assert.match(txt,/结束录音并整理/);assert.match(txt,/已保存转写/);assert.match(txt,/音频静音/);assert.match(txt,/检查采集设备/)}
 if(kind==='close'){const side=ui.FloatPanel({});const close=nodes(side).find(n=>n.p['aria-label']==='收起会议工作台');assert.ok(close);close.p.onClick();assert.equal(ui.store.open,false);assert.equal(ui.FloatPanel({}),null)}
 if(kind==='layout'){const side=ui.FloatPanel({});assert.equal(side.p.style.position,'fixed');assert.equal(side.p.style.top,0);assert.equal(side.p.style.bottom,0);assert.equal(side.p.style.right,0);assert.equal(side.p.style.width,390);assert.ok(side.p.style.borderLeft);assert.equal(side.p.style.boxShadow,undefined)}
 if(kind==='tabs'){for(const x of ['实时转写','纪要与产物','运行轨迹','设置与诊断'])assert.match(txt,new RegExp(x));assert.ok(nodes(tree).some(n=>n.t==='button'&&text(n)==='诊断'));assert.match(source,/h\(HealthCheck\)/)}
 if(kind==='progress'){const r={run:'r',phase:'running',step:'offline',percent:79,startedAt:'2026-11-10T08:00:00Z',steps:{offline:{state:'running',detail:'等待云端识别'}}};const v=buildViewModel({journal:{runs:{r}},runtime:{now:Date.parse('2026-11-10T08:01:00Z')}});assert.equal(v.steps[0].progress,null);assert.match(text(ui.PipelineSteps({view:v})),/等待云端识别/);assert.equal(nodes(ui.PipelineSteps({view:v})).filter(n=>n.t==='progress').length,0)}
 if(kind==='auto'){assert.equal(ui.shouldAutoOpen(view),true);assert.equal(ui.shouldAutoOpen({...view,display:{...view.display,autoOpen:false}}),false);ui.store.set(false);ui.live.set({view:{...view,run:{dir:'next'}}});ui.FloatPanel({});ui.effects[ui.effects.length-1]();assert.equal(ui.store.open,true)}
 if(kind==='elapsed'){assert.equal(view.elapsedSec,75);assert.match(txt,/录音 1 分 15 秒/);assert.match(txt,/已识别 1 秒/);assert.match(txt,/最近一句/)}
 if(kind==='old'){assert.match(ui.getView({capturing:true}).headline,/重启/);assert.equal(ui.getView({capturing:true}).capturing,undefined)}
 if(kind==='entry'){const v=view;ui.live.set({view:v});assert.match(text(ui.StatusStrip({})),new RegExp(v.headline));assert.match(text(ui.LiveDock({})),new RegExp(v.headline));assert.match(source,/store\.set\(!s\.open\)/);assert.match(source,/inject\('sidebar\.footer\.action'/)}
 if(kind==='app'){const a=ui.pickActiveApp({activeApp:'移动会议',meeting:{app:'腾讯会议'}});assert.equal(a.name,'移动会议');assert.equal(a.source,'手动');assert.match(txt,/会议接入/);assert.match(txt,/软件：腾讯会议/);assert.match(source,/lv\.view && lv\.view\.app \|\| pickActiveApp\(lv\)/);assert.match(source,/React\.createElement\(MeetingWorkspace, \{ full: false \}\)/)}
 if(kind==='issues'){const ns=nodes(tree);assert.ok(ns.some(n=>n.p.role==='alert'&&text(n).includes('音频静音')));assert.ok(txt.indexOf('音频静音')<txt.indexOf('已保存转写'));assert.match(txt,/检查采集设备/)}
}
