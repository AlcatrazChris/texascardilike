import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { newGame, startHand, playBots, playBotsAsync, act, view, observeGame,borrowChips,voteRunout,expireRunout } from '../lib/poker.mjs';
import { hybridDecider } from '../lib/deepseek.mjs';
import {encodeState,decodeState} from '../lib/state-codec.mjs';

function key() {
  const secret=process.env.SESSION_SECRET;
  if(!secret || secret.length<32) throw new Error('服务端尚未配置 SESSION_SECRET（至少 32 个字符）');
  return createHash('sha256').update(secret).digest();
}
export function seal(game) {
  const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',key(),iv);
  const body=Buffer.concat([cipher.update(encodeState({game,expires:Date.now()+7*86400000})),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64url');
}
export function unseal(token) {
  try {
    if(typeof token!=='string' || token.length>750000) throw new Error();
    const data=Buffer.from(token,'base64url'), decipher=createDecipheriv('aes-256-gcm',key(),data.subarray(0,12));
    decipher.setAuthTag(data.subarray(12,28));
    const payload=decodeState(Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]));
    if(payload.expires<Date.now()) throw new Error();
    return payload.game;
  } catch { throw new Error('牌局已过期或凭证无效，请创建新牌局'); }
}
function prepareGame(body,onFrame) {
  let game;
  const frames=[];
  const observe=(g,event)=>{const snapshot=view(g,0,{historyLimit:event.type==='settle'?1:0,includeLogs:false});if(event.type!=='settle')delete snapshot.history;delete snapshot.log;delete snapshot.handLog;const frame={event,game:structuredClone(snapshot)};if(onFrame)onFrame(frame);else frames.push(frame);};
  if(body.command==='start') {
    game=newGame(body.config,observe);
  } else {
    game=unseal(body.token);
    observeGame(game,observe);
    if(body.command==='action') { act(game,0,body.action,body.amount); }
    else if(body.command==='loan'){borrowChips(game,0,body.amount);}
    else if(body.command==='vote'){voteRunout(game,0,body.runs);}
    else if(body.command==='poll'){expireRunout(game);}
    else if(body.command==='next') { startHand(game); }
    else if(body.command!=='resume') throw new Error('未知请求');
  }
  return {game,frames};
}
export function processGame(body) {
  const {game,frames}=prepareGame(body);if(body.command!=='resume')playBots(game);
  return {game:view(game),token:seal(game),frames};
}
export async function processGameAsync(body,options,onFrame) {
  const {game,frames}=prepareGame(body,onFrame);if(body.command!=='resume')await playBotsAsync(game,hybridDecider(options));
  return {game:view(game),token:seal(game),frames};
}
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST') return res.status(405).json({error:'请使用 POST 请求'});
  try {
    const origin=req.headers.origin;
    if(origin && new URL(origin).host!==req.headers.host) return res.status(403).json({error:'不允许跨站请求'});
    const body=typeof req.body==='string'?JSON.parse(req.body):req.body;
    if(!body || JSON.stringify(body).length>800000) return res.status(400).json({error:'请求无效'});
    if(req.headers.accept?.includes('application/x-ndjson')){
      res.setHeader('Content-Type','application/x-ndjson; charset=utf-8');res.setHeader('Cache-Control','no-store, no-transform');
      const data=await processGameAsync(body,undefined,frame=>res.write(JSON.stringify({type:'frame',frame})+'\n'));
      return res.end(JSON.stringify({type:'result',...data})+'\n');
    }
    return res.status(200).json(await processGameAsync(body));
  } catch(error) {
    if(res.headersSent)return res.end(JSON.stringify({type:'error',error:error.message||'请求失败'})+'\n');
    res.setHeader('Content-Type','application/json; charset=utf-8');return res.status(400).json({error:error.message||'请求失败'});
  }
}
