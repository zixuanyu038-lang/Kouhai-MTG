'use strict';
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib');
const {createConverter}=require('./server');
const Replay=require('../endstep-reader/replay');
const {readManualSideboard,prepareMatchDecks}=require('../endstep-reader/match-decks');
const card=(id,name,owner,zone,extra={})=>({id,name,ownerId:owner,controllerId:owner,zone,types:[],subtypes:[],supertypes:[],keywords:[],counters:{},faceDown:false,tapped:false,...extra});
const player=(id,hand,battlefield,librarySize)=>({id,name:'Player '+id,life:id==='0'?3:20,hand,handSize:hand.length,librarySize,battlefield,graveyard:[],exile:[],manaPool:{}});
const initial={gameId:'synthetic',status:'ACTIVE',turnNumber:3,phase:'MAIN1',step:'MAIN1',activePlayerId:'1',priorityPlayerId:'1',stack:[],
  players:[player('0',[card(1000000001,'Hidden card','0','Hand',{faceDown:true})],[],59),
    player('1',[card(11,'Lightning Bolt','1','Hand',{types:['Instant']})],[card(10,'Mountain','1','Battlefield',{types:['Land'],supertypes:['Basic'],subtypes:['Mountain']})],58)]};
const rows=[{format:'endstep-replay',formatVersion:1,recordedAt:'2026-11-06T00:00:00Z',seat:1,players:[{seat:0,name:'Player 0'},{seat:1,name:'Player 1'}],games:1,complete:false},
  {k:'chapter',t:0,game:1,edge:'start'},{k:'key',t:1,state:initial},
  {k:'event',t:2,event:{type:'TURN_BEGAN',turnNumber:3,playerName:'Player 1',playerIndex:'1'}},
  {k:'action',t:10,action:{type:'PLAY_CARD',cardId:11}},
  {k:'event',t:20,event:{type:'SPELL_CAST',cardId:11,cardName:'Lightning Bolt',playerName:'Player 1',playerIndex:'1'}}];
const fixture=zlib.gzipSync(rows.map(JSON.stringify).join('\n')+'\n');
const intent={understoodIntent:'施放 Lightning Bolt，目标对手。',supported:true,issues:[],constraints:[],
  goals:[{action:'cast',cardName:'Lightning Bolt',targets:[{kind:'player',name:'',playerId:'0'}],abilityText:'',modes:[],scope:'this_turn',timing:'at_start'}]};
const description='第3回合，己方第一主阶段，我有优先权。对手3血，两张未知手牌，库顶 Plains。我手上是 Lightning Bolt 和一张未知牌，场上是未横置的 Mountain 和横置的 Island。坟场有 Shock，放逐区有 Opt，库顶 Mountain。';
const scenePlayer={life:-1,handSize:2,librarySize:-1,deckSize:-1,energyCounters:0,battlefield:[],hand:[],graveyard:[],exile:[],libraryTop:[],
  manaPool:{W:0,U:0,B:0,R:0,G:0,C:0},landsPlayed:-1,drawn:-1,spellsCast:[],suggestedCards:[],basicLands:[]};
const described={turn:3,phase:'MAIN1',activePlayer:'1',stack:[],issues:[],
  opponent:{...scenePlayer,life:3,libraryTop:['Plains'],basicLands:['Plains'],suggestedCards:['Swords to Plowshares']},
  own:{...scenePlayer,hand:[{name:'Lightning Bolt',count:1}],battlefield:[
    {name:'Mountain',count:1,tapped:false,summoningSick:false,counters:[]},{name:'Island',count:1,tapped:true,summoningSick:false,counters:[]}],
  graveyard:[{name:'Shock',count:1}],exile:[{name:'Opt',count:1}],libraryTop:['Mountain'],basicLands:['Mountain','Island']}};
const authoredStep=(action,extra={})=>({action,playerId:'1',cardName:'',abilityText:'',modes:[],x:-1,targets:[],...extra});
const authoredPlan=(summary,steps,checks=[])=>({summary,steps,checks,issues:[]});
const plansByText={
  '己方施放 Lightning Bolt，目标对手。':authoredPlan('Lightning Bolt 打对手',[authoredStep('cast',{cardName:'Lightning Bolt',targets:[{kind:'player',name:'',playerId:'0'}]})]),
  '双方让过结算，确认对手 6 血。':authoredPlan('让过并结算',[authoredStep('resolve')],[{playerId:'0',kind:'life',cardName:'',count:6,value:''}]),
  '双方让过结算，确认对手 8 血。':authoredPlan('让过并结算',[authoredStep('resolve')],[{playerId:'0',kind:'life',cardName:'',count:8,value:''}]),
  '己方让过。':authoredPlan('己方让过',[authoredStep('pass')]),
  '双方一路让过优先权到下一回合。':authoredPlan('双方让过到下一回合',[authoredStep('next_turn')])
};

