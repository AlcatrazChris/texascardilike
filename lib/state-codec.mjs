import {deflateRawSync,inflateRawSync} from 'node:zlib';
const MAGIC=Buffer.from('RP2\0');
const MAX_STATE=8*1024*1024;
export function encodeState(value){const json=Buffer.from(JSON.stringify(value));if(json.length>MAX_STATE)throw new Error('State too large');return Buffer.concat([MAGIC,deflateRawSync(json,{level:3})]);}
export function decodeState(buffer){
  const json=buffer.subarray(0,MAGIC.length).equals(MAGIC)?inflateRawSync(buffer.subarray(MAGIC.length),{maxOutputLength:MAX_STATE}):buffer;
  if(json.length>MAX_STATE)throw new Error('State too large');return JSON.parse(json.toString('utf8'));
}
// The existing Redis CAS reads this uncompressed version without inflating data.
export function packRoom(room){return JSON.stringify({version:room.version,codec:'deflate-v1',data:encodeState(room).toString('base64')});}
export function unpackRoom(raw){const value=JSON.parse(raw);return value.codec==='deflate-v1'?decodeState(Buffer.from(value.data,'base64')):value;}
