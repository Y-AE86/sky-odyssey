'use strict';

const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');

const formation=['h01','h02','h08','h04','h06','h10'];
const weaponNames={
  h07:'星渊浑天星杖',h08:'苍雷弧光太刀',h09:'离火焚天凤枪',h10:'月潮琉璃剑',h11:'暗冕鸦羽棘镰'
};
const domainRequest=/\/assets\/domains\/domain_h\d+\.png$/;
const crackRequest=/\/(?:vfx_impact_crack\.png|offline-battle-art\.js)$/;
const partLabel=id=>'cinema-domain-'+id;
const viewportEqual=(rect,width,height)=>rect && Math.abs(rect[0])<1 && Math.abs(rect[1])<1 &&
  Math.abs(rect[2]-width)<1 && Math.abs(rect[3]-height)<1;
const closeTo=(actual,expected,tolerance)=>Math.abs(actual-expected)<=tolerance;

function installSceneProbe(){
  window.cinemaProbe?.restore();
  const proto=Sky.BattleScene.prototype;
  const {render,advanceClock,hit,destroy}=proto;
  const probe={request:null,held:null,frames:[],hits:[],retired:null};
  let pauseEntries=[];
  const bounds=node=>{
    if(!node)return null;
    const {x,y,width,height}=node.getBoundingClientRect();
    return [x,y,width,height];
  };
  proto.advanceClock=function(){
    return probe.held ? 0 : advanceClock.apply(this,arguments);
  };
  proto.hit=function(actor,entry,element,ultimate,time){
    const result=hit.apply(this,arguments);
    if(ultimate)probe.hits.push({actor,hero:this.byKey[actor].heroId,target:entry.target,kind:entry.kind,time,
      finisher:!!arguments[8]?.finisher});
    return result;
  };
  proto.render=function(time){
    if(probe.held)return;
    const result=render.apply(this,arguments);
    if(!this.ready)return result;
    const {cinema,vfx,camera}=this.inspect();
    const fx=cinema?.impact ? {...cinema.impact} : null;
    const domain=document.querySelector('#bleed .battle-domain');
    const shatter=document.querySelector('.battle-shatter');
    const cut=document.querySelector('.battle-cutin');
    const img=domain?.querySelector('img');
    const flags=this.flags;
    const screen=this.screenFxLayer;
    const shatterAnim=shatter?.getAnimations({subtree:true}) || [];
    const shatterAge=shatterAnim.length ? Math.max(...shatterAnim.map(a=>a.currentTime || 0)) : 0;
    const frame={time,supported:!!cinema?.supported,fx,domain:domain?{
      id:domain.dataset.hero,phase:domain.dataset.phase,size:[img?.naturalWidth,img?.naturalHeight],
      source:img?.currentSrc?.split('/').at(-1) || img?.src?.split('/').at(-1),bounds:bounds(domain),
      opacity:Number(getComputedStyle(domain).opacity),sizing:img?getComputedStyle(img).objectFit:null,
      zoom:img ? new DOMMatrix(getComputedStyle(img).transform).a : null
    }:null,shatter:shatter?{direction:shatter.dataset.direction,age:shatterAge,
      crack:!!shatter.querySelector('.battle-shatter-crack'),bits:shatter.childElementCount}:null,
    cut:cut?{hero:cut.dataset.hero,bounds:bounds(cut),content:bounds(cut.querySelector('.battle-cut-content')),
      media:cut.dataset.media}:null,
    active:vfx.active.filter(a=>a.frame!==null).map(a=>({hero:a.heroId,role:a.role,frame:a.frame,
      source:a.source,cinemaScale:a.cinemaScale,finisher:a.finisher,target:a.target,impactAt:a.impactAt})),
    hud:{flags:flags?.children.length || 0,float:document.querySelectorAll('.battle-float').length,
      total:document.querySelector('.battle-total:not([hidden]) strong')?.textContent || null,
      cards:document.querySelectorAll('.battle-card').length},
    filters:camera.filters.active,
    layering:screen?{stage:screen.parent===this.app?.stage,beforeFlags:screen.parent===flags?.parent &&
      screen.parent.getChildIndex(screen)<screen.parent.getChildIndex(flags)}:null};
    probe.frames.push(frame);
    if(probe.frames.length>1200)probe.frames.shift();
    const request=probe.request;
    if(!request)return result;
    const wantShatter=request.kind==='shatter' && frame.shatter?.direction===request.direction &&
      (shatterAge>=36 || shatterAnim.length===0);
    const wantImpact=request.kind==='impact' && fx?.visible && fx.mirror===!!request.mirror;
    const wantDomain=request.kind==='domain' && frame.domain?.id===request.hero && frame.domain?.phase==='active' &&
      frame.domain.opacity>=.96 && frame.hud.total && !fx?.visible && frame.active.some(a=>a.hero===request.hero);
    const wantFallback=request.kind==='fallback' && !frame.supported && !!frame.hud.total &&
      probe.hits.some(h=>h.actor[0]==='a' && h.hero===request.hero);
    if(wantShatter || wantImpact || wantDomain || wantFallback){
      probe.held=frame;
      probe.request=null;
      pauseEntries=document.getAnimations().filter(animation=>animation.playState==='running');
      for(const animation of pauseEntries)animation.pause();
    }
    return result;
  };
  proto.destroy=function(){
    const result=destroy.apply(this,arguments);
    probe.retired={disposed:this.disposed,canvasRemoved:!this.canvas.isConnected};
    return result;
  };
  probe.resume=()=>{
    probe.held=null;
    for(const animation of pauseEntries)if(animation.playState==='paused')animation.play();
    pauseEntries=[];
  };
  probe.restore=()=>{
    probe.resume();proto.render=render;proto.advanceClock=advanceClock;proto.hit=hit;proto.destroy=destroy;
  };
  window.cinemaProbe=probe;
}

