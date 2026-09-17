/* Keviata live build: Descope Google auth + Supabase persistence */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'

const DESCOPE_PID='P3JSQ5xGjXf4sEVQz7q0lTaAgN54'
const SB_URL='https://kuehljnnpwgzyodjaund.supabase.co'
const SB_KEY='sb_publishable_WTptxyj36qwJLQRibOW3-w_sw4kFowj'
const EXCHANGE_URL=SB_URL+'/functions/v1/descope-exchange'
const VAPID_PUBLIC='BFERPntN4swt6boOnhiOy1nQ02qKTWB2R2aCQKeWNiZBtRNKtu3JHBjNRzmek4lAYZYWgGZiO75BOAmIJ2NOPoc'
const dSdk=Descope({projectId:DESCOPE_PID})
let uid=null

let sbToken='',sbTokenExpMs=0
async function getSBToken(){
  if(sbToken&&Date.now()<sbTokenExpMs-120000)return sbToken
  const r0=await dSdk.refresh()
  const sessionJwt=r0&&r0.data&&r0.data.sessionJwt
  if(!sessionJwt)throw Error('no_session')
  const r=await fetch(EXCHANGE_URL,{method:'POST',headers:{authorization:'Bearer '+sessionJwt}})
  if(!r.ok)throw Error('exchange_'+r.status)
  const j=await r.json()
  sbToken=j.token;sbTokenExpMs=j.exp*1000
  return sbToken
}
const sb=createClient(SB_URL,SB_KEY,{accessToken:getSBToken})

const getUser=async()=>{
  try{
    const r=await dSdk.refresh()
    if(!r||!r.data||!r.data.sessionJwt)return null
    const me=await dSdk.me()
    const u=(me&&me.data)||{}
    uid=u.userId||null
    return uid?{id:uid,name:u.name||(u.email||'').split('@')[0]||'לומד/ת',email:u.email||'',pictureUrl:u.picture||''}:null
  }catch{return null}
}
const logout=async()=>{
  try{await dSdk.logout()}catch{}
  try{localStorage.removeItem('keviata-demo-progress');localStorage.removeItem('keviata-demo-extras')}catch{}
  location.replace('login/')
}
async function cloudLoad(){
  if(!uid)return
  try{
    await sb.from('profiles').upsert({id:uid,display_name:profile.name,email:profile.email,picture_url:profile.pictureUrl,updated_at:new Date().toISOString()})
    const st=await sb.from('user_settings').select('settings').eq('user_id',uid).maybeSingle()
    const pr=await sb.from('user_progress').select('item_key,completed,data')
    const s=st.data&&st.data.settings
    if(s){if(s.bookmarks)extras.bookmarks=s.bookmarks;if(s.settings)extras.settings={...extras.settings,...s.settings};if(s.onboarded)extras.onboarded=true}
    if(pr.data&&pr.data.length){progress.days={}
      for(const row of pr.data){const d=row.data||{};progress.days[row.item_key]={dayId:row.item_key,slide:Number(d.slide)||0,totalSlides:Number(d.totalSlides)||20,scroll:Number(d.scroll)||0,completed:!!row.completed,updatedAt:d.updatedAt||''}}
      progress.streak=Object.values(progress.days).filter(d=>d&&d.completed).length
      try{localStorage.setItem('keviata-demo-progress',JSON.stringify({progress,profile}))}catch{}}
  }catch(e){console.warn('cloud load failed',e)}
}
let cloudTimer
function cloudSaveSettings(){clearTimeout(cloudTimer);cloudTimer=setTimeout(async()=>{if(!uid)return
  try{await sb.from('user_settings').upsert({user_id:uid,settings:{bookmarks:extras.bookmarks,settings:extras.settings,onboarded:extras.onboarded},updated_at:new Date().toISOString()})}catch(e){console.warn('settings save failed',e)}},800)}
async function cloudSaveProgress(dayId){
  if(!uid)return
  const d=progress.days[dayId];if(!d)return
  try{await sb.from('user_progress').upsert({user_id:uid,item_key:dayId,completed:!!d.completed,completed_at:d.completed?new Date().toISOString():null,data:{slide:d.slide,totalSlides:d.totalSlides,scroll:d.scroll,updatedAt:d.updatedAt}})}catch(e){console.warn('progress save failed',e)}
}
function b64ToUint8(b64){const p='='.repeat((4-b64.length%4)%4);const raw=atob((b64+p).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(raw,c=>c.charCodeAt(0))}
async function pushEnable(){
  if(!uid||!('serviceWorker' in navigator)||!('PushManager' in window))return false
  const perm=await Notification.requestPermission()
  if(perm!=='granted')return false
  const reg=await navigator.serviceWorker.ready
  const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64ToUint8(VAPID_PUBLIC)})
  const j=sub.toJSON()
  try{await sb.from('push_subscriptions').upsert({user_id:uid,endpoint:j.endpoint,keys:j.keys,opted_in:true,timezone:'Asia/Jerusalem',updated_at:new Date().toISOString()})}catch(e){console.warn('push save failed',e)}
  return true
}
async function pushDisable(){
  try{const reg=await navigator.serviceWorker.ready;const sub=await reg.pushManager.getSubscription()
    if(sub){await sub.unsubscribe();if(uid)await sb.from('push_subscriptions').delete().eq('endpoint',sub.endpoint)}}catch{}
}

