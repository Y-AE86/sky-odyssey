'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');

const leads=['h01','h02'];
const poses=['idle','windup','atk','hurt'];
const formation=['h02','h01','h04','h10','h05','h06'];
const pixi=/\/lib\/pixi\.min\.js$/;
const mp3=/\/assets\/audio\/.*\.mp3$/;
const board=/\/assets\/videos\/lobby_cg_.*\.mp4$/;

function installStartupProbe(){
  const samples=window.actorStartup={posterDecodedAt:null,sources:[]};
  const realDecode=HTMLImageElement.prototype.decode;
  HTMLImageElement.prototype.decode=function(){
    const decoded=realDecode.apply(this,arguments);
    if(this.matches('.backdrop.current'))decoded.then(()=>{
      samples.posterDecodedAt??=performance.now();
    },()=>{});
    return decoded;
  };
  const source=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'src');
  Object.defineProperty(HTMLMediaElement.prototype,'src',{...source,set(value){
    if(this.matches('.lobby-video') && value){
      const peers=[...document.querySelectorAll('.lobby-video[src]')];
      samples.sources.push({ms:performance.now(),name:new URL(value,location.href).pathname.split('/').pop(),
        preload:this.preload,peerTime:peers.find(video=>video!==this)?.currentTime ?? null});
    }
    return source.set.call(this,value);
  }});
}

function installActorProbe(){
  const proto=Sky.BattleScene.prototype;
  const {render,advanceClock,beginAction,destroy}=proto;
  const probe=window.actorProbe={held:null,capture:null,stages:{},frames:[],retired:null};
  proto.advanceClock=function(){
    return probe.held ? 0 : advanceClock.apply(this,arguments);
  };
  proto.beginAction=function(action){
    probe.action={actor:action.actor,kind:action.kind};
    return beginAction.apply(this,arguments);
  };
  proto.render=function(now,clock){
    if(probe.held)return;
    render.apply(this,arguments);
    if(!this.ready)return;
    probe.scene=this;
    const scene=this.inspect();
    const leads=scene.positions.filter(unit=>unit.key.startsWith('a') && ['h01','h02'].includes(unit.heroId));
    const embers=scene.vfx.embers.filter(item=>item.key==='h01' && item.atlasEndedAt!==null && item.visible>0);
    const airborne=leads.find(unit=>unit.heroId==='h01' && unit.pose==='atk' && unit.lift>8 &&
      Math.abs(unit.body.x-unit.shadow.x)>16);
    const landing=leads.find(unit=>unit.heroId==='h01' && unit.landing &&
      this.feedbackClock-this.byKey[unit.key].landing.start>60);
    const row={now,clock,leads,embers,airborne,landing,action:probe.action};
    probe.frames.push(row);
    if(probe.frames.length>800)probe.frames.shift();
    const request=probe.capture;
    if(!request)return;
    const selected=leads.find(unit=>{
      if(unit.heroId!==request.id || unit.pose!==request.pose)return false;
      const pose=this.byKey[unit.key]?.pose;
      return request.pose!=='hurt' || !(pose?.white || pose?.red);
    });
    if(selected || request.mode==='air' && airborne || request.mode==='land' && landing ||
      request.mode==='tail' && embers.some(ember=>ember.remainingMs<350)){
      probe.held={...row,label:request.label,selected};
      probe.capture=null;
    }
  };
  proto.destroy=function(){
    const result=destroy.apply(this,arguments);
    probe.retired={disposed:this.disposed,canvasRemoved:!this.canvas.isConnected};
    return result;
  };
}

function promiseGate(){
  let release;
  return {pending:new Promise(resolve=>{release=resolve;}),release};
}

