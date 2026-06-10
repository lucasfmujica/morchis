import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

/* ── web-push (VAPID / RFC 8291), unchanged ──────────────────────────────── */
function b64uEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let str = ''; bytes.forEach(b => (str += String.fromCharCode(b)));
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
function b64uDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64.padEnd(b64.length + (4 - b64.length % 4) % 4, '=')), c => c.charCodeAt(0));
}
function concat(a: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(a.reduce((s,x)=>s+x.length,0)); let o=0; for(const x of a){out.set(x,o);o+=x.length;} return out;
}
async function vapidJWT(aud: string, sub: string, privB64u: string): Promise<string> {
  const enc = new TextEncoder();
  const h = b64uEncode(enc.encode(JSON.stringify({typ:'JWT',alg:'ES256'})));
  const p = b64uEncode(enc.encode(JSON.stringify({aud,exp:Math.floor(Date.now()/1000)+43200,sub})));
  const inp = `${h}.${p}`;
  const key = await crypto.subtle.importKey('pkcs8',b64uDecode(privB64u),{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  return `${inp}.${b64uEncode(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,enc.encode(inp)))}`;
}
async function encryptWebPush(payload: string, p256dh: string, authKey: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const recPub = b64uDecode(p256dh);
  const kp = await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  const srvPub = new Uint8Array(await crypto.subtle.exportKey('raw',kp.publicKey));
  const recKey = await crypto.subtle.importKey('raw',recPub,{name:'ECDH',namedCurve:'P-256'},false,[]);
  const ss = new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:recKey},kp.privateKey as CryptoKey,256));
  const ikm = await crypto.subtle.importKey('raw',ss,'HKDF',false,['deriveBits']);
  const prk = new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt:b64uDecode(authKey),info:concat([enc.encode('WebPush: info\0'),recPub,srvPub])},ikm,256));
  const pk = await crypto.subtle.importKey('raw',prk,'HKDF',false,['deriveBits']);
  const cek = new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info:enc.encode('Content-Encoding: aes128gcm\0')},pk,128));
  const nonce = new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info:enc.encode('Content-Encoding: nonce\0')},pk,96));
  const ck = await crypto.subtle.importKey('raw',cek,'AES-GCM',false,['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,tagLength:128},ck,concat([enc.encode(payload),new Uint8Array([2])])));
  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0,ct.length+1,false);
  return concat([salt,rs,new Uint8Array([srvPub.length]),srvPub,ct]);
}
async function sendWebPush(sub:{endpoint:string;p256dh:string;auth_key:string},payload:Record<string,string>,vPub:string,vPriv:string):Promise<void>{
  const {origin}=new URL(sub.endpoint);
  const jwt=await vapidJWT(origin,'mailto:hola@morchis.app',vPriv);
  const ct=await encryptWebPush(JSON.stringify(payload),sub.p256dh,sub.auth_key);
  const r=await fetch(sub.endpoint,{method:'POST',headers:{'Content-Type':'application/octet-stream','Content-Encoding':'aes128gcm','TTL':'86400','Authorization':`vapid t=${jwt},k=${vPub}`},body:ct});
  if(!r.ok&&r.status!==201)console.error('Push failed',r.status,await r.text().catch(()=>''));
}

function jwtPayload(token:string):Record<string,unknown>|null{
  try{return JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));}catch{return null;}
}

/* ── types ───────────────────────────────────────────────────────────────── */
interface Profile{id:string;nickname:string|null;display_name:string|null;notification_prefs:Record<string,boolean>|null;}
interface InsightCard{title:string;body:string;severity:string;kind:string;}
interface PushSub{endpoint:string;p256dh:string;auth_key:string;profile_id:string;}
interface Fact{kind:string;severity:'info'|'positive'|'warning';weight:number;text:string;}
interface Split{payer_profile_id:string;ower_profile_id:string;amount:number;}
interface Exp{id:string;category_id:string|null;categories:{name:string}|null;profile_id:string;scope:string;is_shared:boolean;amount:number;currency:string;usd_rate_snapshot:number|null;merchant:string|null;occurred_on:string;splits:Split[]|null;}
interface Debt{transaction_id:string|null;direction:string;amount:number;currency:string;}
// id null = household ("Nuestro"); otherwise a person ("Mío" for that person).
interface Aud{id:string|null;name:string;}