const $=id=>document.getElementById(id)
const track=$('track'),stage=$('stage'),counter=$('counter'),fill=$('fill'),prevBtn=$('prevBtn'),nextBtn=$('nextBtn')
const reader=$('reader'),saveError=$('saveError'),toast=$('toast')

let edition=null,archive=[],slides=[],N=0,idx=0
let progress={version:1,days:{},streak:0,lastStudyDate:null}
let extras={version:1,bookmarks:[],settings:{reminder:false,studyTime:'20:00',sounds:true,dark:false,textSize:'בינוני'},onboarded:false}
let profile={name:'אורח',pictureUrl:'',email:''}
let saveTimer,deferredInstall,restoring=false,currentTab='home'
const requestedDay=new URLSearchParams(location.search).get('date')

/* ---------- icons ---------- */
const IC={
bookmark:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-6-4.5L6 21Z"/></svg>',
flame:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c2 3 5 5 5 9a5 5 0 0 1-10 0c0-2 1-3.5 2-5 .5 1.5 1.5 2 2.5 2C11 7.5 11 5 12 3Z"/></svg>',
pie:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3v9l6.5-6.5"/></svg>',
book:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6c-2-1.5-5-2-8-2v14c3 0 6 .5 8 2 2-1.5 5-2 8-2V4c-3 0-6 .5-8 2Z"/><path d="M12 6v14"/></svg>',
'book-sm':'<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6c-2-1.5-5-2-8-2v14c3 0 6 .5 8 2 2-1.5 5-2 8-2V4c-3 0-6 .5-8 2Z"/><path d="M12 6v14"/></svg>',
chart:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/></svg>',
share:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="m8.2 10.8 7.6-3.6M8.2 13.2l7.6 3.6"/></svg>',
lamp:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5c.8.7 1 1.5 1 2.5h6c0-1 .2-1.8 1-2.5A6 6 0 0 0 12 3Z"/></svg>',
bell:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 9a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9Z"/><path d="M10 20a2.2 2.2 0 0 0 4 0"/></svg>',
clock:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>',
music:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V6l10-2v12"/><circle cx="7" cy="18" r="2.5"/><circle cx="17" cy="16" r="2.5"/></svg>',
mail:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
moon:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13.5A8 8 0 1 1 10.5 4 6.5 6.5 0 0 0 20 13.5Z"/></svg>',
text:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7V5h14v2M12 5v14M9 19h6"/></svg>',
globe:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9Z"/></svg>',
person:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 5-5.5 8-5.5s6.5 1.5 8 5.5"/></svg>',
cloud:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18a4.5 4.5 0 1 1 .7-8.95A6 6 0 0 1 19 11a3.5 3.5 0 0 1-1 6.9Z"/></svg>',
privacy:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6Z"/><path d="m9.5 12 2 2 3.5-4"/></svg>',
install:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 17v3h14v-3"/></svg>',
target:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></svg>',
check:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
leaf:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19C5 9 11 4 20 4c0 9-5 15-15 15Z"/><path d="M5 19c3-6 7-9 11-11"/></svg>',
star:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 2.7 5.7 6.3.8-4.6 4.3 1.2 6.2-5.6-3-5.6 3 1.2-6.2L3 9.5l6.3-.8Z"/></svg>'}
document.querySelectorAll('[data-ic]').forEach(el=>{el.innerHTML=IC[el.dataset.ic]||''})

/* ---------- helpers ---------- */
const esc=v=>String(v||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const initials=n=>(n||'ל').trim().split(/\s+/).map(w=>w[0]).slice(0,2).join('״')+'׳'
function showToast(msg){toast.textContent=msg;toast.classList.add('show');clearTimeout(showToast.t);showToast.t=setTimeout(()=>toast.classList.remove('show'),2400)}

/* ---------- tabs ---------- */
const TAB_NAMES={home:'בית',learn:'לימוד',history:'היסטוריה',profile:'פרופיל',settings:'הגדרות'}
function showTab(name){currentTab=name
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('on',b.dataset.tab===name))
  for(const k of Object.keys(TAB_NAMES))$('scr-'+k).hidden=k!==name
  if(name==='history')renderHistory()
}
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>showTab(b.dataset.tab))
$('avatarBtn').onclick=()=>showTab('profile')
$('goProfile').onclick=()=>showTab('profile')

