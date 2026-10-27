import {redisConnection} from './redis-config.mjs';
import {packRoom,unpackRoom} from './state-codec.mjs';
const TTL=86400;
export function memoryRoomStore({now=Date.now}={}){
  const rooms=new Map();
  const read=code=>{const item=rooms.get(code);if(!item||item.expiry<now()){rooms.delete(code);return null;}return unpackRoom(item.room);};
  return {async get(code){return read(code);},async create(room){for(const [code,item]of rooms)if(item.expiry<now())rooms.delete(code);if(rooms.has(room.code))return false;if(rooms.size>=200)throw new Error('本地房间已满，请稍后再试');rooms.set(room.code,{room:packRoom(room),version:room.version,expiry:now()+TTL*1000});return true;},async compareAndSet(room,version){const current=rooms.get(room.code);if(!current||current.expiry<now()||current.version!==version)return false;rooms.set(room.code,{room:packRoom(room),version:room.version,expiry:now()+TTL*1000});return true;}};
}
const CAS=`local old=redis.call('GET',KEYS[1]);if not old then return 0 end;local room=cjson.decode(old);if tonumber(room.version)~=tonumber(ARGV[1]) then return 0 end;redis.call('SET',KEYS[1],ARGV[2],'EX',ARGV[3]);return 1`;
export function redisRoomStore(env=process.env,{fetchImpl=fetch}={}){
  const connection=redisConnection(env);
  async function command(args){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),1800);try{const response=await fetchImpl(connection.url,{method:'POST',headers:{Authorization:`Bearer ${connection.token}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:controller.signal});const data=await response.json();if(!response.ok||data.error)throw new Error();return data.result;}catch{throw new Error('房间存储暂时不可用，请稍后重试');}finally{clearTimeout(timer);}}
  const key=code=>'river:rooms:v1:'+code;
  return {async get(code){const raw=await command(['GET',key(code)]);return raw?unpackRoom(raw):null;},async create(room){return await command(['SET',key(room.code),packRoom(room),'NX','EX',TTL])==='OK';},async compareAndSet(room,version){return Number(await command(['EVAL',CAS,1,key(room.code),version,packRoom(room),TTL]))===1;}};
}
const localStore=memoryRoomStore();
export function roomStore(env=process.env){if(redisConnection(env))return redisRoomStore(env);if(env.VERCEL)throw new Error('联机房间尚未配置 Redis，请联系房主完成服务端配置');return localStore;}
