import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import handler from './api/game.js';
import roomHandler from './api/room.js';
import aiStatusHandler from './api/ai-status.js';
import {loadLocalEnv} from './lib/local-env.mjs';
loadLocalEnv();
// Development only. Vercel must use a stable secret supplied as an environment variable.
if(!process.env.SESSION_SECRET) { process.env.SESSION_SECRET=randomBytes(32).toString('hex'); console.log('开发模式：使用临时会话密钥，服务重启后需重新开桌。'); }
const root=resolve('public');
const securityHeaders=JSON.parse(await readFile(new URL('./vercel.json',import.meta.url),'utf8')).headers[0].headers;
const server=http.createServer(async(req,res)=>{
  for(const {key,value} of securityHeaders) res.setHeader(key,value);
  if(['/api/game','/api/room','/api/ai-status'].includes(req.url.split('?')[0])) {
    let raw=''; for await(const chunk of req) { raw+=chunk; if(raw.length>800000){res.writeHead(413).end();return;} }
    req.body=raw; res.status=code=>{res.statusCode=code;return res;}; res.json=data=>res.end(JSON.stringify(data)); res.setHeader('Content-Type','application/json; charset=utf-8');
    return (req.url.split('?')[0]==='/api/ai-status'?aiStatusHandler:req.url.split('?')[0]==='/api/room'?roomHandler:handler)(req,res);
  }
  try {
    const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname==='/'?'/index.html':new URL(req.url,'http://localhost').pathname));
    if(!path.startsWith(root+'\\') && !path.startsWith(root+'/')) throw new Error();
    const data=await readFile(path); res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'})[extname(path)]||'application/octet-stream'); res.end(data);
  }catch{res.writeHead(404).end('Not found');}
});
server.listen(Number(process.env.PORT)||3000,process.env.HOST||'0.0.0.0',()=>console.log(`Local: http://localhost:${server.address().port}\n局域网：使用此电脑的局域网 IP 与相同端口访问。`));