/* ---------- data ---------- */
async function getContent(){const day=requestedDay||'2026-09-17';const r=await fetch('content/'+encodeURIComponent(day)+'.json');if(!r.ok)throw Error('content');return r.json()}
async function getArchive(){archive=edition?[edition]:[]}
async function getExtras(){try{const d=JSON.parse(localStorage.getItem('keviata-demo-extras')||'null');if(d&&d.extras)extras={...extras,...d.extras,settings:{...extras.settings,...(d.extras.settings||{})}}}catch{}}
async function putExtras(){try{localStorage.setItem('keviata-demo-extras',JSON.stringify({extras}))}catch{}cloudSaveSettings()}

/* ---------- derived stats ---------- */
const dayEntries=()=>Object.entries(progress.days||{}).sort((a,b)=>String(b[1].updatedAt).localeCompare(String(a[1].updatedAt)))
const pctOf=d=>Math.round(((Number(d.slide)+1)/Number(d.totalSlides||1))*100)
function todayPct(){const d=progress.days?.[edition?.id];return d?pctOf(d):0}
function avgPct(){const es=dayEntries();if(!es.length)return 0;return Math.round(es.reduce((s,[,d])=>s+pctOf(d),0)/es.length)}
const isBookmarked=id=>(extras.bookmarks||[]).some(b=>b.id===id)

/* ---------- home ---------- */
function renderHome(){
  $('homeGreet').textContent='שלום '+(profile.name||'לך')
  const d=progress.days?.[edition?.id]
  $('homeMsg').textContent=d?.completed?'היום השלמת את הלימוד. כל הכבוד — עוד צעד קטן בדרך של לימוד קבוע.':d?'היום כבר למדת קצת. עוד צעד קטן בדרך של לימוד קבוע.':'היום מחכה לך שיעור חדש. עוד צעד קטן בדרך של לימוד קבוע.'
  $('homeSaved').textContent=(extras.bookmarks||[]).length
  $('homeStreak').textContent=progress.streak||0
  $('homeToday').textContent=todayPct()+'%'
  const list=$('archiveHome')
  const rows=archive.slice(0,3)
  list.innerHTML=rows.length?rows.map(e=>edRowHtml(e)).join(''):'<p class="loading-line">עדיין אין מהדורות בארכיון.</p>'
  bindEdRows(list)
}
function edRowHtml(e,status){
  const d=progress.days?.[e.id],p=d?pctOf(d):0
  const sub=e.tag?`<span class="tagchip">${esc(e.tag)}</span>`:esc(e.hebrewDate||'')
  return `<a class="ed-row" href="./?date=${encodeURIComponent(e.id)}" data-day="${esc(e.id)}">
    <span class="book-ic">${IC.book}</span>
    <span class="ed-main"><span class="ed-title">${esc(e.title)}</span><br><span class="ed-sub">${sub}</span></span>
    <span class="ed-date"><b>${esc(e.hebrewDate||'')}</b><br>${esc(e.displayDate||e.id)}</span>
    <span class="chev">‹</span></a>`
}
function bindEdRows(root){root.querySelectorAll('.ed-row').forEach(a=>a.onclick=ev=>{ev.preventDefault();const id=a.dataset.day;if(edition&&id===edition.id){openReader()}else location.assign('./?date='+encodeURIComponent(id))})}
$('archiveAll').onclick=e=>{e.preventDefault();showTab('history')}
$('openToday').onclick=()=>openReader()

/* ---------- learn ---------- */
function renderLearn(){
  $('learnTitle').textContent=edition?.title||'המהדורה לא נטענה'
  $('learnDesc').textContent=edition?.description||''
  $('learnInsight').textContent=edition?.insight||'נוחות התשובה אינה הוכחה לאמיתותה — אלא הזמנה לבדיקה מעמיקה יותר.'
  syncSaveBtn();updatePager()
}
function syncSaveBtn(){const on=edition&&isBookmarked(edition.id);$('saveBtn').classList.toggle('on',!!on);$('saveBtn').lastChild.textContent=on?'נשמר':'שמור'}
function toggleBookmark(){if(!edition)return
  if(isBookmarked(edition.id)){extras.bookmarks=extras.bookmarks.filter(b=>b.id!==edition.id);showToast('הפריט הוסר מהשמורים')}
  else{extras.bookmarks=[{id:edition.id,title:edition.title,hebrewDate:edition.hebrewDate,displayDate:edition.displayDate,tag:edition.tag||''},...(extras.bookmarks||[])].slice(0,100);showToast('נשמר לפריטים שלך')}
  syncSaveBtn();renderProfile();renderHome();putExtras()}