async function testStartup(p,spec,url,requests,shot,action){
  let main,poster;
  if(spec.name==='desktop'){
    main=promiseGate();
    poster=promiseGate();
    await p.route('**/js/main.js',async route=>{await main.pending;await route.continue();});
    await p.route('**/assets/posters/lobby_cg_c07.png',async route=>{await poster.pending;await route.continue();});
  }
  await p.addInitScript(installStartupProbe);
  try{
    await p.goto(url,{waitUntil:'commit'});
    if(main){
      await p.locator('#boot-loading').waitFor();
      await shot('actor-boot-loading');
      main.release();
    }
    await p.locator('.route-tile').waitFor();
    await p.locator('#boot-loading').waitFor({state:'detached'});
    if(poster){
      assert.equal(await p.locator('.backdrop.current').evaluate(img=>img.complete),false);
      assert.equal(requests.filter(r=>board.test(r)).length,0,'poster fetch must precede the video');
      poster.release();
    }
    await p.locator('.backdrop.current').evaluate(img=>img.decode());
    const asyncImages=await p.locator('#view img').evaluateAll(images=>images.map(img=>img.decoding));
    assert(asyncImages.length>10 && asyncImages.every(mode=>mode==='async'),'all secondary lobby art decodes asynchronously');
    if(main)await shot('actor-lobby-still');
    await p.waitForFunction(()=>actorStartup.sources.length>0);
    await p.waitForFunction(()=>actorStartup.sources.length===1);
    const [active,standby]=await p.locator('.lobby-video').evaluateAll(videos=>videos.map(video=>({
      sourced:video.hasAttribute('src'),preload:video.preload
    })));
    assert.deepEqual([active,standby],[{sourced:true,preload:'auto'},{sourced:false,preload:'none'}]);
    await p.locator('.lobby-video.is-playing').first().waitFor({state:'attached'});
    await p.waitForFunction(()=>performance.now()-actorStartup.posterDecodedAt>=2250);
    const media=await p.evaluate(()=>({unlock:Sky.audio.inspect().unlocked,tracks:Sky.audio.inspect().tracks,
      primary:actorStartup.sources[0],sources:actorStartup.sources,poster:actorStartup.posterDecodedAt}));
    assert.equal(media.unlock,false);
    assert.deepEqual(media.tracks,{});
    assert.equal(requests.filter(r=>pixi.test(r)).length,0,'Pixi waits for battle or post-interaction idle');
    assert.equal(requests.filter(r=>mp3.test(r)).length,0,'BGM waits for a genuine interaction');
    assert.equal(media.primary.preload,'auto');
    assert.equal(media.primary.peerTime,null);
    assert(media.poster!==null && media.primary.ms-media.poster>=950,'primary video must wait for the decoded still');
    assert(media.sources.length<=2,'boot must use at most a primary and spare');
    if(media.sources.length===2){
      assert.equal(media.sources[1].preload,'metadata');
      assert(media.sources[1].peerTime>=.8);
    }
    const beforeGesture={pixi:requests.filter(r=>pixi.test(r)).length,
      bgm:requests.filter(r=>mp3.test(r)).length,videoRequests:requests.filter(r=>board.test(r)).length};
    await action(p,'atlas').click();
    await p.waitForFunction(()=>Sky.audio.inspect().unlocked);
    await p.waitForFunction(()=>Object.keys(Sky.audio.inspect().tracks).length>0);
    await action(p,'close').click();
    return {staticStatus:!!main,visibleUiWhilePosterPending:!!poster,asyncImages:asyncImages.length,beforeGesture,
      posterToPrimaryMs:Math.round(media.primary.ms-media.poster),sources:media.sources,unlockedAfterClick:true};
  } finally{
    main?.release();
    poster?.release();
  }
}

