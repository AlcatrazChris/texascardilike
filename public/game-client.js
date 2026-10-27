// Read the network independently of animations: AI computation and playback overlap.
export async function consumeGameResponse(response,{onFrame=async()=>{},onResult=()=>{}}={}){
  if(!response.ok){const data=await response.json();throw new Error(data.error||'服务器暂时不可用');}
  let result,frameCount=0,failed,playback=Promise.resolve();
  const frame=f=>{if(++frameCount>256)throw new Error('牌桌动作数量异常');playback=playback.then(()=>{if(!failed)return onFrame(f);});playback.catch(()=>{});};
  const complete=data=>{if(result||!data.game||typeof data.token!=='string')throw new Error('牌局返回数据无效');result=data;onResult(data);};
  if(!response.headers.get('content-type')?.includes('application/x-ndjson')){
    const data=await response.json();for(const f of data.frames||[])frame(f);complete(data);await playback;return {...result,frameCount};
  }
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
  const line=text=>{if(!text.trim())return;const message=JSON.parse(text);if(message.type==='error')throw new Error(message.error||'牌局连接中断');if(message.type==='frame'){if(result)throw new Error('牌局动作顺序异常');frame(message.frame);}else if(message.type==='result')complete(message);else throw new Error('牌局返回数据无效');};
  try{
    while(true){const {done,value}=await reader.read();buffer+=decoder.decode(value,{stream:!done});if(buffer.length>4500000)throw new Error('牌局返回数据过大');let split;while((split=buffer.indexOf('\n'))>=0){line(buffer.slice(0,split));buffer=buffer.slice(split+1);}if(done)break;}
    if(buffer.trim())line(buffer);if(!result)throw new Error('牌局连接中断，请重试');
  }catch(error){failed=error;await reader.cancel().catch(()=>{});}
  finally{reader.releaseLock();}
  try{await playback;}catch(error){failed??=error;}
  if(failed)throw failed;return {...result,frameCount};
}
