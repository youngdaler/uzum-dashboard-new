import { useSyncExternalStore } from 'react'
import type { Lang } from '@/lib/i18n'
const KEY='uzum-dashboard-language'
let language:Lang=typeof localStorage!=='undefined' && localStorage.getItem(KEY)==='uz'?'uz':'ru'
const listeners=new Set<()=>void>()
export function getLanguage():Lang{return language}
export function setLanguage(next:Lang){
 if(language===next)return
 language=next
 localStorage.setItem(KEY,next)
 document.documentElement.lang=next==='uz'?'uz-Latn':'ru'
 listeners.forEach(fn=>fn())
 window.dispatchEvent(new Event('dashboard-language-refresh'))
}
export function useLanguage():[Lang,(lang:Lang)=>void] {return [useSyncExternalStore(fn=>{listeners.add(fn);return ()=>listeners.delete(fn)},getLanguage),setLanguage]}
