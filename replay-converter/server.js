'use strict';
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const Replay=require('../endstep-reader/replay'),Source=require('../endstep-reader/search-source');
const {CodexClient}=require('../endstep-reader/codex-client');
const {ForgeClient}=require('../endstep-reader/forge-client');
const {DeckService,readDeckPreferences,DeckLookupError}=require('../endstep-reader/deck-service');
const {ensureMatchDecks}=require('../endstep-reader/search-review');
const {runForgeBranch}=require('../endstep-reader/search-branch');
const {instructions}=require('../endstep-reader/search-protocol');
const {compatibleModel}=require('./model-api');
const {prepareDescription}=require('./description-setup');
const {readEntries,runTimeline}=require('./timeline');
const phases={connect:'模型连接',scene:'描述整理',decks:'牌表与换备',restore:'起点与未知信息',intent:'打法提炼',simulate:'Forge 执行',export:'回放编译',timeline:'战报校验'};

async function codexBinary(){
  if(process.env.CODEX_BIN)return process.env.CODEX_BIN;
  const desktop=path.join(process.env.LOCALAPPDATA||'.','OpenAI','Codex','bin');
  const bins=await fs.readdir(desktop,{withFileTypes:true}).catch(()=>[]);
  const paths=[path.join(desktop,'codex.exe'),...bins.filter(d=>d.isDirectory()).map(d=>path.join(desktop,d.name,'codex.exe'))];
  const found=await Promise.all(paths.map(async binary=>({binary,time:await fs.stat(binary).then(s=>s.isFile()?s.mtimeMs:0,()=>0)})));
  return found.filter(item=>item.time).sort((a,b)=>b.time-a.time)[0]?.binary||'codex';
}