$('saveBtn').onclick=toggleBookmark
$('readerSave').onclick=toggleBookmark
$('shareBtn').onclick=async()=>{if(!edition)return;const data={title:'קביעותא · '+edition.title,text:edition.description||edition.title,url:new URL('./?date='+edition.id,location.href).href}
  try{if(navigator.share){await navigator.share(data)}else{await navigator.clipboard.writeText(data.url);showToast('הקישור הועתק')}}catch{}}
$('continueBtn').onclick=()=>openReader()
function updatePager(){const pos=(progress.days?.[edition?.id]?.slide??0)+1;$('pgLabel').textContent=pos+' / '+(N||20)
  const dots=$('pgDots');dots.innerHTML='';for(let i=0;i<Math.min(N||20,10);i++){const s=document.createElement('span');s.className='dot'+(i===Math.min(pos-1,9)?' cur':'');dots.append(s)}}
$('pgNext').onclick=()=>openReader();$('pgPrev').onclick=()=>openReader()

/* ---------- history ---------- */
let histFilter='all'
document.querySelectorAll('#histFilters .fchip').forEach(b=>b.onclick=()=>{histFilter=b.dataset.f;document.querySelectorAll('#histFilters .fchip').forEach(x=>x.classList.toggle('on',x===b));renderHistoryList()})
function weekDays(){const now=edition?new Date(edition.id+'T12:00:00'):new Date();const day=now.getDay();const out=[];for(let i=0;i<7;i++){const d=new Date(now);d.setDate(now.getDate()-day+i);out.push(d)}return out}
function renderHistory(){
  const wd=weekDays(),letters=['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳']
  let learned=0
  $('weekBars').innerHTML=wd.map((d,i)=>{const key=d.toISOString().slice(0,10),e=progress.days?.[key],done=!!e;if(done)learned++
    const h=done?44+((i*13)%30):14
    const today=key===(edition?.id||new Date().toISOString().slice(0,10))
    return `<div class="bar-col"><div class="bar${done?' full':''}${today?' today':''}" style="height:${h}px"></div><span class="bar-l">${letters[i]}</span></div>`}).join('')
  $('weekSub').textContent=`${learned} מתוך 7 ימים השבוע`
  renderHistoryList()
}
function renderHistoryList(){
  const weekKeys=new Set(weekDays().map(d=>d.toISOString().slice(0,10)))
  let rows=archive.map(e=>({e,d:progress.days?.[e.id],saved:isBookmarked(e.id)}))
  if(histFilter==='done')rows=rows.filter(r=>r.d?.completed)
  if(histFilter==='saved')rows=rows.filter(r=>r.saved)
  if(histFilter==='week')rows=rows.filter(r=>weekKeys.has(r.e.id))
  const list=$('histList')
  if(!rows.length){list.innerHTML='<p class="loading-line">אין פריטים להצגה במסנן הזה.</p>';return}
  list.innerHTML=rows.map(({e,d,saved})=>{
    let pill=''
    if(d?.completed)pill=`<span class="status-pill done"><span class="sp-ic">${IC.check}</span>הושלם</span>`
    else if(d)pill=`<span class="status-pill part"><span class="sp-ic">${IC.pie}</span>${pctOf(d)}%<br>הושלם</span>`
    else if(saved)pill=`<span class="status-pill saved"><span class="sp-ic">${IC.bookmark}</span>נשמר</span>`
    else pill=`<span class="status-pill"><span class="sp-ic" style="background:var(--paper)">${IC.book}</span>טרם</span>`
    return `<a class="ed-row" href="./?date=${encodeURIComponent(e.id)}" data-day="${esc(e.id)}">
      <span class="ed-main"><span class="ed-title">${esc(e.title)}</span><br><span class="ed-sub">${e.tag?`<span class="tagchip">${esc(e.tag)}</span> `:''}${esc(e.hebrewDate||'')}</span></span>
      <span class="ed-date"><b>${esc((e.hebrewDate||'').split(' ')[0]||'')}</b><br>${esc(e.displayDate||'')}</span>
      ${pill}</a>`}).join('')
  bindEdRows(list)
}