const fmt=(n:number):string=>'$'+Math.round(n).toLocaleString('es-AR');
// "now" in Argentina (UTC-3, no DST) — the server clock is UTC and would
// roll to tomorrow / next month after 21:00 local.
const artNow=()=>new Date(Date.now()-3*60*60*1000);
function iso(y:number,m:number,d:number){return new Date(Date.UTC(y,m,d)).toISOString().slice(0,10);}
function monthsBetween(a:Date,b:Date){return (b.getFullYear()-a.getFullYear())*12+(b.getMonth()-a.getMonth());}
const MONTHLY:Record<string,number>={weekly:4.345,biweekly:2.17,monthly:1};
const toArs=(a:number,cur:string,snap:number|null,blue:number)=>cur==='USD'?a*(Number(snap)||blue):a;

function parseCards(raw:string):InsightCard[]{
  let s=raw.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/i,'').trim();
  const a=s.indexOf('['), b=s.lastIndexOf(']');
  if(a!==-1&&b>a)s=s.slice(a,b+1);
  let arr:unknown;
  try{arr=JSON.parse(s);}catch(e){console.error('Parse error',e,raw);return[];}
  if(!Array.isArray(arr))return[];
  return (arr as InsightCard[])
    .filter(c=>c&&typeof c.title==='string'&&c.title.trim()&&typeof c.body==='string'&&c.body.trim())
    .slice(0,6);
}

interface Data{
  curr:Exp[]; hist:Exp[]; income:{amount:number;currency:string;usd_rate_snapshot:number|null}[];
  rec:{label:string;amount:number;currency:string;cadence:string;scope:string;profile_id:string;categories:{name:string}|null}[];
  buds:{amount:number;currency:string;scope:string;profile_id:string|null;categories:{name:string}|null}[];
  goals:{name:string;target_amount:number;current_amount:number;target_currency:string;deadline:string|null;scope:string;profile_id:string|null}[];
  debtByTx:Record<string,Debt[]>; targetPct:number; blue:number; profiles:Profile[];
}

