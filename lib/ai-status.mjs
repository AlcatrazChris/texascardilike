import {createHash,randomUUID} from 'node:crypto';
import {redisConnection} from './redis-config.mjs';
const counts={},recent=[],pending=new Map();
const EVENTS=new Set(['request','success','failure','skip','cache']);
function sharedKeys(env,now=Date.now()){
  if(!env.DEEPSEEK_API_KEY?.trim()||!redisConnection(env))return null;
  const day=new Date(now).toISOString().slice(0,10),id=createHash('sha256').update(env.DEEPSEEK_API_KEY).digest('hex').slice(0,16),stage=env.VERCEL_ENV==='preview'?'preview':env.VERCEL?'production':'local';
  const root=`river:ai:status:v2:${id}:${stage}:${day}`;return {root,day,counts:root+':counts',recent:root+':recent'};
}
export function recordAI(event,reason,env=process.env,extra={}){
  if(!EVENTS.has(event))return;
  counts[event]=(counts[event]||0)+1;
  const item={time:new Date().toISOString(),event,reason:String(reason).slice(0,80)};
  if(typeof extra.model==='string')item.model=extra.model.slice(0,80);
  if(Number.isSafeInteger(extra.hand))item.hand=extra.hand;
  if(['preflop','flop','turn','river'].includes(extra.street))item.street=extra.street;
  if(Number.isFinite(extra.durationMs))item.durationMs=Math.max(0,Math.round(extra.durationMs));
  recent.push(item);if(recent.length>20)recent.shift();
  const keys=sharedKeys(env);
  if(keys){if(!pending.has(keys.root)){if(pending.size>=8)pending.delete(pending.keys().next().value);pending.set(keys.root,{keys,batches:[],counts:{},recent:[]});}const p=pending.get(keys.root);p.counts[event]=(p.counts[event]||0)+1;p.recent.push(item);p.recent=p.recent.slice(-20);}
  if(env.DEEPSEEK_LOG!=='0'&&['request','success','failure'].includes(event))console.info('[river.ai]',JSON.stringify(item));
}
export function aiStatus(env=process.env){
  const configured=!!env.DEEPSEEK_API_KEY?.trim(),distributed=!!redisConnection(env),policy=['balanced','complex','always','off'].includes(env.DEEPSEEK_POLICY)?env.DEEPSEEK_POLICY:'balanced';
  return {configured,policy,model:env.DEEPSEEK_MODEL||'deepseek-flash',ready:configured&&(!env.VERCEL||distributed)&&policy!=='off',blocker:!configured?'missing_key':env.VERCEL&&!distributed?'missing_distributed_guard':policy==='off'?'disabled':null,scope:'当前服务实例，重启后清零',telemetry:{storage:'instance',available:true},counts:{...counts},recent:recent.map(x=>({...x}))};
}
async function redis(env,args,{fetchImpl=fetch,pipeline=false}={}){
  const c=redisConnection(env),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),700);
  try{const r=await fetchImpl(c.url.replace(/\/$/,'')+(pipeline?'/pipeline':''),{method:'POST',headers:{Authorization:`Bearer ${c.token}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:controller.signal});const data=await r.json();if(!r.ok||data.error||pipeline&&(!Array.isArray(data)||data.some(x=>x.error)))throw Error('Telemetry unavailable');return pipeline?data.map(x=>x.result):data.result;}finally{clearTimeout(timer);}
}
const FLUSH=`
if not redis.call('SET',KEYS[3],'1','NX','EX',172800) then return 0 end
local counts=cjson.decode(ARGV[1]);for key,value in pairs(counts) do redis.call('HINCRBY',KEYS[1],key,value) end
local items=cjson.decode(ARGV[2]);if #items>0 then redis.call('LPUSH',KEYS[2],unpack(items)) end
redis.call('LTRIM',KEYS[2],0,19);redis.call('EXPIRE',KEYS[1],172800);redis.call('EXPIRE',KEYS[2],172800)
return 1`;
export async function flushAIStatus(env=process.env,options={}){
  const keys=sharedKeys(env);if(!keys)return;
  const groups=[...pending.values()].filter(p=>p.keys.root.startsWith(keys.root.slice(0,-10))).slice(-2);
  await Promise.all(groups.map(async p=>{
    if(Object.keys(p.counts).length){p.batches.push({id:randomUUID(),counts:p.counts,recent:p.recent});p.counts={};p.recent=[];}
    const batches=p.batches.splice(0,4);
    await Promise.all(batches.map(async b=>{try{await redis(env,['EVAL',FLUSH,3,p.keys.counts,p.keys.recent,p.keys.root+':batch:'+b.id,JSON.stringify(b.counts),JSON.stringify(b.recent.map(x=>JSON.stringify(x)))],options);}catch{p.batches.push(b);p.batches=p.batches.slice(-4);}}));
  }));
}
export async function readAIStatus(env=process.env,options={}){
  const base=aiStatus(env),keys=sharedKeys(env,options.now?.()??Date.now());if(!keys)return base;
  try{
    const [raw,items]=await redis(env,[['HGETALL',keys.counts],['LRANGE',keys.recent,0,19]],{...options,pipeline:true});
    const fields=Array.isArray(raw)?Object.fromEntries(Array.from({length:raw.length/2},(_,i)=>[raw[i*2],raw[i*2+1]])):raw||{},totals={};for(const [k,v] of Object.entries(fields))if(EVENTS.has(k)&&Number.isFinite(Number(v)))totals[k]=Number(v);
    const rows=(items||[]).map(x=>JSON.parse(x)).filter(x=>EVENTS.has(x.event)).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
    return {...base,scope:`Redis 共享统计 · UTC ${keys.day} · 跨对局与状态页函数实例`,telemetry:{storage:'redis',available:true,period:keys.day},counts:totals,recent:rows};
  }catch{return {...base,scope:'共享统计暂时不可用；以下仅为当前状态页实例，不能据此判断是否调用模型',telemetry:{storage:'redis',available:false,error:'telemetry_unavailable'}};}
}