/* ---------- profile ---------- */
function renderProfile(){
  $('profileName').textContent=profile.name||'לומד/ת'
  $('profileSince').textContent=`לומד בקביעותא כבר ${dayEntries().length} ימים`
  const av=$('profileAvatar');av.innerHTML=profile.pictureUrl?`<img src="${esc(profile.pictureUrl)}" alt="">`:esc(initials(profile.name))
  const hd=$('avatarCircle');hd.innerHTML=profile.pictureUrl?`<img src="${esc(profile.pictureUrl)}" alt="">`:esc(initials(profile.name))
  $('pSaved').textContent=(extras.bookmarks||[]).length
  $('pStreak').textContent=progress.streak||0
  $('pAvg').textContent=avgPct()+'%'
  $('streakNum').textContent=progress.streak||0
  const days=dayEntries().length,bm=(extras.bookmarks||[]).length,streak=progress.streak||0
  const ach=[
    {ic:'leaf',t:'התחלה טובה',s:'7 ימי לימוד',got:days>=7},
    {ic:'flame',t:'עשרים ברצף',s:'20 ימי לימוד',got:streak>=20,gold:true},
    {ic:'book',t:'אוהב ללמוד',s:'10 פריטים שמורים',got:bm>=10},
    {ic:'star',t:'בדרך רחבה',s:'50 ימי לימוד',got:days>=50,prog:Math.min(days,50),of:50}]
  $('achGrid').innerHTML=ach.map(a=>`<div class="ach${a.got?(a.gold?' gold':''):' locked'}"><span class="a-ic">${IC[a.ic]}</span><b>${a.t}</b><span>${a.s}</span>${a.got?'<div class="check">✓</div>':a.prog?`<div class="mini-bar"><i style="width:${Math.round(a.prog/a.of*100)}%"></i></div><span>${a.prog} / ${a.of}</span>`:''}</div>`).join('')
  const month=new Set(dayEntries().filter(([k])=>k.slice(0,7)===(edition?.id||'').slice(0,7)).map(([k])=>k)).size
  const g1=Math.min(month,30),g2=Math.min(bm,30)
  $('goal1Frac').textContent=`ימים ${g1} / 30 בחודש`;$('goal1Bar').style.width=(g1/30*100)+'%';$('goal1Pct').textContent=Math.round(g1/30*100)+'%'
  $('goal2Frac').textContent=`פריטים ${g2} / 30`;$('goal2Bar').style.width=(g2/30*100)+'%';$('goal2Pct').textContent=Math.round(g2/30*100)+'%'
}
$('achAll').onclick=e=>e.preventDefault();$('goalsAll').onclick=e=>e.preventDefault();$('prefEdit').onclick=e=>{e.preventDefault();showToast('עריכת ההעדפות תיפתח בקרוב')}

/* ---------- settings ---------- */
function applySettings(){const s=extras.settings
  $('setReminder').checked=!!s.reminder;$('setSounds').checked=!!s.sounds;$('setDark').checked=!!s.dark
  $('studyTimeVal').textContent=s.studyTime||'20:00';$('textSizeVal').textContent=s.textSize||'בינוני'
  document.body.classList.toggle('dark',!!s.dark)
  document.body.style.zoom=s.textSize==='קטן'?'0.94':s.textSize==='גדול'?'1.08':'1'
}
let darkStyle=null
function ensureDark(){if(darkStyle)return;darkStyle=document.createElement('style');darkStyle.textContent=`
body.dark{--paper:#17211c;--card:#202b24;--ink:#e9e4d6;--muted:#9aa89e;--line:#33463a;--green-soft:#24382d;--green-softer:#223329;--gold-soft:#3a2f18;--green:#3f9e6b;--green-deep:#e9e4d6}
body.dark .hero,body.dark .card,body.dark .set-card,body.dark .stat-card,body.dark .ed-row,body.dark .ach{background:var(--card)}
body.dark .hero h1,body.dark .stat-card b,body.dark .ed-title{color:#e9e4d6}
body.dark .completion-summary .stat b{color:#3f9e6b}
body.dark blockquote{background:#2a3324}
body.dark .action{background:#2c2a1c}
body.dark nav.tabs,body.dark .reader,body.dark .reader-top,body.dark .reader-nav{background:#17211c}
body.dark .ed-date{background:#17211c;color:#e9e4d6}
body.dark .bar{background:#33463a}
body.dark .mini-bar,body.dark .g-bar{background:#33463a}`;document.head.append(darkStyle)}
$('setReminder').onchange=async e=>{
  if(e.target.checked){const ok=await pushEnable();if(!ok){e.target.checked=false;extras.settings.reminder=false;putExtras();showToast('לא התקבלה הרשאה להתראות במכשיר');return}
    extras.settings.reminder=true;putExtras();showToast('התזכורת היומית הופעלה')}
  else{await pushDisable();extras.settings.reminder=false;putExtras();showToast('התזכורת כבויה')}}