async function fetchAll(admin:SupabaseClient,hid:string):Promise<Data>{
  const now=artNow();
  const y=now.getUTCFullYear(),m=now.getUTCMonth();
  const m0=iso(y,m,1),m1=iso(y,m+1,1),m3=iso(y,m-3,1);
  const expSel='id,category_id,categories(name),profile_id,scope,is_shared,amount,currency,usd_rate_snapshot,merchant,occurred_on,splits(payer_profile_id,ower_profile_id,amount)';
  const [cr,hr,ir,recR,budR,goalR,savR,prR,debtR,fxR]=await Promise.all([
    admin.from('transactions').select(expSel).eq('household_id',hid).eq('type','expense').gte('occurred_on',m0).lt('occurred_on',m1),
    admin.from('transactions').select(expSel).eq('household_id',hid).eq('type','expense').gte('occurred_on',m3).lt('occurred_on',m0),
    admin.from('transactions').select('amount,currency,usd_rate_snapshot').eq('household_id',hid).eq('type','income').gte('occurred_on',m0).lt('occurred_on',m1),
    // goal_id is null filters out goal auto-contributions — they're committed
    // savings, not fixed expenses.
    admin.from('recurring_rules').select('label,amount,currency,cadence,scope,profile_id,categories(name)').eq('household_id',hid).eq('active',true).eq('direction','expense').is('goal_id',null),
    admin.from('budgets').select('amount,currency,scope,profile_id,categories(name)').eq('household_id',hid).eq('active',true),
    admin.from('goals').select('name,target_amount,current_amount,target_currency,deadline,scope,profile_id').eq('household_id',hid).eq('archived',false),
    admin.from('savings_goals').select('target_pct').order('month',{ascending:false}).limit(1).maybeSingle(),
    admin.from('profiles').select('id,nickname,display_name,notification_prefs').eq('household_id',hid),
    // Linked friend-debts net out of the expense's real cost regardless of
    // settled: the friend paying their part back doesn't make the expense
    // cost more (the repayment is never recorded as income).
    admin.from('debts').select('transaction_id,direction,amount,currency').eq('household_id',hid).not('transaction_id','is',null),
    admin.from('fx_rates').select('ars_per_usd').eq('source','blue').order('date',{ascending:false}).limit(1).maybeSingle(),
  ]);
  const debtByTx:Record<string,Debt[]>={};
  for(const d of (debtR.data??[]) as Debt[]){if(!d.transaction_id)continue;(debtByTx[d.transaction_id]??=[]).push(d);}
  return {
    curr:(cr.data??[]) as Exp[], hist:(hr.data??[]) as Exp[], income:(ir.data??[]) as Data['income'],
    rec:(recR.data??[]) as Data['rec'], buds:(budR.data??[]) as Data['buds'], goals:(goalR.data??[]) as Data['goals'],
    debtByTx, targetPct:Number(savR.data?.target_pct??20), blue:Number(fxR.data?.ars_per_usd??1200),
    profiles:(prR.data??[]) as Profile[],
  };
}

// External 'owed' debts (a friend repays) linked to a transaction, in ARS.
function owedBackArs(txId:string,debtByTx:Record<string,Debt[]>,blue:number):number{
  return (debtByTx[txId]??[]).filter(d=>d.direction==='owed').reduce((s,d)=>s+toArs(d.amount,d.currency,null,blue),0);
}

// How much of an expense counts for an audience, in ARS:
//  - household (audId null): only household-scope expenses, full amount.
//  - a person (audId): their personal expenses + their split share of shared ones.
// In both cases, money a friend repays (linked 'owed' debt) is netted out of the
// payer's / household's real cost.
function shareFor(t:Exp,audId:string|null,blue:number,debtByTx:Record<string,Debt[]>):number{
  const total=toArs(t.amount,t.currency,t.usd_rate_snapshot,blue);
  let base:number;
  if(audId===null){
    if(t.scope!=='household')return 0;
    base=total;
  }else{
    if(!t.is_shared){ base=t.profile_id===audId?total:0; }
    else{
      const sp=t.splits??[];
      const iOwe=sp.filter(s=>s.ower_profile_id===audId).reduce((a,s)=>a+s.amount,0);
      if(iOwe>0) base=iOwe;
      else{ const owedToMe=sp.filter(s=>s.payer_profile_id===audId).reduce((a,s)=>a+s.amount,0);
        base=owedToMe>0?Math.max(0,total-owedToMe):(t.profile_id===audId?total:0); }
    }
  }
  if(base<=0)return 0;
  const owns=audId===null?(t.scope==='household'):(t.profile_id===audId);
  return owns?Math.max(0,base-owedBackArs(t.id,debtByTx,blue)):base;
}