async function main(){
  const second=structuredClone(initial);
  second.players[1].hand[0].name='Shock';
  const match=[{...rows[0],games:2},...rows.slice(1),{k:'chapter',t:30,game:2,edge:'start'},{k:'key',t:31,state:second}].map(JSON.stringify).join('\n');
  const plans=readManualSideboard([{game:2,playerId:'1',inText:'1 Shock',outText:'1 Lightning Bolt'},{game:2,playerId:'0',inText:'',outText:''}]);
  assert.throws(()=>readManualSideboard([{game:2,playerId:'1',inText:'2 Shock',outText:'1 Lightning Bolt'}]),/总张数/);
  const {readDeckPreferences}=require('../endstep-reader/deck-service');
  const profiles=await prepareMatchDecks({model:{sourceText:match},deckPreferences:readDeckPreferences({
    0:{mode:'upload',text:'60 Mountain'},1:{mode:'upload',text:'59 Mountain\n1 Lightning Bolt\n\nSideboard\n1 Shock'}
  }),manualSideboard:plans,deckService:{resolve(){throw Error('Unexpected lookup');}},ask(){throw Error('Manual plans should bypass AI');},
  forge:{request({names}){return {cards:names.map(name=>({name,found:true,land:name==='Mountain',basic:name==='Mountain'}))};}}});
  assert.ok(profiles.byGame[1][1].main.some(card=>card.name==='Lightning Bolt'));
  assert.ok(profiles.byGame[2][1].main.some(card=>card.name==='Shock'));
  assert.ok(profiles.byGame[2][1].sideboard.some(card=>card.name==='Lightning Bolt'));
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'endstep-converter-smoke-'));
  const requests=[];
  const upstream=http.createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const data=JSON.parse(Buffer.concat(chunks));
    requests.push({path:req.url,format:data.response_format?.type});
    if(data.response_format?.type==='json_schema'){res.writeHead(400);return res.end('unsupported response_format');}
    const impossible={...intent,goals:[{...intent.goals[0],targets:[{kind:'card',name:'Mountain',playerId:'1'}]}]};
    const stackScene={...described,activePlayer:'0',stack:[{name:'Shock',controller:'0',modeText:'',targets:[{kind:'player',name:'',player:'1'}]}]};
    const message=data.messages[1].content;
    if(data.model==='uploaded-scene'){
      const {deckSources}=JSON.parse(message.split('\n').at(-1));
      const uploaded={mode:'upload',parsed:true,mainCount:60,sideboardCount:0};
      assert.deepEqual(deckSources,{own:uploaded,opponent:uploaded});
    }
    const answer=message.startsWith('把战报节点文字')?plansByText[JSON.parse(message.split('\n').at(-1)).description]:
      message.startsWith('把这段玩家描述')?
      (data.model==='bad-zone'?{...described,own:{...described.own,handSize:0}}:data.model==='stack-scene'?stackScene:
        data.model==='uploaded-scene'?{...described,own:{...described.own,energyCounters:3}}:
        data.model==='unsupported-scene'?{...described,issues:[{kind:'opponent_priority',quote:'对手有优先权',reason:'起点要求己方有优先权。'}]}:
        data.model==='timeline'?{...described,opponent:{...described.opponent,life:9}}:described):
      data.model==='bad-target'?impossible:intent;
    const content=data.model==='bad-json'?'Here is the play.':JSON.stringify(answer);
    res.end(JSON.stringify({choices:[{message:{content}}]}));
  });
  await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  let app;
  try{
    app=await createConverter({dataDir:directory});
    const home=await fetch(app.origin);
    assert.match(await home.text(),/<title>口嗨万智牌<\/title>/);
    const cookie=home.headers.get('set-cookie').split(';')[0];
    async function request(route,{method='GET',body,headers={}}={}){
      const response=await fetch(app.origin+route,{method,body,headers:{Cookie:cookie,'X-Endstep-Request':'1',...headers}});
      assert.ok(response.ok,await response.clone().text());return response;
    }
    const settings={kind:'api',baseUrl:'http://127.0.0.1:'+upstream.address().port+'/v1',model:'smoke',key:''};
    const requestJob=async (payload,expected='complete')=>{
      let job=await (await request('/api/jobs',{method:'POST',body:JSON.stringify(payload)})).json();
      const deadline=Date.now()+180000;
      while(job.status==='running'&&Date.now()<deadline){
        await new Promise(resolve=>setTimeout(resolve,150));
        job=await (await request('/api/jobs/'+job.id)).json();
      }
      assert.equal(job.status,expected,job.error||job.message);return job;
    };
    const scene=await requestJob({type:'scene',provider:settings,description});
    const {preview,sceneId}=scene.result;
    assert.deepEqual(preview.players[1].graveyard.map(c=>c.name),['Shock']);
    assert.deepEqual(preview.players[1].exile.map(c=>c.name),['Opt']);
    assert.deepEqual(preview.players[0].libraryTop,['Plains']);
    assert.deepEqual(preview.players[1].hand.map(c=>c.assumed),[false,true]);
    assert.equal(preview.players[0].hand.length,2);
    const simulated=await requestJob({type:'convert',provider:settings,sceneId,focus:'现在施放 Lightning Bolt 打对手'});
    const setupBytes=Buffer.from(await (await request(simulated.result.downloadUrl)).arrayBuffer());
    const setupModel=Replay.parse(zlib.gunzipSync(setupBytes).toString('utf8'));
    assert.equal(setupModel.header.branchMeta.sourceKind,'description');
    assert.equal(setupModel.header.result,'win');
    assert.deepEqual(simulated.result.hiddenHands[1].cards,preview.players[1].hand.map(c=>c.name));
    assert.equal(setupModel.states[0].players[1].exile[0].name,'Opt');
    assert.deepEqual(setupModel.states[0].players[1].hand.map(c=>c.name),preview.players[1].hand.map(c=>c.name));
    const uploaded=await requestJob({type:'scene',provider:{...settings,model:'uploaded-scene'},description:description+'我有 3 点能量，对手能量为 0。',
      decks:{0:{mode:'upload',text:'60 Plains'},1:{mode:'upload',text:'56 Mountain\n1 Island\n1 Lightning Bolt\n1 Shock\n1 Opt'}}});
    assert.deepEqual(uploaded.result.preview.players.map(p=>p.energyCounters),[0,3]);
    assert.deepEqual(uploaded.result.preview.players[0].hand,[{name:'Plains',assumed:true},{name:'Plains',assumed:true}]);
    const unsupported=await requestJob({type:'scene',provider:{...settings,model:'unsupported-scene'},description:'第 3 回合第一主阶段，对手有优先权。'},'failed');
    assert.equal(unsupported.stage,'描述整理');
    assert.match(unsupported.error,/起点要求己方有优先权.*对手有优先权/);
    const invalidScene=await requestJob({type:'scene',provider:{...settings,model:'bad-zone'},description},'failed');
    assert.equal(invalidScene.stage,'描述整理');
    assert.match(invalidScene.error,/手牌总数/);
    const stackScene=await requestJob({type:'scene',provider:{...settings,model:'stack-scene'},description:'对手第一主阶段，Shock 在堆叠上，目标是我。我有优先权。'});
    assert.deepEqual(stackScene.result.preview.stack,[{name:'Shock',player:'对手',targets:['己方']}]);
    requests.length=0;
    const replay=await (await request('/api/replay',{method:'POST',body:fixture})).json();
    assert.equal(replay.nodes[0].reason,'');
    const parameters={provider:settings,decks:{0:{mode:'upload',text:'60 Mountain'},1:{mode:'upload',text:'59 Mountain\n1 Lightning Bolt'}}};
    const checked=await requestJob({type:'decks',...parameters});
    assert.equal(checked.result.decks.length,2);
    const generated=await requestJob({type:'convert',...parameters,sourceLine:replay.nodes[0].sourceLine,focus:'Lightning Bolt 打对手',context:'对手只有 3 点生命。',opponentHand:'Mountain'});
    assert.equal(generated.result.complete,true);
    const result=await request(generated.result.downloadUrl);
    const bytes=Buffer.from(await result.arrayBuffer()),model=Replay.parse(zlib.gunzipSync(bytes).toString('utf8'));
    assert.equal(model.header.branchMeta.hypothetical,true);
    assert.equal(model.header.result,'win');
    assert.equal(model.header.branchMeta.scenario.cards[0],'Mountain');
    assert.deepEqual(requests,[{path:'/v1/chat/completions',format:'json_schema'},{path:'/v1/chat/completions',format:'json_object'}]);
    const requestBranch={type:'convert',...parameters,sourceLine:replay.nodes[0].sourceLine,focus:'Lightning Bolt at the selected action'};
    const malformed=await requestJob({...requestBranch,provider:{...settings,model:'bad-json'}},'failed');
    assert.equal(malformed.errorCode,'model_json');
    assert.equal(malformed.stage,'打法提炼');
    const illegal=await requestJob({...requestBranch,provider:{...settings,model:'bad-target'}},'failed');
    assert.equal(illegal.stage,'Forge 执行');
    assert.match(illegal.error,/起点没有符合目标/);
    assert.equal(illegal.result,null);
    const timelineProvider={...settings,model:'timeline'};
    const timelineScene=await requestJob({type:'scene',provider:timelineProvider,description:'第 3 回合，己方第一主阶段，对手 9 血。'});
    const entries=[
      {id:'cast',kind:'node',description:'己方施放 Lightning Bolt，目标对手。'},
      {id:'resolve',kind:'node',description:'双方让过结算，确认对手 6 血。'},
      {id:'turn',kind:'turn',description:'',auto:false},
      {id:'pass',kind:'node',description:'己方让过。'}
    ];
    const timeline={type:'timeline',provider:timelineProvider,sceneId:timelineScene.result.sceneId};
    const needsBridge=await requestJob({...timeline,entries,operation:'check'});
    assert.deepEqual(needsBridge.result.timeline.map(e=>e.status),['verified','verified','verified','error','blocked']);
    assert.match(needsBridge.result.timeline[3].error,/衔接/);
    assert.equal(needsBridge.result.timeline[1].state.stack.length,1);
    assert.equal(needsBridge.result.timeline[2].state.players[0].life,6);
    const manualEntries=entries.slice(0,3).map(entry=>entry.kind==='turn'?{...entry,description:'双方一路让过优先权到下一回合。'}:entry);
    const manualTurn=await requestJob({...timeline,entries:manualEntries,operation:'check'});
    assert.equal(manualTurn.result.timeline[3].state.turn,4);
    assert.equal(manualTurn.result.timeline[3].fills,false);
    entries[2].auto=true;
    const exported=await requestJob({...timeline,entries:entries.slice(0,3),operation:'export'});
    assert.equal(exported.result.timeline[3].state.turn,4);
    assert.equal(exported.result.timeline[3].fills,true);
    const timelineBytes=Buffer.from(await (await request(exported.result.downloadUrl)).arrayBuffer());
    const authored=Replay.parse(zlib.gunzipSync(timelineBytes).toString('utf8'));
    assert.equal(authored.header.branchMeta.timeline.length,3);
    assert.equal(authored.header.branchMeta.timeline[2].filled,true);
    assert.match(zlib.gunzipSync(timelineBytes).toString('utf8'),/Forge 补演/);
    const wrongPriority=await requestJob({...timeline,entries,operation:'check'});
    assert.match(wrongPriority.result.timeline[4].error,/优先权属于对手/);
    const authoredBranch=await requestJob({...timeline,entries,operation:'branch',nodeId:'resolve',focus:'己方让过。'});
    assert.ok(authoredBranch.result.downloadUrl);
    entries[1].description='双方让过结算，确认对手 8 血。';
    const mismatch=await requestJob({...timeline,entries,operation:'check'});
    assert.deepEqual(mismatch.result.timeline.map(e=>e.status),['verified','verified','error','blocked','blocked']);
    assert.match(mismatch.result.timeline[2].error,/描述为 8，Forge 得到 6/);
    entries[0].description='己方让过。';
    const changed=await requestJob({...timeline,entries,operation:'check'});
    assert.deepEqual(changed.result.timeline.map(e=>e.status),['verified','verified','error','blocked','blocked']);
    assert.match(changed.result.timeline[2].error,/堆叠为空/);
    const draft={description:'第 3 回合，己方第一主阶段，对手 9 血。',entries,sceneId:timelineScene.result.sceneId};
    await request('/api/timeline-draft',{method:'PUT',body:JSON.stringify(draft)});
    const saved=await (await request('/api/timeline-draft')).json();
    assert.equal(saved.prepared.sceneId,timelineScene.result.sceneId);
    assert.equal(saved.entries[0].description,'己方让过。');
    const restored=await createConverter({dataDir:directory});
    try{
      const landing=await fetch(restored.origin),cookie=landing.headers.get('set-cookie').split(';')[0];
      const draft=await (await fetch(restored.origin+'/api/timeline-draft',{headers:{Cookie:cookie}})).json();
      assert.deepEqual(draft,saved);
    }finally{await restored.close();}
    if(process.env.ENDSTEP_DECODER){
      const mod=await import(require('node:url').pathToFileURL(process.env.ENDSTEP_DECODER).href);
      const decoded=await (mod.t||mod.n)(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
      assert.equal(decoded.skippedRecords,0);assert.equal(decoded.droppedKeys,0);
    }
    if(process.env.REPLAY_LAB_TEST_CODEX==='1'){
      const actual=await requestJob({type:'scene',provider:{kind:'codex'},description});
      assert.equal(actual.result.preview.players[0].life,3);
      const real=await requestJob({type:'convert',provider:{kind:'codex'},sceneId:actual.result.sceneId,focus:'现在施放 Lightning Bolt，目标是对手。'});
      assert.equal(real.result.complete,true);
      console.log('本机 Codex 真实生成通过。');
    }
    console.log('通过：描述起点、跨回合战报、节点冲突、前文编辑、分支、草稿及 Forge 回放导出。');
  }finally{
    if(app)await app.close();
    await new Promise(resolve=>upstream.close(resolve));
    await fs.rm(directory,{recursive:true,force:true,maxRetries:8,retryDelay:100});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