$('setSounds').onchange=e=>{extras.settings.sounds=e.target.checked;putExtras()}
$('setDark').onchange=e=>{extras.settings.dark=e.target.checked;ensureDark();applySettings();putExtras()}
document.querySelector('#scr-settings .set-row:nth-child(2)').onclick=()=>{const opts=['07:00','12:00','18:00','20:00','21:30'];const cur=extras.settings.studyTime||'20:00';const next=opts[(opts.indexOf(cur)+1)%opts.length];extras.settings.studyTime=next;applySettings();putExtras();showToast('שעת הלימוד: '+next)}
document.querySelectorAll('#scr-settings .set-group')[2].querySelector('.set-row:nth-child(2)').onclick=()=>{const opts=['קטן','בינוני','גדול'];const cur=extras.settings.textSize||'בינוני';const next=opts[(opts.indexOf(cur)+1)%opts.length];extras.settings.textSize=next;applySettings();putExtras();showToast('גודל טקסט: '+next)}
document.querySelectorAll('#scr-settings .set-group')[3].querySelector('.set-row:nth-child(1)').onclick=()=>showTab('profile')
document.querySelectorAll('#scr-settings .set-group')[3].querySelector('.set-row:nth-child(2)').onclick=()=>showToast('ההתקדמות והשמורים מסונכרנים אוטומטית לחשבון שלך')
document.querySelectorAll('#scr-settings .set-group')[3].querySelector('.set-row:last-child').onclick=()=>openPrivacy()
$('installRow').onclick=async()=>{if(deferredInstall){deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$('installRow').hidden=true}}

/* privacy / delete dialog */
function openPrivacy(){const dlg=document.createElement('div');dlg.className='dlg';dlg.innerHTML=`<div class="dlg-card"><h2>פרטיות וחשבון</h2>
  <p>הכניסה משמשת לזיהוי בלבד. ההתקדמות, השמורים והעדפות הדיוור נשמרים בחשבון שלך ואפשר למחוק אותם בכל רגע.</p>
  <div class="dlg-actions"><a class="btn soft" href="privacy.html" style="flex:1">מדיניות הפרטיות</a><button class="btn soft" id="dlgClose" style="flex:1">סגירה</button></div>
  <div class="dlg-actions"><button class="btn" id="dlgDelete" style="background:var(--danger);color:#fff;flex:1">מחיקת החשבון לצמיתות</button></div>
  <p class="finish-status" id="dlgStatus"></p></div>`
  document.body.append(dlg)
  dlg.querySelector('#dlgClose').onclick=()=>dlg.remove()
  dlg.onclick=e=>{if(e.target===dlg)dlg.remove()}
  dlg.querySelector('#dlgDelete').onclick=async()=>{if(!confirm('למחוק את החשבון ואת כל ההתקדמות לצמיתות? אין אפשרות שחזור.'))return
    const st=dlg.querySelector('#dlgStatus');st.textContent='מוחקים את החשבון…'
    try{
      if(uid){for(const t of ['push_subscriptions','email_subscriptions','user_history','user_progress','user_settings'])await sb.from(t).delete().eq('user_id',uid)
        await sb.from('profiles').delete().eq('id',uid)}
      try{localStorage.removeItem('keviata-demo-progress');localStorage.removeItem('keviata-demo-extras')}catch{}
      await logout();location.replace('./')}catch(e){console.warn('delete failed',e);st.textContent='המחיקה לא הושלמה. נסו שוב.'}}}

/* ---------- email opt-in ---------- */
async function loadEmailPref(){
  if(!uid){$('emailStatus').textContent='לא מנוי';return}
  try{const r=await sb.from('email_subscriptions').select('subscribed').eq('user_id',uid).maybeSingle()
    const on=!!(r.data&&r.data.subscribed)
    $('emailOptin').checked=on
    $('emailStatus').textContent=on?'מנוי':'לא מנוי'}catch{$('emailStatus').textContent='לא מנוי'}
}
$('emailOptin').onchange=()=>{$('emailSave').disabled=false}
$('emailSave').onclick=async()=>{
  if(!uid)return
  const on=$('emailOptin').checked
  $('emailSave').disabled=true
  try{await sb.from('email_subscriptions').upsert({user_id:uid,email:profile.email,subscribed:on,timezone:'Asia/Jerusalem',updated_at:new Date().toISOString()})
    $('emailStatus').textContent=on?'מנוי':'לא מנוי'
    showToast(on?'הדיוור הופעל':'הדיוור בוטל')}catch{showToast('השמירה נכשלה. נסו שוב.')}
  $('emailSave').disabled=true
}

/* ---------- reader (swipe flow, preserved) ---------- */
function safeSlides(record){if(!record||!/^\d{4}-\d{2}-\d{2}$/.test(record.id)||!Array.isArray(record.slides)||record.slides.length!==20)throw Error('invalid_content');return record.slides}
function mount(record){edition=record;document.title='קביעותא | '+record.title;document.querySelector('meta[name="description"]').content=record.description||'קביעותא — לימוד יומי';$('dateChip').textContent=[record.hebrewDate,record.displayDate].filter(Boolean).join(' · ')
  track.replaceChildren(...safeSlides(record).map(item=>{const section=document.createElement('section');section.className='slide';const inner=document.createElement('div');inner.className=item.className||'slide-inner';inner.innerHTML=item.html;section.append(inner);return section}))
  slides=Array.from(track.children);N=slides.length;const fc=document.getElementById('finishCards');if(fc)fc.textContent=N}