async function createConverter({port=0,dataDir=path.join(process.env.LOCALAPPDATA||__dirname,'EndstepReplayLab','data'),forgeClient,modelClient}={}){
  await fs.mkdir(dataDir,{recursive:true});
  const codex=modelClient||new CodexClient({binary:await codexBinary(),cwd:dataDir});
  const forge=forgeClient||new ForgeClient({dataDir}),deckService=new DeckService({directory:path.join(dataDir,'decks')});
  const profileDir=path.join(dataDir,'profiles'),session=crypto.randomBytes(32).toString('hex');
  const staticFiles={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8'],
    '/mark.svg':['mark.svg','image/svg+xml'],'/table.svg':['table.svg','image/svg+xml']};
  const draftFile=path.join(dataDir,'timeline-draft.json'),sceneFile=path.join(dataDir,'timeline-start.json');
  const readSaved=async file=>{
    const saved=JSON.parse(await fs.readFile(file,'utf8'));
    return saved.version===1?saved.data:null;
  };
  async function writeSaved(file,data){
    const temp=file+'.'+crypto.randomUUID()+'.tmp';
    try{
      await fs.writeFile(temp,JSON.stringify({version:1,data}));
      await fs.rename(temp,file);
    }finally{await fs.rm(temp,{force:true}).catch(()=>{});}
  }
  let replay,job,origin,scene=await readSaved(sceneFile).catch(()=>null);
  function json(res,data,status=200){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
  function publicJob(){
    const {id,type,status,message,result,error,errorCode,phase}=job;
    return {id,type,status,message,result,error,errorCode,stage:phases[phase]||null};
  }
  async function read(req,limit){
    const chunks=[];let size=0;
    for await(const chunk of req){
      size+=chunk.length;if(size>limit)throw Error('文件或请求超过大小限制。');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  function provider(settings){
    if(settings?.kind==='codex')return codex;
    if(settings?.kind==='api')return compatibleModel(settings);
    throw Error('请选择模型连接方式。');
  }
  function requestModel(model,current){
    return async (prompt,schema,options={})=>{
      let searched=false;
      if(options.requireWebSearch&&model!==codex)throw new DeckLookupError('deck_lookup_failed','联网检索需要选择 Codex。也可以切换到本地检索或上传牌表。');
      const result=await model.generate({instructions,prompt,schema,signal:current.abort.signal,webSearch:!!options.webSearch,
        onDiagnostic:event=>{if(event.event==='web_search_completed')searched=true;}});
      if(options.requireWebSearch&&!searched)throw new DeckLookupError('deck_lookup_failed','Codex 未执行联网搜索，无法核对候选牌表。请上传牌表或使用本地检索。');
      return result;
    };
  }
  async function run(current,model,selectedReplay,selectedScene){
    const ask=requestModel(model,current);
    const progress=(_job,phase,message)=>{current.phase=phase;current.message=message;};
    try{
      if(model===codex&&!(await codex.status()).loggedIn)throw Error('Codex 尚未登录。请在 Codex 登录，或改用兼容 API。');
      current.abort.signal.throwIfAborted();
      await fs.mkdir(current.dir,{recursive:true});
      progress(current,'decks','正在准备双方牌表与换备…');
      if(current.type==='scene'){
        const prepared=await prepareDescription({description:current.description,preferences:current.deckPreferences,ask,forge,deckService,signal:current.abort.signal,
          progress:(phase,message)=>progress(current,phase,message)});
        current.abort.signal.throwIfAborted();
        const ready={id:current.id,description:current.description,...prepared};
        await writeSaved(sceneFile,ready);
        scene=ready;
        current.result={sceneId:scene.id,preview:scene.preview};
        current.message='局面已恢复。请核对起点与假设，再写打法并开始推演。';
      }else if(current.type==='timeline'){
        const result=await runTimeline({scene:selectedScene,job:current,ask,forge,progress:message=>progress(current,'timeline',message)});
        current.result=result.plan?{...result,downloadUrl:'/api/jobs/'+current.id+'/replay'}:result;
        current.message=result.blocked?'发现需要修正的节点，后续描述已保留。':result.plan?'战报回放已生成。':'战报节点校验完成。';
      }else if(current.type==='decks'){
        const profile=await ensureMatchDecks({replay:selectedReplay,profileDir,deckService,forge,deckPreferences:current.deckPreferences,signal:current.abort.signal,ask,onProgress:message=>progress(current,'decks',message)});
        selectedReplay.matchDecks=profile;
        current.result={decks:profile.bases.map((deck,id)=>({id,title:deck.archetype||'回放牌表',basis:deck.basis,url:deck.url||null,main:deck.main,sideboard:deck.sideboard}))};
        current.message='双方牌表已核对。';
      }else{
        const result=await runForgeBranch({job:current,replay:selectedScene||selectedReplay,preparedStart:selectedScene?.start,ask:(_job,...args)=>ask(...args),progress,forge,deckService,profileDir,focus:current.focus});
        if(!result.plan?.feasible)throw Error(result.plan?.issues?.join('；')||'Forge 未能完成指定动作，请检查时机、目标与费用。');
        current.result={...result,downloadUrl:'/api/jobs/'+current.id+'/replay'};
        current.message=result.complete?'回放已生成，包含本局推演至终局。':'已生成回放片段。推演在预算上限内未到终局。';
      }
      current.abort.signal.throwIfAborted();
      current.status='complete';
    }catch(error){
      current.status=current.abort.signal.aborted?'cancelled':'failed';
      current.error=current.status==='cancelled'?null:error.message;
      current.errorCode=current.error?(error.code||current.phase):null;
      current.result=null;
      current.message=current.status==='cancelled'?'已取消。':'请检查下方提示后重试。';
      await fs.rm(current.dir,{recursive:true,force:true}).catch(()=>{});
    }
  }
  const server=http.createServer(async(req,res)=>{
    try{
      if(req.headers.host!==new URL(origin).host)return json(res,{error:'无效的本机地址。'},403);
      const route=new URL(req.url,origin).pathname;
      if(route==='/shutdown'&&req.method==='POST'&&process.env.REPLAY_LAB_SHUTDOWN&&req.headers.authorization==='Bearer '+process.env.REPLAY_LAB_SHUTDOWN){
        res.end();setImmediate(()=>app.close());return;
      }
      res.setHeader('Cache-Control','no-store');
      res.setHeader('X-Content-Type-Options','nosniff');
      res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'");
      if(req.method==='GET'&&staticFiles[route]){
        const [file,type]=staticFiles[route];
        if(route==='/')res.setHeader('Set-Cookie','endstep_converter='+session+'; HttpOnly; SameSite=Strict; Path=/');
        res.writeHead(200,{'Content-Type':type});return res.end(await fs.readFile(path.join(__dirname,file)));
      }
      if(!req.headers.cookie?.split(';').some(cookie=>cookie.trim()==='endstep_converter='+session))return json(res,{error:'请重新打开应用窗口。'},403);
      if(req.method!=='GET'&&(req.headers['x-endstep-request']!=='1'||req.headers.origin&&req.headers.origin!==origin))return json(res,{error:'无效的本机请求。'},403);
      if(route==='/api/timeline-draft'){
        if(req.method==='GET'){
          const draft=await readSaved(draftFile).catch(()=>null);
          const prepared=scene&&draft?.sceneId===scene.id&&draft.description.trim()===scene.description?{sceneId:scene.id,preview:scene.preview}:null;
          return json(res,draft?{...draft,prepared}:null);
        }
        if(req.method==='PUT'){
          const draft=JSON.parse(await read(req,512*1024));
          if(typeof draft.description!=='string'||draft.description.length>8000)throw Error('起点描述过长。');
          const sceneId=typeof draft.sceneId==='string'&&draft.sceneId===scene?.id?scene.id:null;
          await writeSaved(draftFile,{description:draft.description,entries:readEntries(draft.entries),sceneId});
          return json(res,{ok:true});
        }
      }
      if(req.method==='POST'&&route==='/api/connect'){
        const settings=JSON.parse(await read(req,16*1024)),model=provider(settings);
        if(model===codex){
          const status=await codex.status();
          if(!status.loggedIn)throw Error('Codex 尚未登录。请先在 Codex 登录。');
          return json(res,{message:'Codex 已连接'+(status.model?' · '+status.model:'')});
        }
        await model.generate({instructions:'这是连接测试。',prompt:'返回 {"ok":true}。',schema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false},signal:AbortSignal.timeout(30000)});
        return json(res,{message:'API 已连接 · '+model.model});
      }
      if(req.method==='POST'&&route==='/api/replay'){
        if(job?.status==='running')return json(res,{error:'请先停止当前推演。'},409);
        const file=await read(req,32*1024*1024),filename=decodeURIComponent(req.headers['x-replay-name']||'replay.esreplay');
        const input=file[0]===0x1f&&file[1]===0x8b?await new Promise((resolve,reject)=>zlib.gunzip(file,{maxOutputLength:32*1024*1024},(error,bytes)=>error?reject(error):resolve(bytes))):file;
        if(job?.status==='running')return json(res,{error:'请先停止当前推演。'},409);
        const sourceText=input.toString('utf8'),model=Replay.parse(sourceText,filename);
        if(model.warnings.some(w=>w.includes('状态恢复失败')))throw Error('原局状态恢复存在错误。');
        const nodes=Source.candidates(sourceText).map(n=>{
          const {sourceLine,game,turn,phase,cardName,stack,players}=n;
          let reason='';
          try{Source.sourceAt(sourceText,sourceLine);}catch(error){reason=error.message;}
          return {sourceLine,game,turn,phase,cardName,stack,players,reason};
        });
        if(!nodes.length)throw Error('此回放没有可选的己方操作。');
        replay={id:crypto.createHash('sha256').update(input).digest('hex'),model,nodes,review:null};
        return json(res,{filename,seat:String(model.header.seat),nodes});
      }
      if(req.method==='POST'&&route==='/api/jobs'){
        if(job?.status==='running')return json(res,{error:'已有任务正在运行。'},409);
        const input=JSON.parse(await read(req,300*1024));
        if(job?.status==='running')return json(res,{error:'已有任务正在运行。'},409);
        if(!['decks','scene','convert','timeline'].includes(input.type))throw Error('无法识别此任务。');
        const selectedScene=(input.type==='timeline'||input.type==='convert'&&input.sceneId)?scene:null;
        if((input.type==='timeline'||input.type==='convert'&&input.sceneId)&&(!selectedScene||selectedScene.id!==input.sceneId))throw Error('请重新整理并核对描述局面。');
        if(input.type!=='scene'&&!selectedScene&&!replay)throw Error('请先导入原始回放，或从描述创建起点。');
        const model=provider(input.provider);
        let deckPreferences=null;
        if(input.type==='scene'){
          deckPreferences={};
          for(const id of ['0','1']){
            const entry=input.decks?.[id];
            deckPreferences[id]=!entry||entry.mode==='generated'?{mode:'generated'}:readDeckPreferences({[id]:entry})[id];
          }
        }else if(!selectedScene){
          deckPreferences=readDeckPreferences(input.decks);
          if(!deckPreferences||!deckPreferences['0']||!deckPreferences['1'])throw Error('请为双方选择牌表来源。');
        }
        if(model!==codex&&Object.values(deckPreferences||{}).some(deck=>deck.mode==='web'))throw Error('联网牌表检索需要选择 Codex。');
        const description=typeof input.description==='string'?input.description.trim():'';
        if(input.type==='scene'&&(!description||description.length>8000))throw Error('请填写不超过 8000 字的场面描述。');
        const focus=typeof input.focus==='string'?input.focus.trim().slice(0,4000):'';
        const operation=input.type==='timeline'?input.operation:null;
        if(input.type==='timeline'&&!['check','export','branch'].includes(operation))throw Error('请选择战报校验、导出或分支。');
        if(operation==='branch'&&!focus)throw Error('请填写要重演的打法。');
        const entries=input.type==='timeline'?readEntries(input.entries):null;
        const context=typeof input.context==='string'?input.context.trim().slice(0,3000):'';
        const stressCards=String(input.opponentHand||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
        if(stressCards.length>50||stressCards.some(card=>card.length>180))throw Error('未知手牌请逐行填写完整英文牌名。');
        if(input.type==='convert'){
          if(!focus)throw Error('请填写要重演的打法。');
          if(!selectedScene){
            const node=replay.nodes.find(n=>n.sourceLine===input.sourceLine);
            if(!node||node.reason)throw Error(node?.reason||'请选择回放中的起点。');
          }
        }
        const id=crypto.randomUUID();
        job={id,type:input.type,sourceLine:input.sourceLine,description,focus,context,stressCards,deckPreferences,operation,entries,nodeId:input.nodeId,
          providerId:model===codex?'codex':model.endpoint+' '+model.model,status:'running',phase:'connect',message:'正在准备…',abort:new AbortController(),dir:path.join(dataDir,'jobs',id)};
        run(job,model,replay,selectedScene);
        return json(res,publicJob());
      }
      if(job&&route==='/api/jobs/'+job.id){
        if(req.method==='DELETE'&&job.status==='running')job.abort.abort();
        if(['DELETE','GET'].includes(req.method))return json(res,publicJob());
      }
      if(job?.status==='complete'&&job.result?.downloadUrl===route&&req.method==='GET'){
        const bytes=await fs.readFile(path.join(job.dir,'recommended.esreplay'));
        res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="endstep-branch.esreplay"'});
        return res.end(bytes);
      }
      return json(res,{error:'找不到该内容。'},404);
    }catch(error){if(!res.headersSent)json(res,{error:error.message},400);else res.end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  origin='http://127.0.0.1:'+server.address().port;
  let closing;
  const app={origin,close(){
    return closing??=(async()=>{
      job?.abort.abort();
      const children=[codex.process,forge.process].filter(child=>child?.pid&&child.exitCode==null&&child.signalCode==null);
      const exited=children.map(child=>new Promise(resolve=>child.once('exit',resolve)));
      codex.close();forge.close();
      await Promise.all([...exited,new Promise(resolve=>server.close(resolve))]);
    })();
  }};
  return app;
}
if(require.main===module)createConverter({port:Number(process.env.REPLAY_LAB_PORT||0),dataDir:process.env.REPLAY_LAB_DATA}).then(async app=>{
  if(process.env.REPLAY_LAB_READY)await fs.writeFile(process.env.REPLAY_LAB_READY,JSON.stringify({url:app.origin,pid:process.pid}));
  console.log(app.origin);
  process.on('SIGINT',()=>app.close());
  process.on('SIGTERM',()=>app.close());
}).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={createConverter};