function buildFacts(aud:Aud,d:Data):{facts:Fact[];expense:number}{
  const now=artNow();
  const dim=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,0)).getUTCDate();
  const day=now.getUTCDate();
  const isHH=aud.id===null;
  const facts:Fact[]=[];

  // category current + 3-month history for this audience
  const catCur:Record<string,{total:number;n:number;small:number}>={};
  for(const t of d.curr){const v=shareFor(t,aud.id,d.blue,d.debtByTx);if(v<=0)continue;const n=t.categories?.name??'Sin categoría';(catCur[n]??={total:0,n:0,small:0});catCur[n].total+=v;catCur[n].n++;if(v<12000)catCur[n].small++;}
  const catHist:Record<string,number>={};
  for(const t of d.hist){const v=shareFor(t,aud.id,d.blue,d.debtByTx);if(v<=0)continue;const n=t.categories?.name??'Sin categoría';catHist[n]=(catHist[n]??0)+v;}
  const expense=Object.values(catCur).reduce((s,v)=>s+v.total,0);

  // 1. savings rate (household only — couple-level income vs ALL spending).
  // Uses total expenses (personal + shared, minus money friends repay), not the
  // household-scope-only `expense` used for the shared category breakdown.
  if(isHH){
    const income=d.income.reduce((s,t)=>s+toArs(t.amount,t.currency,t.usd_rate_snapshot,d.blue),0);
    const totalExp=d.curr.reduce((s,t)=>s+Math.max(0,toArs(t.amount,t.currency,t.usd_rate_snapshot,d.blue)-owedBackArs(t.id,d.debtByTx,d.blue)),0);
    const net=income-totalExp;
    if(income>0){
      const rate=Math.round(net/income*100);
      if(rate>=d.targetPct) facts.push({kind:'saving',severity:'positive',weight:6,text:`Tasa de ahorro del hogar al día ${day} del mes (mes incompleto): ${rate}% (ahorran ${fmt(net)} de ${fmt(income)} de ingresos). Meta: ${d.targetPct}%. Van por encima.`});
      // A negative rate early in the month usually just means salaries haven't
      // landed yet — skip the alarmist fact until day 20.
      else if(rate>=0||day>=20) facts.push({kind:'saving',severity:'warning',weight:9,text:`Tasa de ahorro del hogar al día ${day} del mes (mes incompleto, puede faltar ingresar sueldos): ${rate}% (ahorran ${fmt(net)} de ${fmt(income)}), por debajo de la meta de ${d.targetPct}%. Falta recortar ${fmt(income*d.targetPct/100-net)}.`});
    }
  }else{
    // money a friend will repay this person (already netted out of the figures)
    let owed=0;
    for(const t of d.curr){ if(t.profile_id===aud.id) owed+=owedBackArs(t.id,d.debtByTx,d.blue); }
    if(owed>=3000) facts.push({kind:'debt',severity:'info',weight:5,text:`Te van a devolver ${fmt(owed)} de tus gastos (ya descontado de estos números).`});
  }

  // 2. category spikes vs the average of the months that actually have data
  // (a young household with 1 month of history shouldn't see a "+200%" spike
  // just because we divided by 3).
  const histMonths=Math.max(1,new Set(d.hist.map(t=>t.occurred_on.slice(0,7))).size);
  for(const [name,v] of Object.entries(catCur)){
    const avg=(catHist[name]??0)/histMonths;
    if(avg>0){const pct=Math.round((v.total-avg)/avg*100);
      if(pct>=25&&(v.total-avg)>=20000) facts.push({kind:'spike',severity:'warning',weight:8,text:`${name}: ${fmt(v.total)} este mes vs ${fmt(avg)} de promedio (${pct>0?'+':''}${pct}%). ${fmt(v.total-avg)} más de lo habitual.`});
    }else if(v.total>=40000){ facts.push({kind:'spike',severity:'info',weight:5,text:`${name}: ${fmt(v.total)} este mes, categoría nueva (sin historial).`}); }
  }
  // 3. ant-spending
  for(const [name,v] of Object.entries(catCur)){ if(v.small>=6&&v.total>=30000) facts.push({kind:'anthill',severity:'info',weight:7,text:`Gastos hormiga: ${v.small} compras chicas en ${name} suman ${fmt(v.total)} este mes.`}); }
  // 4. possible duplicates (only this audience's own transactions)
  const dup:Record<string,{n:number;name:string;amt:number;day:string}>={};
  for(const t of d.curr){ if(!t.merchant)continue; if(shareFor(t,aud.id,d.blue,d.debtByTx)<=0)continue;
    const a=Math.round(toArs(t.amount,t.currency,t.usd_rate_snapshot,d.blue)); const k=`${t.merchant.toLowerCase()}_${a}_${t.occurred_on}`;
    (dup[k]??={n:0,name:t.merchant,amt:a,day:t.occurred_on}).n++; }
  for(const dd of Object.values(dup)) if(dd.n>=2&&dd.amt>=3000) facts.push({kind:'duplicate',severity:'warning',weight:8,text:`Posible cargo duplicado: "${dd.name}" por ${fmt(dd.amt)} aparece ${dd.n} veces el ${dd.day}. Revisalo.`});

  // 5. subscriptions / fixed costs relevant to the audience
  const recAud=d.rec.filter(r=>isHH?r.scope==='household':(r.scope==='personal'&&r.profile_id===aud.id));
  if(recAud.length){
    const monthly=recAud.map(r=>({name:r.categories?.name??r.label,label:r.label,m:toArs(r.amount,r.currency,null,d.blue)*(MONTHLY[r.cadence]??1)}));
    const subsTotal=monthly.reduce((s,r)=>s+r.m,0);
    const pctOfExp=expense>0?Math.round(subsTotal/expense*100):0;
    const top=[...monthly].sort((a,b)=>b.m-a.m).slice(0,3).map(r=>`${r.label} ${fmt(r.m)}`).join(', ');
    facts.push({kind:'subscription',severity:'info',weight:6,text:`Gastos fijos: ${fmt(subsTotal)}/mes en ${recAud.length} (${top}${monthly.length>3?'…':''})${pctOfExp?`, ${pctOfExp}% de los gastos al día ${day} (mes incompleto)`:''}.`});
    const byCat:Record<string,number>={}; for(const r of monthly)byCat[r.name]=(byCat[r.name]??0)+1;
    for(const [name,n] of Object.entries(byCat)) if(n>=2) facts.push({kind:'subscription',severity:'warning',weight:8,text:`${n} suscripciones en ${name}. Cancelando una recortás el gasto fijo.`});
  }

  // 6. budgets relevant to the audience
  const budAud=d.buds.filter(b=>isHH?b.scope==='household':(b.scope==='personal'&&b.profile_id===aud.id));
  for(const b of budAud){ const name=b.categories?.name; if(!name)continue; const lim=toArs(b.amount,b.currency,null,d.blue); if(lim<=0)continue;
    const spent=catCur[name]?.total??0; const pct=Math.round(spent/lim*100); const projected=day>0?spent/day*dim:spent;
    if(pct>=85) facts.push({kind:'budget',severity:pct>=100?'warning':'info',weight:pct>=100?9:7,text:`Presupuesto ${name}: ${fmt(spent)} de ${fmt(lim)} (${pct}%)${pct<100?`, quedan ${dim-day} días`:' — superado'}.`});
    else if(projected>lim*1.1) facts.push({kind:'budget',severity:'info',weight:6,text:`Presupuesto ${name}: vas ${fmt(spent)} de ${fmt(lim)}; a este ritmo proyectás ${fmt(projected)}.`}); }

  // 7. goals relevant to the audience
  const goalAud=d.goals.filter(g=>isHH?g.scope==='household':(g.scope==='personal'&&g.profile_id===aud.id));
  for(const g of goalAud){ if(!g.deadline)continue;
    const remaining=Math.max(0,(g.target_currency==='USD'?(g.target_amount-g.current_amount)*d.blue:(g.target_amount-g.current_amount)));
    if(remaining<=0)continue; const months=Math.max(1,monthsBetween(now,new Date(g.deadline))); const required=remaining/months;
    facts.push({kind:'goal',severity:'info',weight:4,text:`Meta "${g.name}": faltan ${fmt(remaining)}, apartando ${fmt(required)}/mes llegás al ${g.deadline}.`}); }

  // 8. top category summary
  const top=Object.entries(catCur).sort((a,b)=>b[1].total-a[1].total)[0];
  if(top) facts.push({kind:'summary',severity:'info',weight:3,text:`Mayor gasto: ${top[0]} con ${fmt(top[1].total)} en ${top[1].n} movimientos.`});

  facts.sort((a,b)=>b.weight-a.weight);
  return {facts:facts.slice(0,12),expense};
}

