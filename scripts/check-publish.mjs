import {execFileSync} from 'node:child_process';
import {readFileSync,lstatSync,existsSync} from 'node:fs';
const cwd=process.cwd().replaceAll('\\','/');
const paths=execFileSync('git',['-c',`safe.directory=${cwd}`,'ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const files=[...new Set(paths)].sort(),manifest=[],problems=[];
const realSecrets=[];
if(existsSync('.env.local'))for(const line of readFileSync('.env.local','utf8').split(/\r?\n/)){
  const match=line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);if(!match||!/SECRET|TOKEN|API_KEY/.test(match[1]))continue;
  const value=match[2].replace(/^(['"])(.*)\1$/,'$2');if(value.length>=16&&!/replace|your[-_]|example/i.test(value))realSecrets.push(value);
}
for(const path of files){
  const safeTemplate=/^\.env(?:\.[\w-]+)*\.example$/.test(path);
  if(/(^|\/)(?:node_modules|\.tools|\.vercel|\.git|\.aws|\.codex|\.agents|coverage|\.cache|\.tmp)(\/|$)/.test(path)||/^\.env(?:\.|$)/.test(path)&&!safeTemplate||/\.(?:log|pem|key|p12|pfx)$/i.test(path)){problems.push({path,reason:'private or generated path'});continue;}
  const stat=lstatSync(path);if(stat.isSymbolicLink()||!stat.isFile()||stat.size>250000){problems.push({path,reason:'unexpected file type or size'});continue;}
  const raw=readFileSync(path);if(raw.includes(0)){problems.push({path,reason:'unexpected binary file'});continue;}
  const content=raw.toString('utf8').replaceAll('\r\n','\n');
  if(realSecrets.some(secret=>content.includes(secret))||/(?:gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{24,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(content)){problems.push({path,reason:'possible credential'});continue;}
  manifest.push({path,mode:'100644',type:'blob',content});
}
if(problems.length){console.error(JSON.stringify({problems}));process.exit(1);}
if(process.argv.includes('--manifest')){const arg=process.argv.find(a=>a.startsWith('--batch='));const batch=arg?Number(arg.slice(8)):null;console.log(JSON.stringify(batch===null?manifest:manifest.slice(batch*5,(batch+1)*5)));}
else console.log(JSON.stringify({files:manifest.length,bytes:manifest.reduce((n,f)=>n+Buffer.byteLength(f.content),0),excluded:['.env.local','.tools/','.vercel/','node_modules/','credentials and caches'],status:'clean'},null,2));