function render(){if(!N)return;slides.forEach((s,i)=>s.hidden=i!==idx);counter.textContent=(idx+1)+' / '+N;fill.style.width=(((idx+1)/N)*100)+'%'
  prevBtn.disabled=idx===0;nextBtn.disabled=idx===N-1
  const pr=document.querySelector('.reader .progress');pr.setAttribute('aria-valuemax',String(N));pr.setAttribute('aria-valuenow',String(idx+1))
  const fs=document.getElementById('finishStreak');if(fs)fs.textContent=progress.streak||1
  if(!restoring)queueSave()}
function go(d){idx=Math.max(0,Math.min(N-1,idx+d));render()}
nextBtn.onclick=()=>go(1);prevBtn.onclick=()=>go(-1)
document.addEventListener('keydown',e=>{if(reader.hidden)return;if(e.key==='ArrowLeft')go(1);else if(e.key==='ArrowRight')go(-1)})
let x0=0,y0=0,dx=0,mode=null,dragTarget=null
function setDrag(off){const W=stage.clientWidth,cur=slides[idx];cur.style.transition='none';cur.style.transform='translateX('+off+'px)';const dir=off>0?1:-1,t=slides[idx+dir]
  if(dragTarget&&dragTarget!==t){dragTarget.style.transition='';dragTarget.style.transform='';dragTarget.hidden=true;dragTarget=null}
  if(t){dragTarget=t;t.hidden=false;t.style.transition='none';t.style.transform='translateX('+(off-dir*W)+'px)'}}
function endDrag(commit){const W=stage.clientWidth,dir=dx>0?1:-1,cur=slides[idx],t=dragTarget;cur.style.transition='transform .22s ease';if(t)t.style.transition='transform .22s ease'
  if(commit&&t){cur.style.transform='translateX('+(dir*W)+'px)';t.style.transform='translateX(0)';setTimeout(()=>{cur.style.transition='';cur.style.transform='';t.style.transition='';t.style.transform='';dragTarget=null;go(dir)},230)}
  else{cur.style.transform='translateX(0)';if(t)t.style.transform='translateX('+(-dir*W)+'px)';setTimeout(()=>{cur.style.transition='';cur.style.transform='';if(t){t.style.transition='';t.style.transform='';t.hidden=true}dragTarget=null},230)}}
stage.addEventListener('touchstart',e=>{const t=e.touches[0];x0=t.clientX;y0=t.clientY;dx=0;mode=null},{passive:true})
stage.addEventListener('touchmove',e=>{const t=e.touches[0],ddx=t.clientX-x0,ddy=t.clientY-y0;if(!mode)mode=Math.abs(ddx)>Math.abs(ddy)&&Math.abs(ddx)>8?'h':'v';if(mode==='h'){e.preventDefault();dx=ddx;const atEdge=(dx>0&&idx===N-1)||(dx<0&&idx===0);setDrag(atEdge?dx*.35:dx)}},{passive:false})
stage.addEventListener('touchend',()=>{if(mode==='h'){const W=stage.clientWidth,dir=dx>0?1:-1,commit=Math.abs(dx)>Math.max(56,W*.22)&&((dir===1&&idx<N-1)||(dir===-1&&idx>0));endDrag(commit)}mode=null;dx=0})
function openReader(){if(!edition)return;reader.hidden=false;document.body.style.overflow='hidden';render()}
function closeReader(){reader.hidden=true;document.body.style.overflow='';showTab(currentTab);renderHome();renderLearn();renderProfile()}
async function save(){if(!edition)return false;const el=slides[idx],scroll=el&&el.scrollHeight>el.clientHeight?el.scrollTop/(el.scrollHeight-el.clientHeight):0
  progress.days=progress.days||{};const prev=progress.days[edition.id]||{}
  progress.days[edition.id]={...prev,dayId:edition.id,slide:Math.max(Number(prev.slide)||0,idx),totalSlides:N,scroll,completed:prev.completed||idx>=N-1,updatedAt:new Date().toISOString()}
  progress.streak=Object.values(progress.days).filter(d=>d&&d.completed).length
  try{localStorage.setItem('keviata-demo-progress',JSON.stringify({progress,profile}))}catch{}
  cloudSaveProgress(edition.id)
  return true}
function queueSave(){if(restoring||!edition)return;clearTimeout(saveTimer);saveTimer=setTimeout(()=>save(),650)}
stage.addEventListener('scroll',queueSave,true)
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')save()})
async function saveThenHome(){const b=$('readerHome');b.disabled=true;saveError.hidden=true;const ok=await save();b.disabled=false
  if(ok){closeReader();return}saveError.hidden=false}