function buildPrompt(aud:Aud,facts:Fact[],mode:string):string{
  const n=mode==='lite'?'2-3':'3-6';
  const who=aud.id===null
    ? 'Estos son los gastos COMPARTIDOS / del hogar de la pareja (no incluyen gastos personales de cada uno).'
    : `Estos son los gastos de ${aud.name} (su parte personal: lo suyo + su mitad de lo compartido, ya descontando lo que le devuelven amigos).`;
  const lines=facts.map((f,i)=>`${i+1}. [${f.severity}] ${f.text}`);
  return `${who}\nHechos ya calculados (números EXACTOS, usalos tal cual, no recalcules):\n${lines.join('\n')}\n\nElegí los ${n} más importantes y accionables y convertilos en cards.`;
}

const SYSTEM='Sos el coach financiero de Morchis, una app para una pareja argentina (Lucas y Sofi). Hablás en español rioplatense, cercano y motivador. Te paso HECHOS ya calculados (los montos son exactos). Elegí los más importantes y convertilos en cards breves y ACCIONABLES — cada una sugiere UNA cosa concreta para gastar menos, ahorrar más o evitar un problema. Reglas: (1) Usá SOLO números que aparezcan en los hechos, nunca inventes ni recalcules. (2) Priorizá ahorro y alertas por encima de lo descriptivo. (3) Si un hecho aclara que el mes está incompleto (ej: "al día N del mes"), presentalo como parcial — nunca como resultado final del mes ni como pérdida confirmada; una tasa de ahorro negativa a mitad de mes suele ser que faltan ingresar sueldos. (4) Respondé SOLO con un array JSON sin markdown. Cada item: {"title":string(≤7 palabras),"body":string(1-2 oraciones con el número del hecho + una acción concreta, ≤30 palabras),"severity":"info"|"positive"|"warning","kind":"saving"|"spike"|"anthill"|"duplicate"|"subscription"|"budget"|"goal"|"debt"|"summary"}.';

