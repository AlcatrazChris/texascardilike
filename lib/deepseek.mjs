import { createHash, randomUUID } from 'node:crypto';
import { localDecision } from './ai.mjs';
import {aiStatus,recordAI,flushAIStatus} from './ai-status.mjs';
import {redisConnection} from './redis-config.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const clamp=(value,fallback,min,max)=>Number.isFinite(Number(value))?Math.max(min,Math.min(max,Number(value))):fallback;
async function jsonRequest(url,init,timeout,fetchImpl){
  const controller=new AbortController();let timer;
  try{return await Promise.race([(async()=>{const response=await fetchImpl(url,{...init,signal:controller.signal});const text=await response.text();if(text.length>524288)throw new Error('Response too large');return {ok:response.ok,status:response.status,headers:response.headers,body:JSON.parse(text)};})(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('AI deadline exceeded'));},timeout);})]);}
  finally{clearTimeout(timer);}
}
export function memoryGuard({limit=30,concurrency=3,now=Date.now}={}){
  const cache=new Map(),leases=new Map();let minute=-1,count=0,blockedUntil=0;
  return {
    async get(key){const value=cache.get(key);if(value&&value.expiry>now())return value.choice;cache.delete(key);return null;},
    async set(key,choice){if(cache.size>=128)cache.delete(cache.keys().next().value);cache.set(key,{choice,expiry:now()+30000});},
    async acquire(){const time=now(),window=Math.floor(time/60000);if(window!==minute){minute=window;count=0;}for(const [id,expiry]of leases)if(expiry<time)leases.delete(id);if(time<blockedUntil||count>=limit||leases.size>=concurrency)return null;const id=randomUUID();count++;leases.set(id,time+6000);return id;},
    async release(id){leases.delete(id);},
    async fail(seconds){blockedUntil=Math.max(blockedUntil,now()+seconds*1000);}
  };
}
const ACQUIRE=`
if redis.call('EXISTS',KEYS[1])==1 then return 0 end
redis.call('ZREMRANGEBYSCORE',KEYS[3],'-inf',ARGV[1])
if redis.call('ZCARD',KEYS[3])>=tonumber(ARGV[3]) then return 0 end
local count=tonumber(redis.call('GET',KEYS[2]) or '0')
if count>=tonumber(ARGV[2]) then return 0 end
redis.call('INCR',KEYS[2]);redis.call('EXPIRE',KEYS[2],120)
redis.call('ZADD',KEYS[3],tonumber(ARGV[1])+6000,ARGV[4]);redis.call('EXPIRE',KEYS[3],30)
return 1`;
export function redisGuard(env,{fetchImpl=fetch,now=Date.now}={}){
  const connection=redisConnection(env);
  const namespace=`river:ai:v1:${hash(env.DEEPSEEK_API_KEY).slice(0,16)}`;
  const command=async args=>{const r=await jsonRequest(connection.url,{method:'POST',headers:{Authorization:`Bearer ${connection.token}`,'Content-Type':'application/json'},body:JSON.stringify(args)},500,fetchImpl);if(!r.ok||r.body.error)throw new Error('AI guard unavailable');return r.body.result;};
  const circuit=namespace+':circuit',leases=namespace+':leases';
  return {
    async lookup(key){const time=now(),id=randomUUID();const script="local cached=redis.call('GET',KEYS[4]);if cached then return {2,cached} end\n"+ACQUIRE;const result=await command(['EVAL',script,4,circuit,namespace+':minute:'+Math.floor(time/60000),leases,namespace+':cache:'+key,time,clamp(env.DEEPSEEK_RPM,30,1,300),clamp(env.DEEPSEEK_CONCURRENCY,3,1,20),id]);return Array.isArray(result)?{choice:Number(result[1])}:Number(result)===1?{lease:id}:{};},
    async get(key){const result=await command(['GET',namespace+':cache:'+key]);return result===null?null:Number(result);},
    async set(key,choice){await command(['SET',namespace+':cache:'+key,String(choice),'EX',30]);},
    async acquire(){const time=now(),id=randomUUID();const result=await command(['EVAL',ACQUIRE,3,circuit,namespace+':minute:'+Math.floor(time/60000),leases,time,clamp(env.DEEPSEEK_RPM,30,1,300),clamp(env.DEEPSEEK_CONCURRENCY,3,1,20),id]);return Number(result)===1?id:null;},
    async release(id){await command(['ZREM',leases,id]);},
    async fail(seconds){await command(['SET',circuit,'1','EX',seconds]);}
  };
}
const localGuards=new Map();
function configuredGuard(env,options){
  if(redisConnection(env))return redisGuard(env,options);
  // Process memory is not a fleet-wide rate limiter. Production fails closed without Redis.
  if(env.VERCEL)return null;
  const key=hash(env.DEEPSEEK_API_KEY);if(!localGuards.has(key)){if(localGuards.size>=4)localGuards.delete(localGuards.keys().next().value);localGuards.set(key,memoryGuard({limit:clamp(env.DEEPSEEK_RPM,30,1,300),concurrency:clamp(env.DEEPSEEK_CONCURRENCY,3,1,20)}));}return localGuards.get(key);
}
export function complexDecision(c){return c.street!=='preflop'&&c.equity>.04&&c.equity<.96&&(Math.abs(c.equity-c.price)<.12||c.call>=c.bigBlind*3||c.legal?.canRaise&&c.pot>=c.bigBlind*8);}
export function hybridDecider({env=process.env,fetchImpl=fetch,guard:providedGuard,local=localDecision,shouldAsk}={}){
  let attempted=false;
  const guard=env.DEEPSEEK_API_KEY?(providedGuard||configuredGuard(env,{fetchImpl})):null;
  const decide=async(g,l)=>{
    const fallback=local(g,l),c=fallback.context,candidates=fallback.candidates;
    if(g.aiBudget?.hand!==g.hand)g.aiBudget={hand:g.hand,calls:0};
    const status=aiStatus(env),skip=reason=>{recordAI('skip',reason,env);return fallback.action;};
    if(!status.configured)return skip('missing_key');
    if(status.policy==='off')return skip('disabled');
    if(!guard)return skip('missing_distributed_guard');
    if(attempted)return skip('request_budget');
    if(candidates.length<2)return skip('no_choice');
    const eligible=shouldAsk?shouldAsk(c):status.policy==='always'||status.policy==='complex'&&complexDecision(c)||status.policy==='balanced'&&(g.aiBudget.calls===0||complexDecision(c)||c.street==='preflop'&&c.call>=c.bigBlind*3);
    if(!eligible)return skip('simple_position');
    if(g.aiBudget.calls>=clamp(env.DEEPSEEK_MAX_PER_HAND,4,1,12))return skip('hand_budget');
    attempted=true;
    const model=env.DEEPSEEK_MODEL||'deepseek-flash',key=hash(JSON.stringify({model,c:{...c,equity:undefined},candidates}));
    let lease=null,cacheChoice=null,circuitSeconds=0;
    const deadline=Date.now()+clamp(env.DEEPSEEK_TIMEOUT_MS,1800,100,2500);
    try{
      const lookup=guard.lookup?await guard.lookup(key):null,cached=lookup?lookup.choice:await guard.get(key);
      if(Number.isInteger(cached)&&candidates[cached]){recordAI('cache','hit',env);return [candidates[cached].action,candidates[cached].amount];}
      lease=lookup?lookup.lease:await guard.acquire();if(!lease)return skip('rate_concurrency_or_circuit');
      if(Date.now()>=deadline)return skip('decision_deadline');
      g.aiBudget.calls++;
      recordAI('request','provider',env,{model,hand:g.hand,street:c.street});
      const response=await jsonRequest('https://api.deepseek.com/chat/completions',{
        method:'POST',headers:{Authorization:`Bearer ${env.DEEPSEEK_API_KEY}`,'Content-Type':'application/json'},
        body:JSON.stringify({model,thinking:{type:'disabled'},max_tokens:48,response_format:{type:'json_object'},messages:[
          {role:'system',content:'Act like a thoughtful Texas Holdem player. Choose ONE supplied candidate. Equity is a noisy simulation of estimated ranges, never knowledge of future cards. Use actual made-hand strength, opponents, effective stacks, pot odds and repeated street raises. Previous investments are sunk costs: do not keep escalating weak pairs or draws after a re-raise. Prefer sensible value sizing and allow slowplay checks. Bluff occasionally only when the supplied strategy intent supports it; a bluff can lose and must not become automatic all-in escalation. Real full houses and other value hands may play big. Do not infer hidden cards or future deals. Return only JSON {"choice":0}, a zero-based index in candidates.'},
          {role:'user',content:JSON.stringify({situation:c,candidates})}
        ]})
      },Math.max(1,deadline-Date.now()),fetchImpl);
      if(!response.ok){recordAI('failure','http_'+response.status,env);const retryHeader=response.headers?.get?.('retry-after'),retry=retryHeader?Number(retryHeader):NaN;circuitSeconds=response.status===429?clamp(retry,60,10,300):response.status>=500?20:120;return fallback.action;}
      const content=response.body.choices?.[0]?.message?.content,selected=JSON.parse(content||'{}').choice;
      if(!Number.isInteger(selected)||!candidates[selected]){recordAI('failure','invalid_choice',env);circuitSeconds=20;return fallback.action;}
      recordAI('success','provider',env,{model,hand:g.hand,street:c.street,durationMs:clamp(env.DEEPSEEK_TIMEOUT_MS,1800,100,2500)-(deadline-Date.now())});
      cacheChoice=selected;
      return [candidates[selected].action,candidates[selected].amount];
    }catch{recordAI('failure',lease?'timeout_network_or_invalid_json':'guard_unavailable',env);circuitSeconds=20;return fallback.action;}
    finally{await Promise.allSettled([...(cacheChoice!==null?[guard.set(key,cacheChoice)]:[]),...(circuitSeconds?[guard.fail(circuitSeconds)]:[]),...(lease?[guard.release(lease)]:[])]);}
  };
  decide.flush=()=>flushAIStatus(env,{fetchImpl});return decide;
}
