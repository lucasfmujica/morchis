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
interface Profile{id:string;nickname:string|null;display_name:string|null;}
interface InsightCard{title:string;body:string;severity:string;kind:string;}
interface PushSub{endpoint:string;p256dh:string;auth_key:string;profile_id:string;}
// A "fact" is a fully-computed signal. All money math lives here in TS; the LLM
// only picks the important facts and phrases them — it never does arithmetic.
interface Fact{kind:string;severity:'info'|'positive'|'warning';weight:number;text:string;}

/* ── money helpers (everything normalised to ARS) ────────────────────────── */
const fmt=(n:number):string=>'$'+Math.round(n).toLocaleString('es-AR');
function iso(y:number,m:number,d:number){return new Date(y,m,d).toISOString().slice(0,10);}
function monthsBetween(a:Date,b:Date){return (b.getFullYear()-a.getFullYear())*12+(b.getMonth()-a.getMonth());}
const MONTHLY:Record<string,number>={weekly:4.345,biweekly:2.17,monthly:1};

/* ── pull the first JSON array out of the model reply, tolerating fences ──── */
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

/* ── gather every signal in TypeScript and turn it into computed facts ────── */
interface ExpRow{category_id:string|null;categories:{name:string}|null;profile_id:string;scope:string;amount:number;currency:string;usd_rate_snapshot:number|null;merchant:string|null;occurred_on:string;}
interface HistRow{category_id:string|null;amount:number;currency:string;usd_rate_snapshot:number|null;}
interface RecRow{label:string;amount:number;currency:string;cadence:string;categories:{name:string}|null;}
interface BudRow{amount:number;currency:string;categories:{name:string}|null;}
interface GoalRow{name:string;target_amount:number;current_amount:number;target_currency:string;deadline:string|null;}

