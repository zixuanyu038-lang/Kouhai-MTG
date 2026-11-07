'use strict';
const crypto=require('node:crypto');
const {object,array,text,integer,boolean,enumeration}=require('../endstep-reader/search-schema');
const {validate}=require('../endstep-reader/studio-schema');
const {canonicalName}=require('../endstep-reader/deck-service');
const {inspectBranchStart}=require('../endstep-reader/search-branch');

const cardCount=object({name:text,count:integer});
const phases={UPKEEP:'维持',DRAW:'抓牌',MAIN1:'第一主阶段',MAIN2:'第二主阶段',END_STEP:'结束步骤'};
const colors={W:'Plains',U:'Island',B:'Swamp',R:'Mountain',G:'Forest',C:'Wastes'};
const seats=['对手','己方'];
const playerSchema=object({
  life:integer,handSize:integer,librarySize:integer,deckSize:integer,energyCounters:integer,
  battlefield:array(object({...cardCount.properties,tapped:boolean,summoningSick:boolean,counters:array(cardCount)})),
  hand:array(cardCount),graveyard:array(cardCount),exile:array(cardCount),libraryTop:array(text),
  manaPool:object(Object.fromEntries(Object.keys(colors).map(color=>[color,integer]))),
  landsPlayed:integer,drawn:integer,spellsCast:array(text),
  suggestedCards:array(text),basicLands:array(enumeration(...Object.values(colors)))
});
const descriptionSchema=object({
  turn:integer,phase:enumeration('',...Object.keys(phases)),activePlayer:enumeration('','0','1'),
  own:playerSchema,opponent:playerSchema,
  stack:array(object({name:text,controller:enumeration('0','1'),modeText:text,
    targets:array(object({kind:enumeration('player','card','spell'),name:text,player:enumeration('0','1')}))})),
  issues:array(object({
    kind:enumeration('ambiguous_scene','opponent_priority','unsupported_state'),
    quote:text,reason:text
  }))
});
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const total=cards=>cards.reduce((sum,card)=>sum+card.count,0);
const plainZones=['hand','graveyard','exile'];
const zones=['battlefield',...plainZones];

function prompt(description,preferences){
  const deckSources=Object.fromEntries([['own','1'],['opponent','0']].map(([side,id])=>{
    const {mode,deck}=preferences[id];
    return [side,mode==='upload'?{mode,parsed:true,mainCount:total(deck.main),sideboardCount:total(deck.sideboard)}:{mode}];
  }));
  return `把这段玩家描述转成万智牌双人起点。编号 1 是己方，0 是对手，起点要求己方有优先权。只提取明确描述的场面事实，牌名用完整英文。不要编造公共区、已知手牌、库顶、法术力、堆叠或行动历史。
deckSources 是服务端已确认的牌表设置。upload 且 parsed=true 表示上传牌表已经解析，完整牌表由后端保管并应用。你的工作只负责提取局面。hand 只写明确已知的牌，handSize 填已知和未知合计。例如已知两张、另有两张未知时，hand 写两张，handSize 填 4。未知牌和牌库由后端补齐，模型看不到完整牌表、需要填补未知牌或没有注明其牌名都不属于 issues。
turn、life、handSize、librarySize、deckSize、landsPlayed、drawn 不明确填 -1，phase/activePlayer 不明确填空字符串，未声明的列表为空，法术力为 0。energyCounters 是该玩家现有能量数量，零或未说明填 0，能量为 0 不属于 issues。libraryTop 和 stack 都由顶向下。spellsCast 是本回合已经施放的牌名，重复施放重复写，当前堆叠的法术由程序另计。标记横置、召唤失调和明确给出的永久物指示物。堆叠只表示待结算法术，targets 的 player 是玩家目标、卡牌的控制者/持有者或堆叠法术的控制者。modeText 填英文模式文本。
issues 只记录妨碍恢复的事实，每项包含 kind、description 中逐字复制的 quote 和简短 reason。无法消解的起点歧义用 ambiguous_scene，明确由对手持有优先权用 opponent_priority，战斗中、异能堆叠、衍生物、附着、面朝下、控制权变更、特殊持续效果、过去状态触发等确实存在且无法忠实恢复的事实用 unsupported_state。正常的占位、默认值、空区域、未知手牌和推演假设都不是错误。无阻塞时 issues 必须是空数组。
仅当对应牌表模式是 generated，按描述颜色、牌张或套牌风格在 suggestedCards 推荐 4 至 10 个不同的真实非地牌名，在 basicLands 给相配的基本地，用于合成练习牌表。不知道风格时可以少给或留空。\n`+
    JSON.stringify({description,deckSources});
}

