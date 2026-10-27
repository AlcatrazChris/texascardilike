import {createHash,randomBytes,randomInt,randomUUID} from 'node:crypto';
import {config,newGame,startHand,observeGame,legal,act,playBotsAsync,view,borrowChips,voteRunout,expireRunout} from './poker.mjs';
import {hybridDecider} from './deepseek.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
const cleanName=value=>String(value||'玩家').replace(/[\u0000-\u001f]/g,'').trim().slice(0,12)||'玩家';
const validLevel=value=>['easy','normal','hard'].includes(value);
const mutations=['start','action','next','bots','leave','ready','options','loan','vote','remove'];
const clientProof=body=>/^[a-f0-9]{64}$/.test(body.clientKey||'')?digest(body.clientKey):null;
const memberSecret=(body,code)=>clientProof(body)?digest(`river:seat:${code}:${body.clientKey}`):randomBytes(32).toString('hex');
const nameKey=name=>cleanName(name).normalize('NFKC').toLowerCase();
export function roomService(store,{now=Date.now,decider=()=>hybridDecider()}={}){
  const members=room=>room.members.filter(m=>!m.left);
  const isReady=(room,m)=>m.ready===true&&m.readyHand===(room.game?.hand||0);
  const authenticate=(room,secret)=>{if(typeof secret!=='string'||secret.length!==64)throw new Error('房间身份无效，请重新加入');const m=members(room).find(m=>m.auth===digest(secret));if(!m)throw new Error('房间身份无效或已退出');return m;};
  function capture(room){return(g,event)=>{const {deck,handLog,log,history,roundReport,...state}=g;const snapshot=structuredClone({...state,log:[],history:event.type==='settle'?history.slice(0,1):[],roundReport:event.type==='settle'?roundReport:null});room.events.push({id:++room.eventSeq,event,game:snapshot});room.events=room.events.slice(-100);};}
  function syncCompleted(room){
    if(room.game?.street==='complete'&&room.completedHand!==room.game.hand){room.completedHand=room.game.hand;for(const m of members(room)){m.ready=false;m.readyHand=null;}room.status=room.game.finished?'finished':'between';room.turnUntil=0;room.turnKey='';}
  }
  async function drive(room,choose){
    const g=room.game;if(!g)return;
    if(g.street!=='complete'&&g.street!=='runout-vote'&&!g.finished)await playBotsAsync(g,choose);
    syncCompleted(room);
    if(g.street==='runout-vote'){
      if(!g.runoutVote.roomTimed){g.runoutVote.deadline=now()+20000;g.runoutVote.roomTimed=true;}
      room.turnUntil=0;
    }else if(g.street==='complete'||g.finished){room.turnUntil=0;room.turnKey='';}
    else{const key=`${g.hand}:${g.street}:${g.turn}`;if(room.turnKey!==key||!room.turnUntil)room.turnUntil=now()+45000;room.turnKey=key;}
  }
  function response(room,member,afterEvent=0,compact=false,knownVersion){
    const cursor=Number.isSafeInteger(afterEvent)&&afterEvent>=0?afterEvent:0,reset=room.events.length>0&&cursor<room.events[0].id-1;
    const personal=g=>{const v=view(g,member.seat);if(member.joinedHand){v.history=v.history.filter(h=>h.hand>member.joinedHand);if(v.roundReport?.hand<=member.joinedHand)v.roundReport=null;}return v;};
    const unchanged=compact&&cursor===room.eventSeq&&knownVersion===room.actionVersion;
    return {unchanged,room:{code:room.code,status:room.status,config:room.config,hand:room.game?.hand||0,host:member.id===room.hostId,mySeat:member.seat,version:room.actionVersion,eventSeq:room.eventSeq,turnUntil:room.turnUntil,serverTime:now(),fillAI:room.fillAI!==false,members:members(room).map(m=>({id:m.id,name:m.name,seat:m.seat,host:m.id===room.hostId,online:now()-m.lastSeen<15000,removable:now()-m.lastSeen>=30000,ready:isReady(room,m)})),botLevels:room.botLevels},game:!unchanged&&room.game?personal(room.game):null,frames:unchanged||reset?[]:room.events.filter(e=>e.id>Math.max(cursor,member.joinEvent||0)).map(f=>({id:f.id,event:f.event,game:personal(f.game)})),reset};
  }
  function requireReady(room){
    const required=members(room).filter(m=>!room.game||room.config.mode!=='tournament'||room.game.players[m.seat].stack>0);
    if(required.some(m=>!isReady(room,m)))throw new Error('请等待所有在座玩家准备');
    if(room.fillAI===false&&required.length<2)throw new Error('至少两位玩家，或开启 AI 补位');
  }
  function setSeats(room){
    for(const p of room.game.players){const human=members(room).find(m=>m.seat===p.id);p.human=!!human;p.sittingOut=!human&&room.fillAI===false;p.difficulty=room.botLevels[p.id];if(human)p.name=human.name;else p.name=`AI ${p.id+1}`;}
  }
  async function create(body){
    const settings=config(body.config);
    for(let tries=0;tries<8;tries++){
      const code=String(randomInt(100000,1000000)),secret=memberSecret(body,code),host={id:randomUUID(),auth:digest(secret),clientAuth:clientProof(body),name:cleanName(body.name),seat:0,lastSeen:now(),left:false,ready:false,readyHand:null};
      const room={code,version:1,actionVersion:0,hostId:host.id,status:'waiting',config:settings,members:[host],fillAI:true,botLevels:Array(settings.seats).fill(settings.aiDifficulty),events:[],eventSeq:0,requests:[],created:now(),turnUntil:0};
      if(await store.create(room))return {...response(room,host),secret};
    }throw new Error('暂时无法创建房间，请重试');
  }
  return async function execute(body){
    if(body.command==='create')return create(body);
    const choose=decider();if(!/^\d{6}$/.test(String(body.code)))throw new Error('请输入 6 位数字房间号');
    let joinSecret=body.command==='join'?memberSecret(body,body.code):null;
    for(let attempt=0;attempt<5;attempt++){
      const room=await store.get(body.code);if(!room||room.status==='closed')throw new Error('房间不存在或已关闭');
      const previous=room.version;let member,changed=false;
      syncCompleted(room);
      if(room.game&&room.turnUntil&&!room.turnKey)room.turnKey=`${room.game.hand}:${room.game.street}:${room.game.turn}`;
      if(['join','reconnect'].includes(body.command)){
        const bySecret=typeof body.secret==='string'&&body.secret.length===64?members(room).find(m=>m.auth===digest(body.secret)):null;
        const proof=clientProof(body),byClient=proof?members(room).find(m=>m.clientAuth===proof):null;
        member=bySecret||byClient;
        if(member){
          // Recovery proves ownership by seat secret or a 256-bit browser key, never by nickname.
          joinSecret=bySecret?body.secret:memberSecret(body,room.code);member.auth=digest(joinSecret);if(proof)member.clientAuth=proof;
          member.lastSeen=now();if(['waiting','between'].includes(room.status)){member.ready=false;member.readyHand=null;}
          room.version++;if(await store.compareAndSet(room,previous)){const result=response(room,member,room.eventSeq);return {...result,frames:[],reset:true,reconnected:true,secret:joinSecret};}continue;
        }
        if(body.command==='reconnect')throw new Error('房间身份无效，请使用原浏览器返回房间');
        if(!['waiting','between'].includes(room.status))throw new Error('牌局已开始，请在本手结束后加入');
        if(members(room).some(m=>nameKey(m.name)===nameKey(body.name)))throw new Error('该昵称已在房间中，请返回原房间恢复座位；新玩家请使用不同昵称');
        const occupied=new Set(members(room).map(m=>m.seat)),seat=Array.from({length:room.config.seats},(_,i)=>i).find(i=>!occupied.has(i));
        if(seat===undefined)throw new Error('房间已满');
        member={id:randomUUID(),auth:digest(joinSecret),clientAuth:clientProof(body),name:cleanName(body.name),seat,lastSeen:now(),left:false,ready:false,readyHand:null,joinEvent:room.eventSeq,joinedHand:room.game?.hand||0};room.members.push(member);
        if(room.game){const p=room.game.players[seat];p.name=member.name;p.human=true;p.sittingOut=false;p.stack=room.config.buyIn;p.initial=room.config.buyIn;p.borrowed=0;p.rebuy=0;p.out=false;p.hole=[];p.award=0;p.bet=0;p.total=0;p.action='新入座';p.folded=true;p.stats={hands:0,wins:0,invested:0,raises:0,folds:0};for(const h of room.game.history)if(h.privateHands)delete h.privateHands[seat];room.actionVersion++;}
        changed=true;
      }else member=authenticate(room,body.secret);
      if(now()-member.lastSeen>5000){member.lastSeen=now();changed=true;}
      const host=member.id===room.hostId,duplicate=body.requestId&&room.requests.some(r=>r.id===body.requestId&&r.member===member.id);
      if(!duplicate&&mutations.includes(body.command)){
        if(typeof body.requestId!=='string'||body.requestId.length<8||body.requestId.length>80)throw new Error('操作标识无效，请刷新重试');
        if(body.command==='ready'){
          if(!['waiting','between'].includes(room.status))throw new Error('只能在发牌前准备');
          const p=room.game?.players[member.seat];if(p&&p.stack===0)throw new Error(room.config.mode==='tournament'?'你已淘汰':'请先领取筹码再准备');
          if(typeof body.ready!=='boolean')throw new Error('请明确选择准备或取消准备');
          if(body.hand!==undefined&&body.hand!==(room.game?.hand||0))throw new Error('牌局已更新，请重新准备');
          member.ready=body.ready;member.readyHand=body.ready?(room.game?.hand||0):null;
        }else if(body.command==='remove'){
          if(!host||!['waiting','between'].includes(room.status))throw new Error('只有房主可在发牌前移除离线席位');
          const target=members(room).find(m=>m.id===body.memberId&&m.id!==member.id);if(!target||now()-target.lastSeen<30000)throw new Error('该玩家未离线满 30 秒，不能移除');
          target.left=true;target.ready=false;target.readyHand=null;if(room.game){room.game.players[target.seat].human=false;room.actionVersion++;}
        }else if(body.command==='options'){
          if(!host||!['waiting','between'].includes(room.status))throw new Error('只有房主可在发牌前设置补位');
          if(typeof body.fillAI!=='boolean')throw new Error('补位选项无效');room.fillAI=body.fillAI;
        }else if(body.command==='bots'){
          if(!host||!['waiting','between'].includes(room.status))throw new Error('只有房主可在发牌前设置 AI 难度');
          if(!Number.isInteger(body.seat)||body.seat<0||body.seat>=room.config.seats||!validLevel(body.difficulty))throw new Error('AI 设置无效');
          if(members(room).some(m=>m.seat===body.seat))throw new Error('该座位已有人类玩家');room.botLevels[body.seat]=body.difficulty;
        }else if(body.command==='start'){
          if(!host)throw new Error('只有房主可以开始牌局');if(room.status!=='waiting')throw new Error('牌局已开始');requireReady(room);
          const participants=Array.from({length:room.config.seats},(_,seat)=>{const m=members(room).find(m=>m.seat===seat);return m?{name:m.name,human:true}:{name:`AI ${seat+1}`,human:false,sittingOut:room.fillAI===false,difficulty:room.botLevels[seat]};});
          room.game=newGame(room.config,capture(room),participants);room.status='playing';for(const m of members(room)){m.ready=false;m.readyHand=null;}await drive(room,choose);room.actionVersion++;
        }else if(body.command==='leave'){
          member.left=true;
          if(room.game){const g=room.game,p=g.players[member.seat];p.human=false;p.difficulty=room.config.aiDifficulty;observeGame(g,capture(room));
            if(g.street==='runout-vote'&&!g.runoutVote.resolved&&g.runoutVote.eligible.includes(p.id)&&!(p.id in g.runoutVote.votes))voteRunout(g,p.id,1,now());
            await drive(room,choose);room.actionVersion++;
          }
          const remaining=members(room);if(host)room.hostId=remaining[0]?.id||'';if(!remaining.length)room.status='closed';
        }else{
          if(!room.game)throw new Error('牌局尚未开始');
          const g=room.game;observeGame(g,capture(room));
          if(['action','next'].includes(body.command)&&body.version!==room.actionVersion)throw new Error('牌局已更新，正在同步，请稍后重试');
          if(body.command==='loan'){borrowChips(g,member.seat,body.amount);member.ready=false;}
          else if(body.command==='vote')voteRunout(g,member.seat,body.runs,now());
          else if(body.command==='next'){
            if(!host)throw new Error('由房主开始下一手');if(g.finished)throw new Error('比赛已结束，请创建新房间');if(room.status!=='between')throw new Error('本手尚未结束');requireReady(room);setSeats(room);startHand(g);room.status='playing';for(const m of members(room)){m.ready=false;m.readyHand=null;}
          }else{
            if(g.turn!==member.seat||!g.players[member.seat].human)throw new Error('尚未轮到你行动');act(g,member.seat,body.action,body.amount);
          }
          await drive(room,choose);room.actionVersion++;
        }
        room.requests.push({id:body.requestId,member:member.id});room.requests=room.requests.slice(-40);changed=true;
      }else if(!['join','poll',...mutations].includes(body.command))throw new Error('未知房间操作');
      if(body.command==='poll'&&room.game){
        const g=room.game;observeGame(g,capture(room));
        if(expireRunout(g,now())){syncCompleted(room);room.actionVersion++;changed=true;}
      }
      if(!changed)return response(room,member,body.afterEvent,body.command==='poll'&&body.compact===true,body.version);
      room.version++;if(await store.compareAndSet(room,previous)){if(body.command==='leave')return {left:true};return {...response(room,member,body.afterEvent,body.command==='poll'&&body.compact===true,body.version),...(joinSecret?{secret:joinSecret}:{})};}
    }throw new Error('房间正在更新，请稍后重试');
  };
}