async function buildFacts(admin:SupabaseClient,hid:string):Promise<{facts:Fact[];hasData:boolean;income:number;expense:number}>{
  const now=new Date();
  const y=now.getFullYear(), m=now.getMonth();
  const m0=iso(y,m,1), m1=iso(y,m+1,1), m3=iso(y,m-3,1);
  const dim=new Date(y,m+1,0).getDate();
  const day=now.getDate();

  const [curR,histR,incR,recR,budR,goalR,savR,fxR]=await Promise.all([
    admin.from('transactions').select('category_id,categories(name),profile_id,scope,amount,currency,usd_rate_snapshot,merchant,occurred_on').eq('household_id',hid).eq('type','expense').gte('occurred_on',m0).lt('occurred_on',m1),
    admin.from('transactions').select('category_id,amount,currency,usd_rate_snapshot').eq('household_id',hid).eq('type','expense').gte('occurred_on',m3).lt('occurred_on',m0),
    admin.from('transactions').select('amount,currency,usd_rate_snapshot').eq('household_id',hid).eq('type','income').gte('occurred_on',m0).lt('occurred_on',m1),
    admin.from('recurring_rules').select('label,amount,currency,cadence,categories(name)').eq('household_id',hid).eq('active',true).eq('direction','expense'),
    admin.from('budgets').select('amount,currency,categories(name)').eq('household_id',hid).eq('active',true),
    admin.from('goals').select('name,target_amount,current_amount,target_currency,deadline').eq('household_id',hid).eq('archived',false),
    admin.from('savings_goals').select('target_pct').order('month',{ascending:false}).limit(1).maybeSingle(),
    admin.from('fx_rates').select('ars_per_usd').eq('source','blue').order('date',{ascending:false}).limit(1).maybeSingle(),
  ]);
  const blue=Number(fxR.data?.ars_per_usd??1200);
  const ars=(a:number,cur:string,snap:number|null)=>cur==='USD'?a*(Number(snap)||blue):a;

  const cur=(curR.data??[]) as ExpRow[];
  const hist=(histR.data??[]) as HistRow[];
  const inc=(incR.data??[]) as {amount:number;currency:string;usd_rate_snapshot:number|null}[];
  const rec=(recR.data??[]) as RecRow[];
  const buds=(budR.data??[]) as BudRow[];
  const goals=(goalR.data??[]) as GoalRow[];
  const targetPct=Number(savR.data?.target_pct??20);

  const expense=cur.reduce((s,t)=>s+ars(t.amount,t.currency,t.usd_rate_snapshot),0);
  const income=inc.reduce((s,t)=>s+ars(t.amount,t.currency,t.usd_rate_snapshot),0);
  const net=income-expense;
  const hasData=cur.length>0||income>0;
  const facts:Fact[]=[];

  // current + trailing-3m totals per category
  const catCur:Record<string,{name:string;total:number;n:number;small:number}>={};
  for(const t of cur){
    const k=t.category_id??'none';
    const name=t.categories?.name??'Sin categoría';
    const a=ars(t.amount,t.currency,t.usd_rate_snapshot);
    if(!catCur[k])catCur[k]={name,total:0,n:0,small:0};
    catCur[k].total+=a; catCur[k].n++; if(a<12000)catCur[k].small++;
  }
  const catHist:Record<string,number>={};
  for(const t of hist){const k=t.category_id??'none';catHist[k]=(catHist[k]??0)+ars(t.amount,t.currency,t.usd_rate_snapshot);}

  // 1. savings rate
  if(income>0){
    const rate=Math.round(net/income*100);
    if(rate>=targetPct) facts.push({kind:'saving',severity:'positive',weight:6,text:`Tasa de ahorro este mes: ${rate}% (ahorrás ${fmt(net)} de ${fmt(income)} de ingresos). Meta del hogar: ${targetPct}%. Van por encima.`});
    else facts.push({kind:'saving',severity:'warning',weight:9,text:`Tasa de ahorro este mes: ${rate}% (ahorrás ${fmt(net)} de ${fmt(income)} de ingresos), por debajo de la meta de ${targetPct}%. Falta recortar ${fmt(income*targetPct/100-net)} para llegar.`});
  }

  // 2. category spikes vs 3-month average
  for(const [k,v] of Object.entries(catCur)){
    const avg=(catHist[k]??0)/3;
    if(avg>0){
      const pct=Math.round((v.total-avg)/avg*100);
      if(pct>=25&&(v.total-avg)>=20000) facts.push({kind:'spike',severity:'warning',weight:8,text:`${v.name}: ${fmt(v.total)} este mes vs ${fmt(avg)} de promedio (${pct>0?'+':''}${pct}%). Es ${fmt(v.total-avg)} más de lo habitual.`});
    } else if(v.total>=40000){
      facts.push({kind:'spike',severity:'info',weight:5,text:`${v.name}: ${fmt(v.total)} este mes, categoría nueva (sin historial para comparar).`});
    }
  }

  // 3. ant-spending (many small purchases in one category)
  for(const v of Object.values(catCur)){
    if(v.small>=6&&v.total>=30000) facts.push({kind:'anthill',severity:'info',weight:7,text:`Gastos hormiga: ${v.small} compras chicas en ${v.name} suman ${fmt(v.total)} este mes.`});
  }

  // 4. possible duplicate charges (same merchant + amount + day, ≥2)
  const dup:Record<string,{n:number;name:string;amt:number;day:string}>={};
  for(const t of cur){
    if(!t.merchant)continue;
    const a=Math.round(ars(t.amount,t.currency,t.usd_rate_snapshot));
    const key=`${t.merchant.toLowerCase()}_${a}_${t.occurred_on}`;
    if(!dup[key])dup[key]={n:0,name:t.merchant,amt:a,day:t.occurred_on};
    dup[key].n++;
  }
  for(const d of Object.values(dup)) if(d.n>=2&&d.amt>=3000) facts.push({kind:'duplicate',severity:'warning',weight:8,text:`Posible cargo duplicado: "${d.name}" por ${fmt(d.amt)} aparece ${d.n} veces el ${d.day}. Revisalo.`});

  // 5. fixed subscriptions (recurring expenses) + creep detection
  if(rec.length){
    const monthly=rec.map(r=>({name:r.categories?.name??r.label,label:r.label,m:ars(r.amount,r.currency,null)*(MONTHLY[r.cadence]??1)}));
    const subsTotal=monthly.reduce((s,r)=>s+r.m,0);
    const pctOfExp=expense>0?Math.round(subsTotal/expense*100):0;
    const top=[...monthly].sort((a,b)=>b.m-a.m).slice(0,3).map(r=>`${r.label} ${fmt(r.m)}`).join(', ');
    facts.push({kind:'subscription',severity:'info',weight:6,text:`Suscripciones/gastos fijos: ${fmt(subsTotal)}/mes en ${rec.length} servicios (${top}${monthly.length>3?'…':''})${pctOfExp?`, ${pctOfExp}% de tus gastos`:''}.`});
    const byCat:Record<string,number>={};
    for(const r of monthly)byCat[r.name]=(byCat[r.name]??0)+1;
    for(const [name,n] of Object.entries(byCat)) if(n>=2) facts.push({kind:'subscription',severity:'warning',weight:8,text:`Tenés ${n} suscripciones en ${name}. Cancelando una recortás el gasto fijo mensual.`});
  }

  // 6. budgets — near limit or projected to overflow
  for(const b of buds){
    const name=b.categories?.name; if(!name)continue;
    const budArs=ars(b.amount,b.currency,null);
    const spent=Object.values(catCur).find(c=>c.name===name)?.total??0;
    if(budArs<=0)continue;
    const pct=Math.round(spent/budArs*100);
    const projected=day>0?spent/day*dim:spent;
    if(pct>=85) facts.push({kind:'budget',severity:pct>=100?'warning':'info',weight:pct>=100?9:7,text:`Presupuesto ${name}: ${fmt(spent)} de ${fmt(budArs)} (${pct}%)${pct<100?`, quedan ${dim-day} días`:' — superado'}.`});
    else if(projected>budArs*1.1) facts.push({kind:'budget',severity:'info',weight:6,text:`Presupuesto ${name}: vas ${fmt(spent)} de ${fmt(budArs)}; a este ritmo proyectás ${fmt(projected)} para fin de mes.`});
  }

  // 7. goal pace vs deadline
  for(const g of goals){
    if(!g.deadline)continue;
    const remaining=Math.max(0,(g.target_currency==='USD'?(g.target_amount-g.current_amount)*blue:(g.target_amount-g.current_amount)));
    if(remaining<=0)continue;
    const months=Math.max(1,monthsBetween(now,new Date(g.deadline)));
    const required=remaining/months;
    if(net>0&&required>net) facts.push({kind:'goal',severity:'warning',weight:7,text:`Meta "${g.name}": necesitás ${fmt(required)}/mes para llegar al ${g.deadline} (faltan ${fmt(remaining)}); tu ahorro de este mes fue ${fmt(net)}.`});
    else facts.push({kind:'goal',severity:'info',weight:4,text:`Meta "${g.name}": faltan ${fmt(remaining)}, apartando ${fmt(required)}/mes llegás al ${g.deadline}.`});
  }

  // 8. top category summary (always useful as a fallback card)
  const top=Object.values(catCur).sort((a,b)=>b.total-a.total)[0];
  if(top) facts.push({kind:'summary',severity:'info',weight:3,text:`Mayor gasto del mes: ${top.name} con ${fmt(top.total)} en ${top.n} movimientos.`});

  facts.sort((a,b)=>b.weight-a.weight);
  return {facts:facts.slice(0,12),hasData,income,expense};
}