function nameOf(value){
  const name=canonicalName(value.split(' // ')[0]);
  if(!name||name.length>180||/[;|\r\n]/.test(value))throw Error('牌名无效：'+value.slice(0,180));
  return name;
}
function amount(value,min,max,label){
  if(!Number.isInteger(value)||value<min||value>max)throw Error(label+'应为 '+min+' 至 '+max+' 的整数。');
  return value;
}
function defaulted(value,fallback,min,max,label,assumptions){
  if(value!==-1)return amount(value,min,max,label);
  assumptions.push(label+'按 '+fallback+' 处理。');
  return fallback;
}
function tally(cards){
  const counts=new Map();
  for(const name of cards)counts.set(name,(counts.get(name)||0)+1);
  return counts;
}
function practiceDeck({known,size,meta,suggestions,basics}){
  const counts=tally(known),names=[...new Set(suggestions)].filter(name=>meta.get(name)?.found&&!meta.get(name).land);
  const inferred=Object.entries(colors).filter(([color])=>[...counts.keys(),...names].some(name=>(meta.get(name)?.manaCost||'').includes(color))).map(([,land])=>land);
  const lands=[...new Set(basics.length?basics:inferred.length?inferred:['Plains'])];
  let remaining=size-known.length;
  const landBudget=Math.min(remaining,Math.max(0,Math.ceil(size*.4)-known.filter(name=>meta.get(name)?.land).length));
  for(let copy=0;copy<4&&remaining>landBudget;copy++)for(const name of names){
    if(remaining<=landBudget)break;
    if((counts.get(name)||0)>=4)continue;
    counts.set(name,(counts.get(name)||0)+1);remaining--;
  }
  for(let i=0;i<remaining;i++){const name=lands[i%lands.length];counts.set(name,(counts.get(name)||0)+1);}
  const main=[...counts].map(([name,count])=>({name,count}));
  return {main,sideboard:[],verified:true,sha256:digest(main),archetype:'假设练习牌表',
    basis:'以已知牌为约束，用模型建议的可识别牌与基本地补满主牌；用于此局面推演。'};
}

