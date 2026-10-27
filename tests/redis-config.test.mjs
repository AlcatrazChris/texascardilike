import test from 'node:test';
import assert from 'node:assert/strict';
import {redisConnection} from '../lib/redis-config.mjs';
import {roomStore} from '../lib/room-store.mjs';
import {aiStatus} from '../lib/ai-status.mjs';
test('Vercel Marketplace KV 变量可同时启用房间存储与生产 AI 限流',async()=>{
  const env={VERCEL:'1',DEEPSEEK_API_KEY:'test-key',KV_REST_API_URL:'https://test.invalid',KV_REST_API_TOKEN:'fake'};
  assert.deepEqual(redisConnection(env),{url:env.KV_REST_API_URL,token:'fake'});assert.equal(aiStatus(env).ready,true);assert.ok(roomStore(env).compareAndSet);
  assert.equal(redisConnection({UPSTASH_REDIS_REST_URL:'a',KV_REST_API_TOKEN:'b'}),null);
  assert.deepEqual(redisConnection({...env,UPSTASH_REDIS_REST_URL:'direct',UPSTASH_REDIS_REST_TOKEN:'direct-token'}),{url:'direct',token:'direct-token'});
});
