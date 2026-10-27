import {roomStore} from '../lib/room-store.mjs';
import {roomService} from '../lib/rooms.mjs';
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');if(req.method!=='POST')return res.status(405).json({error:'请使用 POST 请求'});
  try{const origin=req.headers.origin;if(origin&&new URL(origin).host!==req.headers.host)return res.status(403).json({error:'不允许跨站请求'});const body=typeof req.body==='string'?JSON.parse(req.body):req.body;if(!body||JSON.stringify(body).length>8000)throw new Error('房间请求无效');return res.status(200).json(await roomService(roomStore())(body));}
  catch(error){return res.status(400).json({error:error.message||'房间操作失败'});}
}