async function prepareDescription({description,preferences,ask,forge,deckService,signal,progress}){
  progress('scene','正在提取双方区域、牌数和优先权…');
  const draft=await ask(prompt(description,preferences),descriptionSchema);
  validate(draft,descriptionSchema);
  if(draft.issues.length)throw Error(draft.issues.map(({quote,reason})=>quote&&description.includes(quote)?
    reason+'（原文「'+quote+'」）':'模型报告了阻塞项，但没有引用相符的场面原文，请重试整理。').join('；'));
  const assumptions=['未描述的公开区域按空处理，未描述的场上状态及本回合行动历史按零值处理。'];
  const turn=defaulted(draft.turn,1,1,999,'回合编号',assumptions),phase=draft.phase||'MAIN1',active=draft.activePlayer||'1';
  if(!draft.phase)assumptions.push('阶段按第一主阶段处理。');
  if(!draft.activePlayer)assumptions.push('当前回合按己方回合处理。');
  let nextId=100;
  const card=(name,id,zone,extra={})=>({id:nextId++,name:nameOf(name),ownerId:id,controllerId:id,zone,types:[],subtypes:[],supertypes:[],keywords:[],tapped:false,faceDown:false,counters:{},...extra});
  const rawPlayers=[draft.opponent,draft.own],known=[],knownTop={},historyCounters=[],castNames=[],libraryHints=[];
  const players=rawPlayers.map((data,index)=>{
    const id=String(index),label=seats[index],player={id,name:label,life:defaulted(data.life,20,1,999,label+'生命',assumptions),
      energyCounters:amount(data.energyCounters,0,1000,label+'能量'),manaPool:data.manaPool,commandZone:[]};
    for(const color of Object.keys(colors))amount(data.manaPool[color],0,100,label+'法术力 '+color);
    const expand=(entries,zone,attributes=()=>({}))=>{
      for(const entry of entries)amount(entry.count,1,100,label+'单项牌张数');
      if(total(entries)>150)throw Error(label+'的'+zone+'包含过多牌。');
      return entries.flatMap(entry=>Array.from({length:entry.count},()=>card(entry.name,id,zone,attributes(entry))));
    };
    for(const zone of plainZones)player[zone]=expand(data[zone],{hand:'Hand',graveyard:'Graveyard',exile:'Exile'}[zone]);
    player.battlefield=expand(data.battlefield,'Battlefield',entry=>({
      tapped:entry.tapped,hasSummoningSickness:entry.summoningSick,counters:Object.fromEntries(entry.counters.map(c=>{
        if(!/^(?:\+1\/\+1|-1\/-1|[a-z][a-z0-9_]{0,29})$/i.test(c.name))throw Error('指示物名称不受支持：'+c.name);
        return [c.name,amount(c.count,1,100,'指示物数量')];
      }))
    }));
    if(data.libraryTop.length>150)throw Error(label+'的已知库顶包含过多牌。');
    const top=data.libraryTop.map(name=>card(name,id,'Library'));
    known.push(...zones.flatMap(zone=>player[zone]),...top);
    knownTop[id]=top.map(c=>c.id);
    player.handSize=defaulted(data.handSize,index===1?player.hand.length:Math.max(3,player.hand.length),player.hand.length,50,label+'手牌总数',assumptions);
    while(player.hand.length<player.handSize)player.hand.push(card('Hidden card',id,'Hand',{faceDown:true}));
    if(data.librarySize!==-1)amount(data.librarySize,top.length,150,label+'牌库张数');
    if(data.deckSize!==-1)amount(data.deckSize,1,150,label+'主牌总数');
    libraryHints.push({length:data.librarySize,top:top.length});
    historyCounters.push({landsPlayedThisTurn:data.landsPlayed===-1?0:amount(data.landsPlayed,0,20,label+'本回合下地次数'),
      numDrawnThisTurn:data.drawn===-1?0:amount(data.drawn,0,150,label+'本回合抓牌数'),spellsCastThisTurn:0});
    castNames.push(data.spellsCast.map(nameOf));
    return player;
  });
  if(draft.stack.length>12||known.length>300||castNames.some(names=>names.length>30))throw Error('起点包含过多牌或堆叠项目。');
  const stack=draft.stack.map(item=>({controllerId:item.controller,sourceCard:card(item.name,item.controller,'Stack'),isAbility:false,isTrigger:false,abilityDescription:item.modeText,targets:[]}));
  for(const [index,item] of draft.stack.entries()){
    stack[index].targets=item.targets.map(target=>{
      if(target.kind==='player')return {id:-1-Number(target.player),zone:'Player',ownerId:target.player};
      const candidates=target.kind==='spell'?stack.slice(index+1).map(entry=>entry.sourceCard):['battlefield','graveyard','exile'].flatMap(zone=>players[Number(target.player)][zone]);
      const matches=candidates.filter(c=>c.controllerId===target.player&&c.name===nameOf(target.name));
      if(matches.length!==1)throw Error('堆叠目标必须能唯一定位：'+target.name+'。');
      return matches[0];
    });
  }
  known.push(...stack.map(item=>item.sourceCard));
  const suggestions=rawPlayers.map(data=>data.suggestedCards.slice(0,10).map(nameOf));
  let referenced=await Promise.all(players.map(async player=>{
    const preference=preferences[player.id];
    if(preference.mode==='generated')return null;
    if(preference.mode==='upload')return preference.deck;
    progress('decks','正在检索'+player.name+'的参考牌表…');
    return deckService.resolve({source:{known,initialDeckSizes:{[player.id]:Math.max(0,rawPlayers[Number(player.id)].deckSize)},game:1},playerId:player.id,mode:preference.mode,ask,signal});
  }));
  progress('restore','正在用 Forge 核对牌名、补齐未知牌并恢复起点…');
  const requiredNames=[...known.map(c=>c.name),...castNames.flat(),...referenced.filter(Boolean).flatMap(deck=>deck.main.concat(deck.sideboard).map(c=>nameOf(c.name)))];
  const {cards}=await forge.request({command:'catalog',names:[...new Set(requiredNames.concat(suggestions.flat(),Object.values(colors)))]},{signal});
  const metadata=new Map(cards.map(c=>[c.name,c]));
  for(const name of requiredNames)if(!metadata.get(name)?.found)throw Error('Forge 无法识别牌名：'+name+'。请核对完整英文牌名。若是新牌，可在「Forge 引擎」检查正式版。');
  const exactName=name=>metadata.get(name)?.canonicalName||name;
  for(const c of cards)if(c.found)metadata.set(exactName(c.name),c);
  for(const c of known)c.name=exactName(c.name);
  const normalizeList=list=>{
    const counts=new Map();
    for(const card of list){
      const name=exactName(nameOf(card.name));
      counts.set(name,(counts.get(name)||0)+card.count);
    }
    return [...counts].map(([name,count])=>({name,count}));
  };
  referenced=referenced.map(deck=>deck&&({...deck,main:normalizeList(deck.main),sideboard:normalizeList(deck.sideboard)}));
  const spellHistory=castNames.flatMap((names,index)=>names.map(name=>({playerId:String(index),cardName:exactName(name),turn})));
  spellHistory.push(...stack.map(item=>({playerId:item.controllerId,cardName:item.sourceCard.name,cardId:item.sourceCard.id,turn})));
  for(const entry of spellHistory)historyCounters[Number(entry.playerId)].spellsCastThisTurn++;
  const initialDeckSizes={};
  const decks=players.map((player,index)=>{
    const {id,name,handSize}=player,data=rawPlayers[index],reference=referenced[index],hint=libraryHints[index];
    const inPlay=known.filter(c=>c.ownerId===id),hidden=handSize-player.hand.filter(c=>!c.faceDown).length;
    const outside=inPlay.length-hint.top+hidden,minimum=outside+hint.top;
    const exactSize=hint.length===-1?null:outside+hint.length;
    const size=data.deckSize!==-1?data.deckSize:reference?total(reference.main):exactSize??Math.max(60,minimum);
    if(size<minimum||size>150||(exactSize!==null&&size!==exactSize)||reference&&size!==total(reference.main))throw Error(name+'的主牌、各区域、手牌和牌库张数对不上。请核对描述或牌表。');
    if(data.deckSize===-1&&!reference&&exactSize===null)assumptions.push(name+'主牌按 '+size+' 张补齐。');
    player.librarySize=size-outside;
    initialDeckSizes[id]=size;
    const deck=reference||practiceDeck({known:inPlay.map(c=>c.name),size,meta:metadata,suggestions:suggestions[index].map(exactName),basics:data.basicLands});
    return {...deck,fixedForGame:true,deckInformationScope:'description setup'};
  });
  assumptions.push('未知手牌从各自固定牌表抽样；已知库顶保持指定顺序，其余牌库按固定种子排列。');
  const header={format:'endstep-replay',formatVersion:1,recordedAt:new Date().toISOString(),seat:1,players:players.map(p=>({seat:Number(p.id),name:p.name})),games:1,complete:false};
  const chapter={k:'chapter',t:0,game:1,edge:'start'};
  const sha256=digest({description,draft,decks:decks.map(deck=>deck.sha256)});
  const baseline={gameId:'description-'+sha256.slice(0,12),status:'ACTIVE',turnNumber:turn,phase,step:phase,activePlayerId:active,priorityPlayerId:'1',stack,players,
    matchScore:{winsBySeat:[0,0],player0Wins:0,player1Wins:0,gamesPlayed:0,gamesPerMatch:1,isMatchOver:false}};
  const source={sha256,descriptionSetup:assumptions,header,baseline,game:1,anchor:{line:3,selectedLine:3,t:0,game:1,turn},known,knownTop,initialDeckSizes,
    historyCounters,firstPriorityId:Number(stack[0]?.controllerId||active),spellHistory,cardHistory:{},faces:{},rows:[{line:1,row:header},{line:2,row:chapter,raw:JSON.stringify(chapter)}]};
  const start=await inspectBranchStart({source,profiles:{byGame:{1:decks},catalog:metadata},forge,signal});
  const world=start.worlds[0];
  for(const player of players){
    const ids=world.libraries.find(l=>l.playerId===player.id).cards;
    if(knownTop[player.id].some((id,index)=>Number(start.inspection.rootLibraries[Number(player.id)]?.[index]?.id)!==id||ids[index]?.id!==id))throw Error(player.name+'的已知库顶没有通过 Forge 恢复校验。');
  }
  const preview={turn,phase:phases[phase],activePlayer:seats[Number(active)],assumptions,
    stack:stack.map(s=>({name:s.sourceCard.name,player:seats[Number(s.controllerId)],targets:s.targets.map(c=>c.zone==='Player'?seats[Number(c.ownerId)]:c.name)})),
    players:players.map((p,i)=>({id:p.id,name:p.name,life:p.life,energyCounters:p.energyCounters,manaPool:p.manaPool,librarySize:p.librarySize,
      libraryTop:knownTop[p.id].map(id=>known.find(c=>c.id===id).name),hand:world.hiddenHands[i].cards.map((name,j)=>({name,assumed:p.hand[j].faceDown})),
      ...Object.fromEntries(['battlefield','graveyard','exile'].map(zone=>[zone,p[zone].map(c=>({name:c.name,tapped:c.tapped,sick:c.hasSummoningSickness,counters:c.counters}))])),
      deck:{title:decks[i].archetype,basis:decks[i].basis,main:decks[i].main,sideboard:decks[i].sideboard}}))};
  return {preview,start:{...start,source,worlds:[world]}};
}

module.exports={prepareDescription};
