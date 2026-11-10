import { readFileSync } from 'node:fs'
export const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
export function loadUI() {
  let spec; const effects=[]
  const React={createElement(t,p,...c){return typeof t==='function'?t(p||{}):{t,p:p||{},c}},Fragment:'fragment',createContext(){return {}},useContext(){return {}},useState(v){return [typeof v==='function'?v():v,()=>{}]},useEffect(fn){effects.push(fn)},useLayoutEffect(){},useMemo(f){return f()},useCallback(f){return f},useRef(v){return {current:v}}}
  new Function('window',source)({__ModuleLoader__:{load(v){spec=v}}})
  const exp=spec.factory((id)=>id==='react'?React:{})
  return { ...exp.__test, exp, effects }
}
export function nodes(v,out=[]){if(v==null||v===false)return out;if(Array.isArray(v)){v.forEach(x=>nodes(x,out));return out}if(typeof v==='object'){out.push(v);nodes(v.c,out)}return out}
export function text(v){if(v==null||v===false)return '';if(Array.isArray(v))return v.map(text).join(' ');if(typeof v==='object')return text(v.c);return String(v)}
export function workspace(ui,view){ui.live.set({view,transcript:[{t:'2026-11-10T08:00:00Z',text:'已保存转写'}]});ui.store.set(true);return ui.MeetingPage({})}
