import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomClient} from '../public/rooms-client.js';
import {roomService} from '../lib/rooms.mjs';
import {memoryRoomStore} from '../lib/room-store.mjs';
test('浏览器响应丢失再输入房号、刷新恢复和跨房间返回均复用原身份',async()=>{
  const originalFetch=globalThis.fetch,originalStorage=globalThis.localStorage,values=new Map();globalThis.localStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};
  const execute=roomService(memoryRoomStore(),{decider:()=>async(_g,l)=>[l.check?'check':'call']}),host=await execute({command:'create',config:{seats:3},name:'Host'});let drop=true;
  globalThis.fetch=async(_url,options)=>{const body=JSON.parse(options.body);try{const result=await execute(body);if(body.command==='join'&&drop){drop=false;throw Error('Lost response');}return new Response(JSON.stringify(result));}catch(error){if(error.message==='Lost response')throw error;return new Response(JSON.stringify({error:error.message}),{status:400});}};
  const make=()=>{const c=new RoomClient({onState:async()=>{},onError:()=>{},onPending:()=>{}});c.schedule=()=>{};return c;};
  try{
    const first=make();await assert.rejects(()=>first.open('join',{code:host.room.code,name:'Leon'}),/Lost/);const joined=await first.open('join',{code:host.room.code,name:'Leon'});assert.equal(joined.room.members.length,2);const seat=joined.room.mySeat,secret=joined.secret;
    const refreshed=make();const restored=await refreshed.open('join',{code:host.room.code,name:'Leon'});assert.equal(restored.reconnected,true);assert.equal(restored.room.mySeat,seat);assert.equal(restored.secret,secret);assert.equal(restored.room.members.length,2);
    const other=await execute({command:'create',config:{seats:3},name:'Other host'});await refreshed.open('join',{code:other.room.code,name:'Leon'});const again=await refreshed.open('join',{code:host.room.code,name:'Leon'});assert.equal(again.room.mySeat,seat);assert.equal(again.secret,secret);assert.equal(again.room.members.length,2);assert.equal(RoomClient.saved(host.room.code).secret,secret);
    const page=make();await page.restore();assert.equal(page.info.mySeat,seat);first.stop();refreshed.stop();page.stop();
  }finally{globalThis.fetch=originalFetch;if(originalStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=originalStorage;}
});