async function verifyWeapons(p,spec,{action,panel,importProgress,screenshot}){
  const save=await p.evaluate(()=>{
    const fixture=Sky.Save.fresh();
    fixture.owned=Sky.D.heroes.map(hero=>hero.id);
    return fixture;
  });
  await importProgress(p,save);
  await action(p,'roster').click();
  await panel(p,'roster-tab',2).click();
  const weapons={};
  for(const id of save.owned){
    await panel(p,'hero',id).click();
    const actual=await p.locator('.pn-weapon-emblem img').evaluate(async img=>{
      await img.decode();
      const rim=img.parentElement.getBoundingClientRect(),photo=img.getBoundingClientRect();
      return {file:new URL(img.currentSrc).pathname.split('/').at(-1),size:[img.naturalWidth,img.naturalHeight],
        box:[photo.width,photo.height],fit:getComputedStyle(img).objectFit,
        center:[(photo.left+photo.right-rim.left-rim.right)/2,(photo.top+photo.bottom-rim.top-rim.bottom)/2],
        title:document.querySelector('.pn-weapon-copy h2').textContent,
        bonus:document.querySelector('.pn-weapon-bonus')?.innerText};
    });
    assert.equal(actual.file,'weapon_'+id+'.png');
    assert(actual.box.every(value=>value>10));
    assert(actual.center.every(value=>Math.abs(value)<2),id+' weapon must be centered');
    assert.match(actual.bonus,/生命\s*\+6%/);
    assert.match(actual.bonus,/攻击\s*\+6%/);
    if(id in weaponNames){
      assert.equal(actual.title,weaponNames[id]);
      assert.deepEqual(actual.size,[520,520]);
      if(spec.name==='desktop' || (spec.mobile && id==='h08') || (spec.file && id==='h11'))
        await screenshot(p,spec,'cinema-weapon-'+id);
    }
    weapons[id]=actual;
  }
  assert.equal(Object.keys(weapons).length,11);
  await action(p,'home').click();
  return weapons;
}