async function runActorUpgrade(browser,origin,spec,{root,out},helpers){
  const {action,panel,battle,geometry,startFullVfxFixture,screenshot,queueVfxCast,checkEmbedded}=helpers;
  const context=await browser.newContext({viewport:{width:spec.width,height:spec.height},deviceScaleFactor:spec.dpr,
    isMobile:!!spec.mobile,hasTouch:!!spec.mobile});
  const issues=[],requests=[];
  const p=await context.newPage();
  const shot=label=>screenshot(p,spec,label);
  p.setDefaultTimeout(14000);
  p.on('pageerror',e=>issues.push(e.message));
  p.on('console',message=>{if(message.type()==='error')issues.push(message.text());});
  p.on('response',res=>{if(res.status()>=400)issues.push(res.status()+' '+res.url());});
  p.on('requestfailed',req=>{
    const error=req.failure()?.errorText;
    if(error!=='net::ERR_ABORTED')issues.push(error+' '+req.url());
  });
  p.on('request',req=>{
    const url=new URL(req.url());
    requests.push(decodeURIComponent(url.pathname));
    if(/^https?:$/.test(url.protocol) && (spec.file || url.origin!==origin))issues.push('external '+req.url());
  });
  try{
    if(spec.mobile){
      const cdp=await context.newCDPSession(p);
      await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{left:44,right:35,top:0,bottom:0}});
    }
    const url=spec.file?pathToFileURL(path.join(root,'index.html')).href:origin;
    const startup=await testStartup(p,spec,url,requests,shot,action);
    const stage=await geometry(p,spec);
    const powerSave=spec.name==='power';
    const lightweight=powerSave || spec.name==='canvas';
    let rendererLoadingScreen=false;
    if(spec.name==='desktop'){
      const renderer=promiseGate();
      await p.route('**/lib/pixi.min.js',async route=>{await renderer.pending;await route.continue();});
      const entering=startFullVfxFixture(p,{formation,powerSave});
      try{
        await p.locator('[data-battle-prepare-cancel]').waitFor();
        rendererLoadingScreen=true;
      } finally {
        renderer.release();
        await entering;
      }
    } else await startFullVfxFixture(p,{formation,powerSave});
    await p.evaluate(installActorProbe);
    const inspect=()=>p.evaluate(()=>Sky.battlePage.inspect());
    const boss=await inspect();
    assert.equal(boss.renderer,spec.name==='canvas'?'canvas2d':'pixi-webgl');
    assert.equal(boss.resolution,spec.dpr);
    assert.equal(boss.positions.length,12);
    assert.equal(boss.lighting?.key ?? null,lightweight?null:'battle_boss');
    const sha256=spec.file ? await checkEmbedded(p) : null;
    if(spec.file)for(const id of leads)for(const pose of poses.slice(1))
      assert(sha256[id+'_'+pose],id+' '+pose+' included in offline SHA-256');
    if(!spec.file)for(const id of leads)for(const pose of poses.slice(1))
      assert(requests.some(url=>url.endsWith('/assets/chibi/chibi_'+id+'_'+pose+'.png')));
    if(spec.name==='desktop' || spec.mobile)await shot('actor-light-altar');
    const captured={};
    const capture=async(label,request)=>{
      await p.evaluate(request=>{actorProbe.capture=request;},{...request,label});
      await p.waitForFunction(label=>actorProbe.held?.label===label,label,{timeout:15000});
      try{
        captured[label]=await p.evaluate(()=>actorProbe.held);
        if(out && spec.name==='desktop')await shot('actor-'+label);
      } finally{
        await p.evaluate(()=>{actorProbe.held=null;});
      }
      return captured[label];
    };
    const poseSamples={};
    if(spec.name==='desktop'){
      for(const id of leads){
        poseSamples[id]={};
        for(const pose of poses){
          const sample=await capture(id+'-'+pose,{id,pose});
          poseSamples[id][pose]=sample.selected;
        }
      }
      await capture('shadow-air',{mode:'air'});
      await capture('landing',{mode:'land'});
    } else{
      await p.waitForFunction(({leads,poses})=>leads.every(id=>poses.every(pose=>
        actorProbe.frames.some(frame=>frame.leads.some(unit=>unit.heroId===id && unit.pose===pose)))),{leads,poses},{timeout:16000});
      Object.assign(poseSamples,await p.evaluate(({leads,poses})=>Object.fromEntries(leads.map(id=>[id,
        Object.fromEntries(poses.map(pose=>[pose,actorProbe.frames.flatMap(frame=>frame.leads)
          .find(unit=>unit.heroId===id && unit.pose===pose)]))])),{leads,poses}));
    }
    for(const [id,samples] of Object.entries(poseSamples)){
      for(const pose of poses){
        assert.equal(samples[pose].poseTexture,pose==='idle'?id:id+'_'+pose);
        assert(Object.values(samples[pose].footAnchor || {}).length===2);
        assert(Object.values(samples[pose].footAnchor).every(value=>value>0 && value<=1),id+' '+pose+' foot anchor');
        assert(samples[pose].visualHeight>0);
        assert(Math.abs(samples[pose].visualHeight/samples.idle.visualHeight-1)<.17,id+' '+pose+' body height');
        const {body,ground,lift}=samples[pose];
        assert(Math.abs(body.y+lift-ground.y)<.01 && Math.abs(body.x-ground.x)<.01,id+' '+pose+' foot attachment');
      }
    }
    if(spec.name==='desktop'){
      const air=captured['shadow-air'].airborne;
      const idle=poseSamples[air.heroId].idle;
      assert(air.ground.y-air.body.y>8 && Math.abs(air.body.x-air.shadow.x)>16);
      assert(Math.abs(air.shadow.y-idle.shadow.y)<10,'airborne shadow remains close to the takeoff ground');
      assert(air.shadow.scale<idle.shadow.scale && air.shadow.alpha<idle.shadow.alpha);
      assert(air.shadow.scale>0 && air.shadow.alpha>0);
      assert(captured.landing.landing.landing);
    }
    let emberTail=null;
    const castsObserved=[];
    if(spec.name==='desktop' || lightweight){
      const casts=async(id,slot)=>{
        await p.evaluate(()=>actorProbe.frames=[]);
        await queueVfxCast(p,slot,id,powerSave);
        await p.waitForFunction(id=>actorProbe.frames.some(frame=>frame.action?.kind==='ultimate' && frame.leads
          .some(unit=>unit.heroId===id && unit.key===frame.action.actor && unit.pose==='atk')),id);
        castsObserved.push(id);
      };
      if(spec.name==='desktop'){
        await casts('h02',0);
        const tail= capture('ember-tail',{mode:'tail'});
        await casts('h01',1);
        emberTail=(await tail).embers;
        assert(emberTail.some(ember=>ember.count>=14 && ember.count<=22 && ember.remainingMs>0));
      } else {
        await casts('h01',1);
        const live=await inspect();
        assert.deepEqual(live.camera.filters.active,[]);
        assert.deepEqual(live.vfx.embers,[]);
      }
    }
    async function settle(){
      await battle(p,'skip').click();
      await p.locator('.battle-result').waitFor();
      const after=await inspect();
      assert.equal(after.phase,'result');
      assert(!after.camera.filters.active.length);
      assert(!after.vfx.embers.length && !after.vfx.active.length);
      await battle(p,'return').click();
      const retired=await p.evaluate(()=>actorProbe.retired);
      assert.deepEqual(retired,{disposed:true,canvasRemoved:true});
      await action(p,'home').click();
      return retired;
    }
    const cleanup=await settle();
    const lighting={altar:boss.lighting};
    const onStage=new Set(boss.positions.map(unit=>unit.heroId));
    if(spec.name==='desktop'){
      for(const [label,encounter,key] of [['port',1,'battle'],['cloud',6,'battle_ch2']]){
        await startFullVfxFixture(p,{formation:['h03','h07','h08','h09','h11','h01'],encounter});
        const state=await inspect();
        assert.equal(state.lighting?.key,key);
        lighting[label]=state.lighting;
        for(const unit of state.positions)onStage.add(unit.heroId);
        await shot('actor-light-'+label);
        await settle();
      }
      assert.equal(new Set(Object.values(lighting).map(value=>value.rim)).size,3);
      assert.equal(onStage.size,15);
    }
    if(spec.mobile){
      await action(p,'roster').click();
      await panel(p,'art','poster').click();
      await p.locator('.pn-portrait img').evaluate(img=>img.decode());
      await shot('actor-roster');
    }
    assert.deepEqual([...new Set(issues)],[]);
    return {name:spec.name,stage,startup:{...startup,rendererLoadingScreen},renderer:boss.renderer,resolution:boss.resolution,canvas:boss.canvas,
      lighting,actualUnits:[...onStage],actionTextures:boss.actionTextures,poseSamples,castsObserved,cleanup,
      airborne:captured['shadow-air']?.airborne,landing:captured.landing?.landing,emberTail,embeddedSha256:sha256,
      pixiRequests:requests.filter(r=>pixi.test(r)).length,consoleErrorsAndResourceFailures:issues.length};
  } catch(error){
    const diagnosis=await p.evaluate(()=>({page:document.querySelector('#view')?.dataset.page,
      state:window.Sky?.battlePage?.inspect(),probe:window.actorProbe?.frames.at(-1) })).catch(()=>null);
    if(out)await shot('actor-failure').catch(()=>{});
    throw new Error(spec.name+' '+error.message+'\n'+JSON.stringify({diagnosis,issues:[...new Set(issues)]}),{cause:error});
  }finally{
    await context.close();
  }
}

module.exports={runActorUpgrade};
