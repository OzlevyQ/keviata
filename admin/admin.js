/* Keviata admin page: loads aggregated operational stats from the admin-overview
   edge function. Authorization is enforced server-side; this page only renders. */
(function(){
'use strict';
var ADMIN_URL='https://kuehljnnpwgzyodjaund.supabase.co/functions/v1/admin-overview';
var DESCOPE_PID='P3JSQ5xGjXf4sEVQz7q0lTaAgN54';
var $=function(id){return document.getElementById(id)};
var esc=function(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})};

function gate(title,msg,btns,err){
  $('dashRoot').hidden=true;$('gateRoot').hidden=false;
  $('gateTitle').textContent=title;$('gateMsg').textContent=msg;
  $('gateBtns').innerHTML='';(btns||[]).forEach(function(b){
    var el=document.createElement(b.href?'a':'button');
    el.className='btn primary';el.textContent=b.t;
    if(b.href){el.href=b.href;el.style.display='inline-block';el.style.textDecoration='none'}
    else{el.type='button';el.onclick=b.fn}
    $('gateBtns').appendChild(el);
  });
  $('gateErr').textContent=err||'';
}

function stat(value,label,cls){
  return '<div class="card stat"><b'+(cls?' class="'+cls+'"':'')+'>'+esc(value)+'</b><span>'+esc(label)+'</span></div>';
}
function pill(ok,mid,tOk,tMid,tBad){
  if(ok)return '<span class="pill ok">'+esc(tOk)+'</span>';
  if(mid)return '<span class="pill mid">'+esc(tMid)+'</span>';
  return '<span class="pill bad">'+esc(tBad)+'</span>';
}
function fmtTime(iso){
  try{return new Intl.DateTimeFormat('he-IL',{timeZone:'Asia/Jerusalem',day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(iso))}catch(e){return iso||''}
}

function render(d){
  $('dashRoot').hidden=false;$('gateRoot').hidden=true;
  $('snapLine').textContent='עדכון אחרון: '+fmtTime(d.generatedAt)+' · היום '+esc(d.today);
  var st=d.status||{},subs=d.subscribers||{},lr=d.learners||{};
  var pub=st.publicationPush||{},mail=st.dailyEmail||{};

  var edPill=st.todayEditionPublished
    ?pill(true,false,'פורסמה','','')
    :pill(false,true,'','טרם פורסמה','');
  $('statusGrid').innerHTML=
    '<div class="card stat"><b style="font-size:16px;line-height:1.5">'+esc(st.latestEditionDate||'—')+'<br>'+edPill+'</b><span>מהדורת היום</span></div>'+
    stat((pub.deliveredForLatest||0)+' / '+(pub.publicationOptIns||0),'פוש פרסום נמסר למהדורה האחרונה',(pub.deliveredForLatest||0)>=(pub.publicationOptIns||0)?'ok':'bad')+
    stat((mail.deliveredForLatest||0)+' / '+(mail.emailOptIns||0),'מייל יומי נמסר למהדורה האחרונה',(mail.deliveredForLatest||0)>=(mail.emailOptIns||0)?'ok':'bad');

  $('subGrid').innerHTML=
    stat(subs.pushPublicationOptIns||0,'מנויים לפוש פרסום יומי')+
    stat(subs.pushReminderOptIns||0,'מנויים לתזכורת לימוד')+
    stat(subs.pushOptedIn||0,'מכשירים עם התראות פעילות')+
    stat(subs.emailOptIns||0,'מנויים למייל היומי');

  $('learnGrid').innerHTML=
    stat(lr.totalUsers||0,'משתמשים רשומים')+
    stat(lr.activeLast7Days||0,'למדו ב-7 הימים האחרונים')+
    stat(lr.editionsCompletedTotal||0,'מהדורות שהושלמו סה״כ');

  var eds=d.editions||[];
  $('edRows').innerHTML=eds.length?eds.map(function(e){
    return '<tr><td style="white-space:nowrap">'+esc(e.date)+'</td><td>'+esc(e.title)+'</td><td>'+esc(e.hebrewDate)+'</td><td>'+esc(e.slides==null?'—':e.slides)+'</td><td>'+esc(e.learnersStarted)+'</td><td>'+esc(e.learnersCompleted)+'</td></tr>';
  }).join(''):'<tr class="muted-row"><td colspan="6">אין מהדורות עדיין.</td></tr>';
}

var sessionJwt=null;
function loadData(){
  return fetch(ADMIN_URL,{method:'POST',headers:{authorization:'Bearer '+sessionJwt},cache:'no-store'})
    .then(function(r){
      if(r.status===401){location.replace('../login/');throw {silent:true}}
      if(r.status===403){gate('אין גישה לדף הזה','דף הניהול פתוח רק לחשבון המנהל. אם התחברת עם חשבון אחר, התנתק והתחבר שוב.',[{t:'חזרה לאפליקציה',href:'../'}]);throw {silent:true}}
      if(!r.ok)throw new Error('server_'+r.status);
      return r.json();
    })
    .then(render)
    .catch(function(e){
      if(e&&e.silent)return;
      gate('לא הצלחנו לטעון את הנתונים','בדוק את החיבור ונסה שוב.',[{t:'נסה שוב',fn:loadData}],'');
    });
}

function boot(){
  var sdk;
  try{sdk=Descope({projectId:DESCOPE_PID,persistTokens:true})}catch(e){
    gate('לא הצלחנו לטעון את מנגנון הכניסה','בדוק את החיבור ונסה שוב.',[{t:'נסה שוב',fn:function(){location.reload()}}]);return;
  }
  sdk.refresh().then(function(r){
    sessionJwt=r&&r.data&&r.data.sessionJwt;
    if(!sessionJwt){location.replace('../login/');return}
    loadData();
  }).catch(function(){location.replace('../login/')});
}
$('refreshBtn').onclick=function(){if(sessionJwt)loadData()};
boot();
})();