async function readCut(p,id,{fallback=false}={}){
  const cut=p.locator('.battle-cutin[data-hero="'+id+'"]');
  await cut.waitFor();
  if(!fallback)await p.waitForFunction(id=>[...document.querySelectorAll('.battle-cutin[data-hero="'+id+'"] video')]
    .some(video=>video.currentTime>.07 && !video.paused),id);
  const actual=await cut.evaluate(node=>{
    const video=node.querySelector('video');
    const {x,y,width,height}=node.getBoundingClientRect();
    const rect=document.querySelector('#stage').getBoundingClientRect();
    const cover=getComputedStyle(document.querySelector('#bleed')).backgroundImage;
    return {bounds:[x,y,width,height],stage:[rect.x,rect.y,rect.width,rect.height],media:node.dataset.media,
      video:video?{name:new URL(video.currentSrc).pathname.split('/').at(-1),
        duration:video.duration,muted:video.muted}:null,canvasBackground:cover,
      sides:[...document.querySelectorAll('#bleed .cinema-wing')].map(wing=>({
        matte:wing.classList.contains('cinema-matte'),mask:getComputedStyle(wing).maskImage
      }))};
  });
  assert(actual.bounds.every((value,i)=>closeTo(value,actual.stage[i],1)));
  assert(closeTo(actual.bounds[2]/actual.bounds[3],16/9,.006));
  if(!fallback){
    assert.equal(actual.media,'ultimate');
    assert.equal(actual.video.name,'ult_'+id+'.mp4');
    assert(actual.video.duration>=2.8 && actual.video.duration<=5.3);
  }
  return {cut,actual};
}

function measureTrace(trace,id,spec){
  const frames=trace.frames;
  const cutStart=frames.find(frame=>frame.cut?.hero===id);
  const active=frames.filter(frame=>frame.domain?.id===id && frame.domain.phase==='active');
  const fading=frames.filter(frame=>frame.domain?.id===id && frame.domain.phase==='fading');
  const fadesGone=frames.find(frame=>fading.length && frame.time>fading[0].time && !frame.domain);
  const cracked=frames.filter(frame=>frame.fx?.visible && !frame.fx.mirror);
  const hit=trace.hits.find(hit=>hit.hero===id && hit.actor[0]==='a' && hit.kind==='damage' && hit.finisher);
  assert(active.length && fading.length && fadesGone, id+' domain lifecycle was painted');
  const hold=fading[0].time-active[0].time;
  const fade=fadesGone.time-fading[0].time;
  assert(cutStart && frames.every(frame=>!frame.shatter),'shatter transition disabled');
  assert(hold>=1350 && hold<=2250,'domain active '+hold);
  assert(fade>=230 && fade<=440,'domain fade '+fade);
  assert(active.some(frame=>frame.domain.opacity>=.97));
  assert(active.some(frame=>frame.domain.zoom>1.008));
  assert(active.some(frame=>frame.hud.total && Number(frame.hud.total.replace(/,/g,''))>0));
  const source=active.find(frame=>frame.domain.size[0]===1672)?.domain;
  assert.deepEqual(source?.size,[1672,941]);
  assert.equal(source.source,'domain_'+id+'.png');
  assert.equal(source.sizing,'cover');
  if(spec.mobile)assert(viewportEqual(source.bounds,spec.width,spec.height),'domain must fill the mobile wings');
  assert(hit && cracked.length,id+' pulse present at actual finisher');
  const first=cracked[0],last=cracked.at(-1);
  const off=frames.find(frame=>frame.time>last.time && !frame.fx?.visible);
  assert.equal(first.fx.startedAt,hit.time);
  assert.equal(first.time,hit.time);
  assert.equal(first.fx.duration,70);
  assert.equal(first.fx.source,spec.file?'embedded':'png');
  assert.equal(first.fx.blendMode,1);
  assert.deepEqual(first.fx.epicenter,[.635,.5]);
  assert(first.filters.includes('chromatic') && first.filters.includes('shockwave'));
  assert(last.time-first.time<80);
  assert(off && off.time-first.time>=64 && off.time-first.time<=180);
  assert(frames.some(frame=>frame.active.some(effect=>effect.hero===id && effect.cinemaScale>=1.2 &&
    effect.cinemaScale<=1.35 && (effect.role==='group'||effect.finisher))));
  return {duration:hold,fade,source,pulseDuration:first.fx.duration,
    presentedMs:off.time-first.time,activeFrames:cracked.length,impact:first.fx,
    shatter:false,
    cutinCount:frames.filter(frame=>frame.cut?.hero===id).length};
}