function buildPrompt(facts:Fact[],mode:string):string{
  const n=mode==='lite'?'2-3':'3-6';
  const lines=facts.map((f,i)=>`${i+1}. [${f.severity}] ${f.text}`);
  return `Hechos ya calculados (los números son EXACTOS, usalos tal cual, no recalcules ni inventes):\n${lines.join('\n')}\n\nElegí los ${n} hechos más importantes y accionables y convertilos en cards.`;
}

const SYSTEM = 'Sos el coach financiero de Morchis, una app para una pareja argentina (Lucas y Sofi). Hablás en español rioplatense, cercano y motivador, sin ser invasivo. Te paso HECHOS ya calculados sobre sus finanzas del mes. Tu trabajo: elegir los más importantes y convertirlos en cards breves y ACCIONABLES — cada una sugiere UNA cosa concreta para gastar menos, ahorrar más o evitar un problema. Reglas: (1) Usá SOLO números que aparezcan en los hechos, nunca inventes ni recalcules montos. (2) Priorizá ahorro y alertas por encima de lo descriptivo. (3) Respondé SOLO con un array JSON sin markdown. Cada item: {"title":string(≤7 palabras),"body":string(1-2 oraciones que incluyan el número del hecho + una acción concreta, ≤30 palabras),"severity":"info"|"positive"|"warning","kind":"saving"|"spike"|"anthill"|"duplicate"|"subscription"|"budget"|"goal"|"summary"}.';

