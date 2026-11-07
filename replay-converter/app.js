'use strict';
const $=id=>document.getElementById(id),sides=['own','opponent'];
const state={seat:null,nodes:[],busy:false,job:null,sceneId:null,entries:[],results:new Map(),selected:'start',initialTurn:null,draftChanged:false};
const fromDescription=()=>$('from-description').checked;
const node=()=>state.nodes.find(item=>item.sourceLine===Number($('node').value));
async function api(url,{method='GET',body,headers={}}={}){
  const response=await fetch(url,{method,body,headers:{'X-Endstep-Request':'1',...headers}});
  const data=await response.json();
  if(!response.ok)throw Error(data.error||'请求失败。');
  return data;
}
const post=(url,data)=>api(url,{method:'POST',body:JSON.stringify(data),headers:{'Content-Type':'application/json'}});
function status(message,error=false,id='status'){
  $(id).textContent=message;
  $(id).dataset.error=String(error);
}
function controls(){
  const apiMode=$('provider').value==='api';
  const described=fromDescription();
  for(const id of ['description-inputs','prepare-scene','scene-deck-hint'])$(id).hidden=!described;
  for(const id of ['replay-inputs','check-decks','replay-extra','deck-hint'])$(id).hidden=described;
  $('scene-preview').hidden=!described||!state.sceneId;
  $('scene-status').hidden=!described||!$('scene-status').textContent;
  $('decks').hidden=described;
  $('provider-label').textContent=apiMode?'兼容 API':'Codex';
  $('api-settings').hidden=!apiMode;
  $('codex-hint').hidden=apiMode;
  let missing=false;
  for(const side of sides){
    const mode=$(side+'-mode'),file=$(side+'-file');
    mode.querySelector('[value=web]').disabled=apiMode;
    mode.querySelector('[value=generated]').hidden=!described;
    if(apiMode&&mode.value==='web')mode.value=described?'generated':'local';
    file.hidden=mode.value!=='upload';
    missing||=!file.hidden&&!file.files.length;
    mode.disabled=file.disabled=state.busy;
  }
  $('file').disabled=$('provider').disabled=state.busy;
  $('from-replay').disabled=$('from-description').disabled=$('description').disabled=state.busy;
  $('node').disabled=state.busy||!state.nodes.some(n=>!n.reason);
  $('check-decks').disabled=state.busy||state.seat===null||missing;
  $('prepare-scene').disabled=state.busy||missing||!$('description').value.trim();
  const timelineMode=described&&state.entries.length>0;
  const selected=state.results.get(state.selected);
  const ready=described?Boolean(state.sceneId)&&(!timelineMode||state.selected==='start'||selected?.status==='verified'&&!selected.state.complete):!$('check-decks').disabled&&node()&&!node().reason;
  $('generate').disabled=state.busy||!ready||!$('focus').value.trim();
  $('generate').textContent=timelineMode?'从所选节点推演':'开始推演';
  $('play-step').textContent=described?'04':'03';
  $('timeline').hidden=!described;
  $('branch-start-note').hidden=!timelineMode;
  $('branch-start-note').textContent=state.selected==='start'?'当前分支从起始局面开始。':'当前分支从选中节点执行后的局面开始。';
  $('check-timeline').disabled=$('export-timeline').disabled=state.busy||!state.sceneId||!state.entries.length;
  for(const id of ['add-node','add-turn','delete-node','node-description','turn-fill'])$(id).disabled=state.busy;
  $('add-node').disabled=$('add-turn').disabled=state.busy||state.entries.length>=80;
  for(const button of $('timeline-list').querySelectorAll('button'))button.disabled=state.busy;
  $('cancel').hidden=!state.job;
}
function provider(){
  return {kind:$('provider').value,baseUrl:$('base-url').value.trim(),model:$('model').value.trim(),key:$('key').value};
}
function clearResult(){
  for(const id of ['download','verified','assumptions','endstep'])$(id).hidden=true;
}
function selectNode(){
  const selected=node();
  $('board').textContent=selected?selected.players.map(p=>(String(p.id)===state.seat?'己方':'对手')+' '+p.life+' 血 · 战场 '+(p.battlefield.map(c=>c.name).join('、')||'空')).join(' / ')+(selected.stack.length?' · 堆叠 '+selected.stack.join('、'):''):'';
  controls();
}
function showDecks(decks){
  $('decks').replaceChildren(...decks.map(deck=>{
    const details=document.createElement('details'),summary=document.createElement('summary'),body=document.createElement('p');
    summary.textContent=(String(deck.id)===state.seat?'己方':'对手')+' · '+deck.title;
    body.textContent=deck.basis||'牌表已核对。';
    details.append(summary,body);
    if(deck.url&&/^https:\/\//.test(deck.url)){
      const link=document.createElement('a');link.href=deck.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='查看参考牌表 ↗';details.append(link);
    }
    const cards=document.createElement('p');cards.textContent=deck.main.map(c=>c.count+' '+c.name).join(' · ')+(deck.sideboard.length?' / 备牌 '+deck.sideboard.map(c=>c.count+' '+c.name).join(' · '):'');details.append(cards);
    return details;
  }));
}
function sceneLine(parent,label,value){
  const row=document.createElement('p'),title=document.createElement('b');
  title.textContent=label+' ';
  row.append(title,value||'空');
  parent.append(row);
}
function showScene(preview){
  state.initialTurn=preview.turn;
  const target=$('scene-preview'),intro=document.createElement('div'),grid=document.createElement('div');
  grid.className='split scene-players';
  sceneLine(intro,'推演起点',`第 ${preview.turn} 回合 · ${preview.activePlayer}${preview.phase} · 己方有优先权`);
  sceneLine(intro,'堆叠（顶 → 底）',preview.stack.map(s=>s.player+'的 '+s.name+(s.targets.length?' → '+s.targets.join('、'):'')).join('；'));
  for(const player of [...preview.players].reverse()){
    const block=document.createElement('div'),title=document.createElement('h3');
    title.textContent=player.name+' · '+player.life+' 血';
    block.append(title);
    sceneLine(block,'战场',player.battlefield.map(card=>card.name+(card.tapped?'（横置）':'')+(card.sick?'（召唤失调）':'')+
      Object.entries(card.counters).map(([kind,count])=>'（'+count+' 个 '+kind+' 指示物）').join('')).join('、'));
    sceneLine(block,'手牌',player.hand.map(card=>card.name+(card.assumed?'（补齐）':'')).join('、'));
    sceneLine(block,'坟场',player.graveyard.map(card=>card.name).join('、'));
    sceneLine(block,'放逐区',player.exile.map(card=>card.name).join('、'));
    sceneLine(block,'牌库',player.librarySize+' 张'+(player.libraryTop.length?' · 库顶 '+player.libraryTop.join(' → '):''));
    sceneLine(block,'法术力池',Object.entries(player.manaPool).filter(([,count])=>count).map(([color,count])=>count+' '+color).join('、'));
    if(player.energyCounters!==undefined)sceneLine(block,'能量',String(player.energyCounters));
    const deck=document.createElement('details'),summary=document.createElement('summary');
    summary.textContent=player.deck.title;
    deck.append(summary);
    sceneLine(deck,'来源',player.deck.basis);
    sceneLine(deck,'主牌',player.deck.main.map(c=>c.count+' '+c.name).join('、'));
    if(player.deck.sideboard.length)sceneLine(deck,'备牌',player.deck.sideboard.map(c=>c.count+' '+c.name).join('、'));
    block.append(deck);grid.append(block);
  }
  const notes=document.createElement('ul');
  for(const message of preview.assumptions){const li=document.createElement('li');li.textContent=message;notes.append(li);}
  target.replaceChildren(intro,grid,notes);
  renderTimeline();
}
function renderTimeline(){
  let turn=state.initialTurn;
  const all=[{id:'start',kind:'start',description:''},...state.entries];
  $('timeline-list').replaceChildren(...all.map((entry,index)=>{
    const li=document.createElement('li'),button=document.createElement('button'),title=document.createElement('span'),badge=document.createElement('small');
    const result=state.results.get(entry.id);
    li.dataset.kind=entry.kind;
    if(entry.kind==='turn'&&turn!==null)turn++;
    const first=entry.id==='start';
    const label=first?'起始局面':entry.kind==='turn'?(turn===null?'新回合':'第 '+turn+' 回合'):'节点 '+index;
    title.className='node-title';
    title.textContent=label+(entry.description?' · '+entry.description.trim().slice(0,55):'');
    badge.textContent=first?(state.sceneId?'已恢复':'待整理'):result?.status==='verified'?(result.fills?'已校验 · Forge 补演':'已校验'):
      result?.status==='error'?'有错误':result?.status==='blocked'?'等待前序修正':'待校验';
    button.type='button';button.disabled=state.busy;button.setAttribute('aria-pressed',String(entry.id===state.selected));
    button.append(title,badge);li.append(button);
    button.onclick=()=>{state.selected=entry.id;renderTimeline();controls();};
    if(result?.error){const issue=document.createElement('p');issue.className='node-error';issue.textContent=result.error;li.append(issue);}
    return li;
  }));
  const entry=state.entries.find(e=>e.id===state.selected),result=state.results.get(state.selected);
  $('timeline-editor').hidden=!entry;
  if(entry){
    const description=$('node-description');
    $('node-description-label').textContent=entry.kind==='turn'?'回合衔接描述':'节点描述';
    description.placeholder=entry.kind==='turn'?'写下进到新回合前的动作，以及新回合要核对的结果。':'例如：己方起动 Wasteland，目标是对手的 Hedge Maze。';
    if(description.value!==entry.description)description.value=entry.description;
    $('turn-fill-label').hidden=entry.kind!=='turn';
    $('turn-fill').checked=entry.auto;
  }
  const preview=$('node-preview');
  preview.replaceChildren();
  preview.hidden=result?.status!=='verified';
  if(!preview.hidden){
    const view=result.state;
    sceneLine(preview,'执行后的局面',`第 ${view.turn} 回合 · ${view.phase} · ${view.priority==='已结束'?'已结束':view.priority+'有优先权'}`);
    if(result.summary)sceneLine(preview,'理解',result.summary);
    sceneLine(preview,'堆叠',view.stack.join('、'));
    const grid=document.createElement('div');grid.className='split scene-players';
    for(const player of [...view.players].reverse()){
      const block=document.createElement('div');
      sceneLine(block,player.name,`${player.life} 血 · 手牌 ${player.handSize} 张 · 牌库 ${player.librarySize} 张`);
      for(const [zone,label] of [['battlefield','战场'],['hand','手牌'],['graveyard','坟场'],['exile','放逐区']])sceneLine(block,label,player[zone].join('、'));
      grid.append(block);
    }
    preview.append(grid);
    const note=document.createElement('p');note.className='note';note.textContent='未公开的手牌和后续抽牌沿用起始局面的固定假设。';preview.append(note);
  }
}
let draftTimer,draftSave=Promise.resolve();
function saveDraft(delay=350){
  state.draftChanged=true;
  clearTimeout(draftTimer);
  draftTimer=setTimeout(()=>{
    const body=JSON.stringify({description:$('description').value,entries:state.entries,sceneId:state.sceneId});
    draftSave=draftSave.catch(()=>{}).then(()=>api('/api/timeline-draft',{method:'PUT',headers:{'Content-Type':'application/json'},body}));
    draftSave.catch(error=>status('草稿未保存。'+error.message,true,'timeline-status'));
  },delay);
}
function invalidateEntries(index){
  for(const entry of state.entries.slice(index))state.results.delete(entry.id);
  clearResult();
  status('',false,'timeline-status');
  renderTimeline();controls();
}
function addEntry(kind){
  const index=state.entries.findIndex(e=>e.id===state.selected);
  let position=index+1;
  if(kind==='turn')while(position<state.entries.length&&state.entries[position].kind==='node')position++;
  const entry={id:crypto.randomUUID(),kind,description:'',auto:false};
  state.entries.splice(position,0,entry);
  state.selected=entry.id;
  invalidateEntries(position);
  saveDraft(0);
  $('node-description').focus();
}
function editSelected(change){
  const index=state.entries.findIndex(e=>e.id===state.selected);
  if(index<0)return;
  Object.assign(state.entries[index],change);
  invalidateEntries(index);
  saveDraft();
}
function invalidateScene(){
  state.sceneId=null;
  state.initialTurn=null;
  state.results.clear();
  $('scene-status').textContent='';
  invalidateEntries(0);
  saveDraft();
}
async function submit(type,operation){
  if(state.busy)return;
  state.busy=true;controls();clearResult();status('正在准备…');
  const sceneMode=fromDescription(),progressId=type==='scene'?'scene-status':type==='timeline'?'timeline-status':'status';
  if(type==='timeline')status('正在准备…',false,progressId);
  if(type==='scene'){
    state.sceneId=null;state.initialTurn=null;state.results.clear();
    status('正在准备…',false,progressId);renderTimeline();controls();
  }
  try{
    const decks={};
    const seat=sceneMode?'1':state.seat;
    if(!sceneMode||type==='scene')for(const side of sides){
      const id=side==='own'?seat:String(1-Number(seat)),mode=$(side+'-mode').value;
      const file=$(side+'-file').files[0];
      if(mode==='upload'&&(!file||file.size>128*1024))throw Error('请选择 128 KB 以内的英文纯文本牌表。');
      decks[id]={mode,text:mode==='upload'?await file.text():undefined};
    }
    let current=await post('/api/jobs',{type,provider:provider(),decks,description:type==='scene'?$('description').value:undefined,
      sceneId:sceneMode&&['convert','timeline'].includes(type)?state.sceneId:undefined,sourceLine:sceneMode?undefined:node()?.sourceLine,focus:$('focus').value,
      operation,entries:type==='timeline'?state.entries:undefined,nodeId:type==='timeline'?state.selected:undefined,
      context:sceneMode?'':$('context').value,opponentHand:sceneMode?'':$('hand').value});
    state.job=current.id;controls();
    while(current.status==='running'){
      status(current.message,false,progressId);
      await new Promise(resolve=>setTimeout(resolve,700));
      current=await api('/api/jobs/'+state.job);
    }
    if(current.error)throw Error((current.stage?'「'+current.stage+'」\n':'')+current.error);
    status(current.message,false,progressId);
    if(type==='scene'){
      if(current.result?.preview){
        state.sceneId=current.result.sceneId;
        state.results.clear();
        showScene(current.result.preview);
        saveDraft(0);
      }
      status(state.sceneId?'核对上面的局面，写好打法后即可开始推演。':current.message);
    }
    if(current.result?.decks)showDecks(current.result.decks);
    if(current.result?.timeline){
      if(operation!=='branch')state.results.clear();
      for(const item of current.result.timeline)if(operation!=='branch'||!['pending','blocked'].includes(item.status))state.results.set(item.id,item);
      const firstError=current.result.timeline.find(item=>item.status==='error');
      if(firstError)state.selected=firstError.id;
      renderTimeline();
      status(current.message);
    }
    if(current.result?.downloadUrl){
      $('download').href=current.result.downloadUrl;
      $('understood').textContent=current.result.plan.understoodIntent;
      $('execution').replaceChildren(...current.result.plan.proposedLine.map(action=>{
        const item=document.createElement('li');item.textContent=action.description+' · '+action.payment;return item;
      }));
      $('verified').hidden=false;
      $('verified').open=true;
      for(const id of ['download','assumptions','endstep'])$(id).hidden=false;
      const hands=current.result.hiddenHands.map(h=>(h.playerId===seat?'己方':'对手')+'：'+h.cards.join('、'));
      $('assumption-text').replaceChildren(...[current.result.summary,...hands,...current.result.assumptions.map(a=>a.basis)].filter(Boolean).map(message=>{
        const p=document.createElement('p');p.textContent=message;return p;
      }));
    }
  }catch(error){status(error.message,true,progressId);if(type==='scene')status('请按局面提示修正描述，再试一次。',true);if(type==='timeline')status(error.message,true);}
  finally{state.job=null;state.busy=false;controls();}
}
$('file').onchange=async()=>{
  const file=$('file').files[0];
  if(!file)return;
  state.busy=true;state.seat=null;state.nodes=[];$('decks').replaceChildren();clearResult();controls();status('正在读取原局操作…');
  try{
    if(file.size>32*1024*1024)throw Error('请选择 32 MB 以内的回放。');
    const result=await api('/api/replay',{method:'POST',body:file,headers:{'X-Replay-Name':encodeURIComponent(file.name)}});
    state.seat=result.seat;state.nodes=result.nodes;
    $('node').replaceChildren(...result.nodes.map(item=>{
      const option=new Option('第 '+item.game+' 局 / T'+item.turn+' / '+item.cardName+(item.reason?' · 不可恢复':''),item.sourceLine);
      option.disabled=!!item.reason;option.title=item.reason;
      return option;
    }));
    $('node').value=String(result.nodes.find(item=>!item.reason)?.sourceLine||'');
    status(result.nodes.some(n=>!n.reason)?'已导入 '+result.filename+'。':'这份回放没有通过初步校验的起点。');
  }catch(error){$('node').replaceChildren(new Option('先导入回放'));status(error.message,true);}
  finally{state.busy=false;selectNode();}
};
$('connect').onclick=async()=>{
  $('connect').disabled=true;status('正在检查…',false,'connection-status');
  try{status((await post('/api/connect',provider())).message,false,'connection-status');}
  catch(error){status(error.message,true,'connection-status');}
  finally{$('connect').disabled=false;}
};
$('provider').onchange=()=>{status('',false,'connection-status');if(fromDescription()&&sides.some(side=>$(side+'-mode').value==='web'))invalidateScene();controls();};
$('node').onchange=selectNode;
$('focus').oninput=controls;
function changeSource(){
  for(const side of sides)$(side+'-mode').value=fromDescription()?'generated':'local';
  clearResult();renderTimeline();controls();
  status(fromDescription()?'填写描述并整理局面后开始。':state.seat===null?'导入回放后开始。':'选择起点并填写打法。');
}
$('from-replay').onchange=$('from-description').onchange=changeSource;
$('description').oninput=invalidateScene;
for(const side of sides)for(const field of ['mode','file'])$(side+'-'+field).onchange=()=>{
  $('decks').replaceChildren();
  if(fromDescription())invalidateScene();
  controls();
};
$('check-decks').onclick=()=>submit('decks');
$('prepare-scene').onclick=()=>submit('scene');
$('add-node').onclick=()=>addEntry('node');
$('add-turn').onclick=()=>addEntry('turn');
$('node-description').oninput=()=>editSelected({description:$('node-description').value});
$('turn-fill').onchange=()=>editSelected({auto:$('turn-fill').checked});
$('delete-node').onclick=()=>{
  const index=state.entries.findIndex(e=>e.id===state.selected);
  if(index<0)return;
  state.results.delete(state.selected);
  state.entries.splice(index,1);
  state.selected=state.entries[index-1]?.id||'start';
  invalidateEntries(index);saveDraft(0);
};
$('check-timeline').onclick=()=>submit('timeline','check');
$('export-timeline').onclick=()=>submit('timeline','export');
$('generate').onclick=()=>fromDescription()&&state.entries.length?submit('timeline','branch'):submit('convert');
$('cancel').onclick=()=>api('/api/jobs/'+state.job,{method:'DELETE'}).catch(error=>status(error.message,true));
controls();
api('/api/timeline-draft').then(draft=>{
  if(!draft||state.draftChanged||state.busy||state.seat!==null)return;
  $('from-description').checked=true;
  $('description').value=draft.description;
  state.entries=draft.entries;
  if(draft.prepared){
    state.sceneId=draft.prepared.sceneId;
    showScene(draft.prepared.preview);
  }
  changeSource();
}).catch(error=>status('读取草稿失败。'+error.message,true));