async function generateFor(anthropic:Anthropic,admin:SupabaseClient,hid:string,aud:Aud,d:Data,mode:string,period:string,vPub:string,vPriv:string):Promise<number>{
  const {facts}=buildFacts(aud,d);
  if(!facts.length)return 0;
  const resp=await anthropic.messages.create({
    model:'claude-sonnet-4-6',
    max_tokens:1200,
    system:[{type:'text',text:SYSTEM,cache_control:{type:'ephemeral'}}],
    messages:[{role:'user',content:buildPrompt(aud,facts,mode)}],
  });
  const raw=resp.content[0].type==='text'?resp.content[0].text.trim():'';
  const cards=parseCards(raw);
  if(!cards.length){console.error('No valid cards',aud.name,raw);return 0;}
  // Insert fresh batch for this audience, then clear the previous one (scoped to
  // this period + audience, so each tab's insights are replaced independently).
  const{data:ins,error:insErr}=await admin.from('insights').insert(cards.map(c=>({household_id:hid,profile_id:aud.id,period,kind:c.kind,title:c.title,body:c.body,severity:['info','positive','warning'].includes(c.severity)?c.severity:'info',seen:false}))).select('id,severity,title,body');
  if(insErr||!ins){console.error('Insert error',aud.name,insErr);return 0;}
  const newIds=(ins as {id:string}[]).map(i=>i.id);
  let del=admin.from('insights').delete().eq('household_id',hid).eq('period',period).not('id','in',`(${newIds.join(',')})`);
  del=aud.id===null?del.is('profile_id',null):del.eq('profile_id',aud.id);
  await del;
  // Push the top alert to the relevant people (household → both; person → them).
  if(vPub&&vPriv){
    const noti=(ins as {severity:string;title:string;body:string}[]).filter(i=>i.severity==='warning'||i.severity==='positive');
    if(noti.length){
      // Honor the per-person "insights" notification preference (absent = on).
      const enabled=d.profiles.filter(p=>(p.notification_prefs?.insights)!==false).map(p=>p.id);
      const targetIds=(aud.id===null?enabled:enabled.filter(id=>id===aud.id));
      const{data:subs}=await admin.from('push_subscriptions').select('endpoint,p256dh,auth_key,profile_id').in('profile_id',targetIds);
      if(subs?.length){const top=noti[0];for(const sub of subs as PushSub[])try{await sendWebPush(sub,{title:top.title,body:top.body,url:'/home'},vPub,vPriv);}catch(e){console.error('Push err',e);}}
    }
  }
  return cards.length;
}