async function processHousehold(admin:SupabaseClient,hid:string,mode:string,apiKey:string,vPub:string,vPriv:string):Promise<number>{
  const [{facts,hasData},pr]=await Promise.all([
    buildFacts(admin,hid),
    admin.from('profiles').select('id,nickname,display_name').eq('household_id',hid),
  ]);
  const profiles=(pr.data??[]) as Profile[];
  if(!hasData||!facts.length){console.log('No data',hid);return 0;}

  const anthropic=new Anthropic({apiKey});
  const resp=await anthropic.messages.create({
    model:'claude-sonnet-4-6',
    max_tokens:1200,
    system:[{type:'text',text:SYSTEM,cache_control:{type:'ephemeral'}}],
    messages:[{role:'user',content:buildPrompt(facts,mode)}],
  });
  const raw=resp.content[0].type==='text'?resp.content[0].text.trim():'';
  const cards=parseCards(raw);
  if(!cards.length){console.error('No valid cards from model',raw);return 0;}

  const now=new Date();
  const period=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  // Insert the fresh batch FIRST, then clear the previous one — so a failed
  // refresh never wipes the existing insights and leaves the screen empty.
  const{data:ins,error:insErr}=await admin.from('insights').insert(cards.map(c=>({household_id:hid,period,kind:c.kind,title:c.title,body:c.body,severity:['info','positive','warning'].includes(c.severity)?c.severity:'info',seen:false}))).select('id,severity,title,body');
  if(insErr||!ins){console.error('Insert error',insErr);return 0;}
  const newIds=(ins as {id:string}[]).map(i=>i.id);
  if(newIds.length)await admin.from('insights').delete().eq('household_id',hid).eq('period',period).not('id','in',`(${newIds.join(',')})`);

  if(vPub&&vPriv&&ins){
    const noti=(ins as {severity:string;title:string;body:string}[]).filter(i=>i.severity==='warning'||i.severity==='positive');
    if(noti.length){
      const{data:subs}=await admin.from('push_subscriptions').select('endpoint,p256dh,auth_key,profile_id').in('profile_id',profiles.map(p=>p.id));
      if(subs?.length){const top=noti[0];for(const sub of subs as PushSub[])try{await sendWebPush(sub,{title:top.title,body:top.body,url:'/home'},vPub,vPriv);}catch(e){console.error('Push err',e);}}
    }
  }
  return cards.length;
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
  // ok=false when nothing was generated for any processed household, so the
  // client can show a real error instead of a misleading success.
  const generated=results.reduce((s,r)=>s+(r.count??0),0);
  const anyError=results.some(r=>r.error);
  return new Response(JSON.stringify({ok:generated>0,generated,results}),{status:anyError&&generated===0?502:200,headers:cors});
});
