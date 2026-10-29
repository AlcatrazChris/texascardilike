import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {recordAI,flushAIStatus,readAIStatus} from '../lib/ai-status.mjs';import {processGameAsync} from '../api/game.js';import {memoryGuard} from '../lib/deepseek.mjs';
process.env.SESSION_SECRET='shared-status-test-secret-at-least-32-characters';
const environment=()=>({VERCEL:'1',VERCEL_ENV:'production',DEEPSEEK_API_KEY:'test-'+randomUUID(),DEEPSEEK_LOG:'0',KV_REST_API_URL:'https://redis.test.invalid',KV_REST_API_TOKEN:'not-real'});
function fakeRedis(){const values=new Map(),lists=new Map(),dedup=new Set();let lose=false;const calls=[];
  const fetchImpl=async(url,init)=>{const c=JSON.parse(init.body);calls.push(c);
    if(url.includes('api.deepseek.com'))return Response.json({choices:[{message:{content:'{"choice":0}'}}]});
    if(url.endsWith('/pipeline'))return Response.json(c.map(cmd=>({result:cmd[0]==='HGETALL'?Object.entries(values.get(cmd[1])||{}).flat():lists.get(cmd[1])||[]})));
    assert.equal(c[0],'EVAL');assert.equal(c[2],3);const [, , ,countKey,listKey,batchKey,rawCounts,rawItems]=c;
    if(dedup.has(batchKey))return Response.json({result:0});dedup.add(batchKey);const counts=values.get(countKey)||{};for(const [k,v]of Object.entries(JSON.parse(rawCounts)))counts[k]=(counts[k]||0)+v;values.set(countKey,counts);lists.set(listKey,[...JSON.parse(rawItems).reverse(),...(lists.get(listKey)||[])].slice(0,20));
    if(lose){lose=false;throw Error('lost acknowledgement');}return Response.json({result:1});
  };return {fetchImpl,calls,loseOnce:()=>lose=true};
}
test('真实对局接口写入共享统计，另一个独立模块实例也能读取成功调用',async()=>{
  const env=environment(),redis=fakeRedis();
  const local=(g,l)=>({action:[l.check?'check':'call'],context:{street:g.street,equity:.6,price:0,opponents:3},candidates:[{action:l.check?'check':'call',amount:0},{action:'fold',amount:0}]});
  const result=await processGameAsync({command:'start',config:{seats:6}},{env,local,guard:memoryGuard(),fetchImpl:redis.fetchImpl});assert.ok(result.token);
  const isolated=await import('../lib/ai-status.mjs?reader='+randomUUID()),status=await isolated.readAIStatus(env,{fetchImpl:redis.fetchImpl});assert.equal(status.telemetry.storage,'redis');assert.equal(status.counts.request,1);assert.equal(status.counts.success,1);assert.ok(status.recent.some(r=>r.event==='success'));assert.ok(!JSON.stringify(status).includes(env.DEEPSEEK_API_KEY));
  const preview=await isolated.readAIStatus({...env,VERCEL_ENV:'preview'},{fetchImpl:redis.fetchImpl});assert.equal(preview.counts.success,undefined);
});
test('共享写入的响应丢失后重试保持幂等，多个事件合并一次写入',async()=>{
  const env=environment(),redis=fakeRedis();recordAI('request','provider',env);recordAI('success','provider',env,{hand:3,street:'flop',durationMs:220});redis.loseOnce();await flushAIStatus(env,{fetchImpl:redis.fetchImpl});await flushAIStatus(env,{fetchImpl:redis.fetchImpl});const s=await readAIStatus(env,{fetchImpl:redis.fetchImpl});assert.equal(s.counts.request,1);assert.equal(s.counts.success,1);assert.equal(s.recent.length,2);assert.equal(redis.calls.filter(c=>c[0]==='EVAL').length,2);
});
test('状态记录剔除私有牌、提示词、密钥，历史列表有界；存储故障明确报告',async()=>{
  const env=environment(),redis=fakeRedis();for(let n=0;n<30;n++)recordAI('skip','simple_position',env,{hole:['14s','14h'],deck:['private'],prompt:'never-expose',apiKey:env.DEEPSEEK_API_KEY});await flushAIStatus(env,{fetchImpl:redis.fetchImpl});const s=await readAIStatus(env,{fetchImpl:redis.fetchImpl});assert.equal(s.recent.length,20);assert.equal(s.counts.skip,30);assert.ok(!JSON.stringify(s).includes('never-expose'));assert.ok(s.recent.every(x=>!('hole' in x)&&!('deck' in x)&&!('apiKey'in x)));
  const unavailable=await readAIStatus(env,{fetchImpl:async()=>{throw Error('offline');}});assert.equal(unavailable.ready,true);assert.equal(unavailable.telemetry.available,false);assert.match(unavailable.scope,/不能据此判断/);
});
