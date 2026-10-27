import {resolve} from 'node:path';
export function loadLocalEnv(directory=process.cwd()){
  for(const file of ['.env.local','.env'])try{process.loadEnvFile(resolve(directory,file));}catch(error){if(error.code!=='ENOENT')throw new Error(`无法读取 ${file}，请检查环境配置格式`);}
}
