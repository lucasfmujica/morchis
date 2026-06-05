import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

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

interface Profile{id:string;nickname:string|null;display_name:string|null;}
interface Goal{name:string;target_amount:number;current_amount:number;}
interface Budget{amount:number;categories:{name:string}|null;}
interface InsightCard{title:string;body:string;severity:string;kind:string;}
interface PushSub{endpoint:string;p256dh:string;auth_key:string;profile_id:string;}
interface TxRow{category_id:string;categories:{name:string}|null;profile_id:string;scope:string;amount:number;}
function fmt(n:number):string{return '$'+Math.round(n/1000)+'k';}

// Pull the first JSON array out of the model's reply, tolerating code fences or
// stray prose around it (the model is asked for bare JSON but sometimes adds a
// sentence). Returns only well-formed cards.
function parseCards(raw:string):InsightCard[]{
  let s=raw.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/i,'').trim();
  const a=s.indexOf('['), b=s.lastIndexOf(']');
  if(a!==-1&&b>a)s=s.slice(a,b+1);
  let arr:unknown;
  try{arr=JSON.parse(s);}catch(e){console.error('Parse error',e,raw);return[];}
  if(!Array.isArray(arr))return[];
  return (arr as InsightCard[])
    .filter(c=>c&&typeof c.title==='string'&&c.title.trim()&&typeof c.body==='string'&&c.body.trim())
    .slice(0,4);
}

async function getSpendingData(admin:SupabaseClient,hid:string){
  const now=new Date();
  const m0=new Date(now.getFullYear(),now.getMonth(),1).toISOString().slice(0,10);
  const m1=new Date(now.getFullYear(),now.getMonth()+1,1).toISOString().slice(0,10);
  const m3=new Date(now.getFullYear(),now.getMonth()-3,1).toISOString().slice(0,10);
  const [cr,hr,ir]=await Promise.all([
    admin.from('transactions').select('category_id,categories(name),profile_id,scope,amount').eq('household_id',hid).eq('type','expense').gte('occurred_on',m0).lt('occurred_on',m1),
    admin.from('transactions').select('category_id,profile_id,scope,amount').eq('household_id',hid).eq('type','expense').gte('occurred_on',m3).lt('occurred_on',m0),
    admin.from('transactions').select('amount').eq('household_id',hid).eq('type','income').gte('occurred_on',m0),
  ]);
  const curr=(cr.data??[]) as TxRow[];
  const hist=(hr.data??[]) as {category_id:string;profile_id:string;scope:string;amount:number}[];
  const cmap:Record<string,{name:string;pid:string;scope:string;cur:number}>={};
  for(const t of curr){const k=`${t.category_id}_${t.profile_id}_${t.scope}`;if(!cmap[k])cmap[k]={name:t.categories?.name??'Sin categoría',pid:t.profile_id,scope:t.scope,cur:0};cmap[k].cur+=t.amount;}
  const hmap:Record<string,number>={};
  for(const t of hist){const k=`${t.category_id}_${t.profile_id}_${t.scope}`;hmap[k]=(hmap[k]??0)+t.amount;}
  const cats=Object.entries(cmap).map(([k,v])=>({name:v.name,pid:v.pid,scope:v.scope,cur:v.cur,avg3m:Math.round((hmap[k]??0)/3),pct:hmap[k]?Math.round((v.cur-hmap[k]/3)/(hmap[k]/3)*100):null})).sort((a,b)=>Math.abs(b.pct??0)-Math.abs(a.pct??0));
  return{cats,expense:curr.reduce((s,t)=>s+t.amount,0),income:((ir.data??[]) as {amount:number}[]).reduce((s,t)=>s+t.amount,0)};
}

function buildPrompt(sp:Awaited<ReturnType<typeof getSpendingData>>,pm:Record<string,string>,goals:Goal[],budgets:Budget[],mode:string):string{
  const now=new Date();
  const dim=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
  const d=now.getDate();
  const lines=[`Mes: ${now.toLocaleString('es-AR',{month:'long',year:'numeric'})} (día ${d}/${dim}, ${Math.round(d/dim*100)}% transcurrido)`,`Ingresos: ${fmt(sp.income)} | Gastos: ${fmt(sp.expense)} | Balance: ${fmt(sp.income-sp.expense)}`,'','Categorías:'];
  for(const c of sp.cats.slice(0,mode==='lite'?3:6))lines.push(`- ${c.name} (${pm[c.pid]??'Hogar'},${c.scope}): ${fmt(c.cur)} vs avg ${fmt(c.avg3m)} → ${c.pct!==null?(c.pct>0?'+':'')+c.pct+'%':'nuevo'}`);
  if(goals.length&&mode==='full'){lines.push('','Metas:');for(const g of goals.slice(0,3))lines.push(`- ${g.name}: ${Math.round(g.current_amount/g.target_amount*100)}% (${fmt(g.current_amount)}/${fmt(g.target_amount)})`);}
  if(budgets.length&&mode==='full'){lines.push('','Presupuestos:');for(const b of budgets.slice(0,3)){const nm=b.categories?.name??'';const spent=sp.cats.find(c=>c.name===nm)?.cur??0;lines.push(`- ${nm}: ${Math.round(spent/b.amount*100)}% (${fmt(spent)}/${fmt(b.amount)})`);} }
  lines.push('',`Generá ${mode==='lite'?'2':'2-4'} insights. pct>25% → warning. Logros metas → positive. Resto → info.`);
  return lines.join('\n');
}

async function processHousehold(admin:SupabaseClient,hid:string,mode:string,apiKey:string,vPub:string,vPriv:string):Promise<number>{
  const[sp,pr,gr,br]=await Promise.all([getSpendingData(admin,hid),admin.from('profiles').select('id,nickname,display_name').eq('household_id',hid),admin.from('goals').select('name,target_amount,current_amount').eq('household_id',hid).eq('archived',false),admin.from('budgets').select('amount,categories(name)').eq('household_id',hid).eq('active',true)]);
  const profiles=(pr.data??[]) as Profile[];
  const goals=(gr.data??[]) as Goal[];
  const budgets=(br.data??[]) as Budget[];
  if(sp.income===0&&sp.expense===0&&sp.cats.length===0){console.log('No data',hid);return 0;}
  const pm:Record<string,string>={};
  for(const p of profiles)pm[p.id]=p.nickname??p.display_name??'Usuario';
  const anthropic=new Anthropic({apiKey});
  const resp=await anthropic.messages.create({
    model:'claude-sonnet-4-6',
    max_tokens:800,
    system:[{type:'text',text:'Sos un asistente financiero para un hogar argentino. Analizás datos y generás insights breves en español rioplatense. Respondés SOLO con array JSON sin markdown. Cada item: {"title":string(≤6 palabras),"body":string(1 oración ≤20 palabras),"severity":"info"|"positive"|"warning","kind":"spending"|"goal"|"budget"|"summary"}',cache_control:{type:'ephemeral'}}],
    messages:[{role:'user',content:buildPrompt(sp,pm,goals,budgets,mode)}],
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
