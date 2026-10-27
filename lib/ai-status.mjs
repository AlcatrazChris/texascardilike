import {redisConnection} from './redis-config.mjs';
const counts={},recent=[];
export function recordAI(event,reason,env=process.env,extra={}){
  counts[event]=(counts[event]||0)+1;
  const item={time:new Date().toISOString(),event,reason,...extra};
  recent.push(item);if(recent.length>20)recent.shift();
  // Never log prompts, cards, credentials or provider response bodies.
  if(env.DEEPSEEK_LOG!=='0'&&['request','success','failure'].includes(event))console.info('[river.ai]',JSON.stringify(item));
}
export function aiStatus(env=process.env){
  const configured=!!env.DEEPSEEK_API_KEY?.trim(),distributed=!!redisConnection(env);
  const policy=['balanced','complex','always','off'].includes(env.DEEPSEEK_POLICY)?env.DEEPSEEK_POLICY:'balanced';
  return {configured,policy,model:env.DEEPSEEK_MODEL||'deepseek-flash',ready:configured&&(!env.VERCEL||distributed)&&policy!=='off',blocker:!configured?'missing_key':env.VERCEL&&!distributed?'missing_distributed_guard':policy==='off'?'disabled':null,scope:'当前服务实例，重启后清零；Vercel 多实例统计请查看函数日志',counts:{...counts},recent:recent.map(x=>({...x}))};
}