$('readerHome').onclick=saveThenHome;$('retryHome').onclick=saveThenHome
document.addEventListener('click',async e=>{if(e.target?.id==='finishBtn'){const finishBtn=e.target,finishStatus=$('finishStatus');finishBtn.disabled=true;finishStatus.textContent='שומרים את ההשלמה…'
  const ok=await save();if(!ok){finishBtn.disabled=false;finishStatus.textContent=navigator.onLine?'לא הצלחנו לשמור. נסה שוב.':'אין חיבור. נחזור לשמור כשהרשת תחזור.';return}
  finishStatus.textContent='נשמר.';closeReader()}})

/* ---------- first-run onboarding: explicit opt-ins ---------- */
function openOnboarding(){
  if(extras.onboarded)return
  const dlg=document.createElement('div');dlg.className='dlg';dlg.innerHTML=`<div class="dlg-card"><h2>מה תרצו לקבל?</h2>
  <p>אפשר להשתמש בקביעותא גם בלי שום התראה. כל אישור כאן נפרד, ואפשר לבטל אותו בכל רגע בהגדרות.</p>
  <div class="consent-row" style="text-align:right"><input type="checkbox" id="obEmail"><label for="obEmail">אני מאשר/ת לקבל במייל (${esc(profile.email||'')}) את הדף היומי, פעם ביום בלבד. אפשר לבטל בכל רגע.</label></div>
  <div class="consent-row" style="text-align:right"><input type="checkbox" id="obPush"><label for="obPush">אני מאשר/ת תזכורת יומית בהתראות למכשיר הזה. אפשר לבטל בכל רגע.</label></div>
  <div class="dlg-actions"><button class="btn" id="obSave" style="flex:1">שמירת הבחירות</button></div>
  <div class="dlg-actions"><button class="btn soft" id="obSkip" style="flex:1">להמשיך בלי התראות</button></div>
  <p class="finish-status" id="obStatus"></p></div>`
  document.body.append(dlg)
  const done=async(withSubs)=>{
    const st=dlg.querySelector('#obStatus')
    if(withSubs){
      st.textContent='שומרים…'
      try{
        if(dlg.querySelector('#obEmail').checked){
          await sb.from('email_subscriptions').upsert({user_id:uid,email:profile.email,subscribed:true,timezone:'Asia/Jerusalem',updated_at:new Date().toISOString()})
          $('emailOptin').checked=true;$('emailStatus').textContent='מנוי'}
        if(dlg.querySelector('#obPush').checked){
          const ok=await pushEnable()
          if(ok){extras.settings.reminder=true;$('setReminder').checked=true}
          else showToast('המכשיר לא אישר התראות. אפשר להפעיל מאוחר יותר בהגדרות')}
      }catch{st.textContent='חלק מהשמירה נכשל. אפשר לנסות שוב מההגדרות.'}}
    extras.onboarded=true
    putExtras()
    dlg.remove()
  }
  dlg.querySelector('#obSave').onclick=()=>done(true)
  dlg.querySelector('#obSkip').onclick=()=>done(false)
}

/* ---------- boot ---------- */
async function load(){
  try{
    const record=await getContent()
    mount(record)
    try{const d=JSON.parse(localStorage.getItem('keviata-demo-progress')||'null');if(d&&d.progress)progress=d.progress;if(d&&d.profile)profile=d.profile}catch{}
    await Promise.all([getArchive(),getExtras(),loadEmailPref()])
    const d=progress.days?.[edition.id]
    if(d)idx=Math.max(0,Math.min(N-1,Number(d.slide)||0))
    restoring=true;render()
    if(d?.scroll)requestAnimationFrame(()=>{const el=slides[idx];if(el)el.scrollTop=Number(d.scroll)*Math.max(0,el.scrollHeight-el.clientHeight);restoring=false})
    else restoring=false
    $('acctSub').textContent=profile.email?profile.email:'עריכת פרטים אישיים'
    applySettings();ensureDark();renderHome();renderLearn();renderProfile()
    const qp=new URLSearchParams(location.search)
    if(qp.get('tab')&&TAB_NAMES[qp.get('tab')])showTab(qp.get('tab'))
    if(qp.has('learn'))openReader()
  }catch{
    track.innerHTML='<div class="loading-line"><h1>המהדורה לא נטענה</h1><p>אפשר לנסות שוב כשהחיבור יחזור.</p></div>'
    $('homeMsg').textContent='לא הצלחנו לטעון. בדקו את החיבור ונסו שוב.'
  }
}
function network(){offlineBanner.hidden=navigator.onLine}
addEventListener('online',()=>{network();save()});addEventListener('offline',network);network()
addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;$('installRow').hidden=false})
if('serviceWorker'in navigator)addEventListener('load',()=>navigator.serviceWorker.register('sw.js'))
const u=await getUser();if(!u)location.replace('login/');else{profile={name:u.name,email:u.email,pictureUrl:u.pictureUrl};load();cloudLoad().then(()=>{renderHome();renderLearn();renderProfile();applySettings();setTimeout(openOnboarding,600)})}

$('logoutBtn').onclick=logout