async function runDomainCinema(browser,origin,spec,{root,out},helpers){
  const {action,panel,battle,geometry,startFullVfxFixture,screenshot,verifyBattleArt}=helpers;
  const context=await browser.newContext({viewport:{width:spec.width,height:spec.height},deviceScaleFactor:spec.dpr,
    isMobile:!!spec.mobile,hasTouch:!!spec.mobile});
  const p=await context.newPage(),issues=[],requests=[];
  const shot=label=>screenshot(p,spec,label);
  const powerSave=spec.name==='power',canvas=spec.name==='canvas',fallback=powerSave||canvas;
  p.setDefaultTimeout(14000);
  p.on('pageerror',e=>issues.push('page: '+e.message));
  p.on('console',m=>{if(m.type()==='error')issues.push('console: '+m.text());});
  p.on('response',r=>{if(r.status()>=400)issues.push(r.status()+' '+r.url());});
  p.on('requestfailed',r=>{if(r.failure()?.errorText!=='net::ERR_ABORTED')issues.push('failed: '+r.url());});
  p.on('request',r=>{
    const url=new URL(r.url());
    requests.push(decodeURIComponent(url.pathname));
    if(/^https?:$/.test(url.protocol) && (spec.file || url.origin!==origin))issues.push('external: '+r.url());
  });
  const newRequests=()=>requests.filter(url=>domainRequest.test(url)||crackRequest.test(url));
  const noLayers=()=>p.waitForFunction(()=>!document.querySelector('.battle-domain,.battle-shatter'));
  const start=opts=>startFullVfxFixture(p,{formation,powerSave,...opts});
  const call=puzzle=>p.evaluate(request=>cinemaProbe.request=request,puzzle);
  const reset=()=>p.evaluate(()=>{
    cinemaProbe.frames=[];cinemaProbe.hits=[];cinemaProbe.request=null;cinemaProbe.resume();
  });
  const read=()=>p.evaluate(()=>({frames:cinemaProbe.frames,hits:cinemaProbe.hits}));
  const cast=id=>p.locator('[data-cast="'+formation.indexOf(id)+'"]:enabled').click();
  const shots={};
  async function capture(label){
    await p.waitForFunction(()=>cinemaProbe.held,null,{timeout:12000});
    try{
      shots[label]=await p.evaluate(()=>cinemaProbe.held);
      await shot(label);
      return shots[label];
    }finally{await p.evaluate(()=>cinemaProbe.resume());}
  }
  async function settle(){
    await noLayers();
    await battle(p,'skip').click();
    await p.locator('.battle-result').waitFor();
    assert.equal((await p.evaluate(()=>Sky.battlePage.inspect())).phase,'result');
    await battle(p,'return').click();
    await action(p,'home').click();
    await noLayers();
    const retired=await p.evaluate(()=>cinemaProbe.retired);
    assert.deepEqual(retired,{disposed:true,canvasRemoved:true});
  }

  try{
    if(spec.mobile){
      const cdp=await context.newCDPSession(p);
      await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{left:44,right:35,top:0,bottom:0}});
    }
    await p.goto(spec.file?pathToFileURL(path.join(root,'index.html')).href:origin+'/index.html');
    await p.locator('.route-tile').waitFor();
    await p.locator('.backdrop.current').evaluate(img=>img.decode());
    await p.waitForFunction(()=>document.querySelector('.lobby-video.is-playing'));
    assert.deepEqual(newRequests(),[],'no new art requests at idle lobby startup');
    const lobbyNewRequests=newRequests().length;
    const weapons=fallback?null:await verifyWeapons(p,spec,helpers);
    assert.deepEqual(newRequests(),[],'menus keep cinema art off the network');
    const stage=await geometry(p,spec);
    await start();
    await p.evaluate(installSceneProbe);
    const ready=await p.evaluate(()=>Sky.battlePage.inspect());
    assert.equal(ready.renderer,canvas?'canvas2d':'pixi-webgl');
    assert.equal(ready.cinema.supported,!fallback);

    const rally={};
    if(fallback){
      await call({kind:'fallback',hero:'h01'});
      await cast('h01');
      const {cut}=await readCut(p,'h01',{fallback:true});
      await cut.locator('.battle-cut-skip').click();
      await capture('cinema-fallback');
      assert((await read()).frames.every(f=>!f.domain && !f.shatter && !f.fx));
      assert.deepEqual(newRequests(),[],'fallback mode requests no heavy cinema art');
      await settle();
    }else{
      await p.waitForFunction(()=>Sky.battlePage.inspect().vfx.artReady.includes('vfx_impact_crack'));
      const readyDomains=new Set(requests.filter(url=>domainRequest.test(url)).map(url=>url.split('/').at(-1)));
      assert.deepEqual([...readyDomains].sort(),formation.map(id=>'domain_'+id+'.png').sort());
      for(const id of (spec.name==='desktop'?['h01','h02','h08']:['h01'])){
        await reset();
        await cast(id);
        const {cut,actual}=await readCut(p,id);
        if(spec.mobile){
          assert(actual.sides.some(side=>side.matte && side.mask.includes('gradient')));
          await shot('cinema-cutin-'+id);
        }
        if(id==='h01' && spec.name==='desktop')await cut.waitFor({state:'detached',timeout:5000});
        else await cut.locator('.battle-cut-skip').click();
        await p.locator('#bleed .battle-domain[data-hero="'+id+'"]').waitFor({state:'attached'});
        await noLayers();
        await p.waitForFunction(id=>cinemaProbe.frames.at(-1)?.domain===null &&
          cinemaProbe.frames.some(frame=>frame.domain?.id===id && frame.domain.phase==='fading'),id);
        rally[id]={cut:actual,...measureTrace(await read(),id,spec)};
      }
      await settle();
      if(out){
        await start();
        await p.evaluate(installSceneProbe);
        await p.waitForFunction(()=>Sky.battlePage.inspect().vfx.artReady.includes('vfx_impact_crack'));
        await cast('h01');
        const {cut}=await readCut(p,'h01');
        await call({kind:'impact'});
        await cut.locator('.battle-cut-skip').click();
        const frame=await capture('cinema-impact');
        assert(frame.fx.visible && frame.hud.flags && frame.layering?.beforeFlags);
        await call({kind:'domain',hero:'h01'});
        await capture(partLabel('h01'));
        await noLayers();
        for(const id of ['h02','h08']){
          await call({kind:'domain',hero:id});
          await cast(id);
          const {cut}=await readCut(p,id);
          await cut.locator('.battle-cut-skip').click();
          await capture(partLabel(id));
          await noLayers();
        }
        await settle();
      }
      if(spec.name==='desktop'){
        await start({encounter:'arena',enemyRage:true});
        await p.evaluate(installSceneProbe);
        await call({kind:'impact',mirror:true});
        const sample=await capture('cinema-impact-enemy');
        assert.deepEqual(sample.fx.epicenter,[.365,.5]);
        assert.equal(sample.fx.duration,70);
        assert.equal(sample.domain,null,'enemy impact keeps the board background');
        await settle();
      }
    }
    const embedded=spec.file?await verifyBattleArt(p):null;
    assert.deepEqual([...new Set(issues)],[]);
    return {name:spec.name,stage,renderer:ready.renderer,resolution:ready.resolution,fallback,lobbyNewRequests,
      requestedDomains:[...new Set(requests.filter(url=>domainRequest.test(url)).map(url=>url.split('/').at(-1)))].sort(),
      crackRequests:requests.filter(url=>crackRequest.test(url)).length,weapons,rally,shots,embedded,errors:issues};
  }catch(error){
    const diagnostic=await p.evaluate(()=>({state:window.Sky?.battlePage?.inspect(),
      last:window.cinemaProbe?.frames.slice(-2),request:window.cinemaProbe?.request,held:window.cinemaProbe?.held})).catch(()=>null);
    if(out)await shot('cinema-failure').catch(()=>{});
    throw new Error(spec.name+' '+error.message+'\n'+JSON.stringify({diagnostic,issues:[...new Set(issues)]}),{cause:error});
  }finally{await context.close();}
}

module.exports={runDomainCinema};