async function processHousehold(admin:SupabaseClient,hid:string,mode:string,apiKey:string,vPub:string,vPriv:string):Promise<number>{
  const d=await fetchAll(admin,hid);
  if(d.curr.length===0&&d.income.length===0){console.log('No data',hid);return 0;}
  const auds:Aud[]=[{id:null,name:'Hogar'},...d.profiles.map(p=>({id:p.id,name:p.nickname??p.display_name??'Usuario'}))];
  const now=artNow();
  const period=`${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}`;
  const anthropic=new Anthropic({apiKey});
  let total=0;
  for(const aud of auds){
    try{total+=await generateFor(anthropic,admin,hid,aud,d,mode,period,vPub,vPriv);}
    catch(e){console.error('Audience error',aud.name,e);}
  }
  return total;
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response(null,{headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'POST,OPTIONS'}});
  const cors={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};
  const supabaseUrl=Deno.env.get('SUPABASE_URL')!;
  const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey=Deno.env.get('SUPABASE_ANON_KEY')!;
  const anthropicKey=Deno.env.get('ANTHROPIC_API_KEY')!;
  const vPub=Deno.env.get('VAPID_PUBLIC_KEY')??'';
  const vPriv=Deno.env.get('VAPID_PRIVATE_KEY')??'';
  const admin=createClient(supabaseUrl,serviceKey);
  const auth=req.headers.get('Authorization')??'';
  const token=auth.startsWith('Bearer ')?auth.slice(7):'';
  if(!token)return new Response('Unauthorized',{status:401});
  const payload=jwtPayload(token);
  const role=payload?.role as string|undefined;
  let requestedHid:string|null=null;
  if(role==='service_role'){
    // cron or admin — process all households
  } else {
    const userClient=createClient(supabaseUrl,anonKey,{global:{headers:{Authorization:auth}}});
    const{data:{user}}=await userClient.auth.getUser();
    if(!user)return new Response('Unauthorized',{status:401});
    const{data:prof}=await admin.from('profiles').select('household_id').eq('id',user.id).single();
    if(!prof?.household_id)return new Response('No household',{status:400});
    requestedHid=prof.household_id;
  }
  let body:{mode?:string}={};
  try{body=await req.json();}catch{/*empty*/}
  const mode=body.mode==='lite'?'lite':'full';
  const{data:households}=requestedHid?{data:[{id:requestedHid}]}:await admin.from('households').select('id');
  const results:{household_id:string;count?:number;error?:string}[]=[];
  for(const hh of(households??[])){
    try{results.push({household_id:hh.id,count:await processHousehold(admin,hh.id,mode,anthropicKey,vPub,vPriv)});}
    catch(err){console.error('Error',hh.id,err);results.push({household_id:hh.id,error:String(err)});}
  }
  const generated=results.reduce((s,r)=>s+(r.count??0),0);
  const anyError=results.some(r=>r.error);
  return new Response(JSON.stringify({ok:generated>0,generated,results}),{status:anyError&&generated===0?502:200,headers:cors});
});
