'use strict';

const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');

const formation=['h01','h02','h08','h04','h06','h10'];
const weaponNames={
  h07:'星渊浑天星杖',h08:'苍雷弧光太刀',h09:'离火焚天凤枪',h10:'月潮琉璃剑',h11:'暗冕鸦羽棘镰'
};
const domainRequest=/\/assets\/domains\/domain_h\d+\.png$/;
const crackRequest=/\/vfx_impact_crack\.png$/;
const videoRequest=/\/assets\/videos\/vfx_h\d+\.mp4$/;
const cues={h01:[260,1080,1920],h08:[200,1020,1860]};
const videoShots={
  h01:[{label:'cg-h01-dragon',at:1.05,color:'purple'},{label:'cg-h01-plum',at:1.95,color:'red'}],
  h08:[{label:'cg-h08-crystals',at:1.05,color:'cyan'},{label:'cg-h08-sword',at:1.90,color:'cyan'}]
};
const viewportEqual=(rect,width,height)=>rect && Math.abs(rect[0])<1 && Math.abs(rect[1])<1 &&
  Math.abs(rect[2]-width)<1 && Math.abs(rect[3]-height)<1;
const closeTo=(actual,expected,tolerance)=>Math.abs(actual-expected)<=tolerance;

function installSceneProbe(){
  window.cinemaProbe?.restore();
  const proto=Sky.BattleScene.prototype;
  const {render,advanceClock,videoElapsed,hit,destroy}=proto;
  const probe={request:null,held:null,frames:[],hits:[],retired:null};
  let pauseEntries=[],pausedSession,testPauseAt=0;
  const bounds=node=>{
    if(!node)return null;
    const {x,y,width,height}=node.getBoundingClientRect();
    return [x,y,width,height];
  };
  proto.advanceClock=function(){
    return probe.held ? 0 : advanceClock.apply(this,arguments);
  };
  proto.videoElapsed=function(time,speed,elapsed){
    return probe.held ? elapsed : videoElapsed.apply(this,arguments);
  };
  const mediaState=scene=>{
    const info=scene.vfx?.inspect()?.activeVideo;
    return info ? {...info} : null;
  };
  // Take both buffers in one task. No new BattleScene tick can modify the
  // units, video upload, camera or lighting between the paired draws.
  function renderedPixels(scene,video,mirror) {
    const gl=scene.app.renderer.gl, width=gl.drawingBufferWidth,height=gl.drawingBufferHeight;
    const withFx=new Uint8Array(width*height*4), withoutFx=new Uint8Array(withFx.length);
    const capture=data=>gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,data);
    capture(withFx);
    const layer=scene.screenFxLayer;
    layer.visible=false;
    try {
      scene.app.render();
      capture(withoutFx);
    } finally {
      layer.visible=true;
      scene.app.render();
    }

    const raw=document.createElement('canvas');
    raw.width=video.videoWidth;raw.height=video.videoHeight;
    const ctx=raw.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(video,0,0);
    const source=ctx.getImageData(0,0,raw.width,raw.height).data;
    const colors={purple:0,red:0,cyan:0,gold:0}, sampled={black:0,changed:0,edge:0};
    const maxDelta={black:0,edge:0};
    const step=Math.ceil(width/600);
    for(let y=0;y<height;y+=step){
      for(let x=0;x<width;x+=step){
        const f=(y*width+x)*4, u=(x+.5)/width;
        const sx=Math.min(raw.width-1,Math.floor((mirror?1-u:u)*raw.width));
        const sy=Math.min(raw.height-1,Math.floor((1-(y+.5)/height)*raw.height));
        const s=(sy*raw.width+sx)*4;
        const r=withFx[f]-withoutFx[f],g=withFx[f+1]-withoutFx[f+1],b=withFx[f+2]-withoutFx[f+2];
        const delta=Math.max(Math.abs(r),Math.abs(g),Math.abs(b),Math.abs(withFx[f+3]-withoutFx[f+3]));
        if(delta>16){
          sampled.changed++;
          if(r>24 && b>20 && Math.min(r,b)-g>12)colors.purple++;
          if(r>32 && r-g>22 && r-b>18)colors.red++;
          if(b>30 && b-r>26 && g-r>9)colors.cyan++;
          if(r>35 && g>23 && Math.min(r,g)-b>18)colors.gold++;
        }
        if(Math.max(source[s],source[s+1],source[s+2])<=8){
          sampled.black++;
          maxDelta.black=Math.max(maxDelta.black,delta);
        }
        if(x===0 || x+step>=width){
          sampled.edge++;
          maxDelta.edge=Math.max(maxDelta.edge,delta);
        }
      }
    }
    return {width,height,step,colors,sampled,maxDelta};
  }
  proto.hit=function(actor,entry,element,ultimate,time,clock,index,due,meta){
    const result=hit.apply(this,arguments);
    if(ultimate)probe.hits.push({actor,hero:this.byKey[actor].heroId,target:entry.target,kind:entry.kind,
      amount:entry.amount,time,clock,due,index,media:mediaState(this),finisher:!!meta?.finisher});
    return result;
  };
  proto.render=function(time){
    if(probe.held)return;
    const result=render.apply(this,arguments);
    if(!this.ready)return result;
    const {cinema,vfx,camera}=this.inspect();
    const fx=cinema?.impact ? {...cinema.impact} : null;
    const media=mediaState(this);
    const domain=document.querySelector('#bleed .battle-domain');
    const shatter=document.querySelector('.battle-shatter');
    const cut=document.querySelector('.battle-cutin');
    const img=domain?.querySelector('img');
    const flags=this.flags;
    const screen=this.screenFxLayer;
    const frame={time,supported:!!cinema?.supported,fx,media,domain:domain?{
      id:domain.dataset.hero,phase:domain.dataset.phase,size:[img?.naturalWidth,img?.naturalHeight],
      source:img?.currentSrc?.split('/').at(-1) || img?.src?.split('/').at(-1),bounds:bounds(domain),
      opacity:Number(getComputedStyle(domain).opacity),sizing:img?getComputedStyle(img).objectFit:null,
      zoom:img ? new DOMMatrix(getComputedStyle(img).transform).a : null
    }:null,shatter:!!shatter,
    cut:cut?{hero:cut.dataset.hero,bounds:bounds(cut),content:bounds(cut.querySelector('.battle-cut-content')),
      media:cut.dataset.media}:null,
    active:vfx.active.filter(a=>a.frame!==null).map(a=>({hero:a.heroId,role:a.role,frame:a.frame,
      source:a.source,cinemaScale:a.cinemaScale,finisher:a.finisher,target:a.target,impactAt:a.impactAt})),
    hud:{flags:flags?.children.length || 0,float:document.querySelectorAll('.battle-float').length,
      total:document.querySelector('.battle-total:not([hidden]) strong')?.textContent || null,
      cards:document.querySelectorAll('.battle-card').length},
    filters:camera.filters.active,procedural:[...vfx.procedural],
    layering:screen?{stage:screen.parent===this.app?.stage,beforeFlags:screen.parent===flags?.parent &&
      screen.parent.getChildIndex(screen)<screen.parent.getChildIndex(flags)}:null};
    probe.frames.push(frame);
    if(probe.frames.length>1200)probe.frames.shift();
    const request=probe.request;
    if(!request)return result;
    const wantVideo=request.kind==='video' && media?.heroId===request.hero && media.mirror===!!request.mirror &&
      media.framesUploaded>0 && media.alpha>=.5 && media.presentedMediaTime>=request.at-.018;
    const wantDomain=request.kind==='domain' && frame.domain?.id===request.hero && frame.domain?.phase==='active' &&
      frame.domain.opacity>=.96 && frame.hud.total && !fx?.visible && frame.active.some(a=>a.hero===request.hero);
    const wantFallback=request.kind==='fallback' && !media && !!frame.hud.total &&
      probe.hits.some(h=>h.actor[0]==='a' && h.hero===request.hero);
    if(wantVideo || wantDomain || wantFallback){
      if(wantVideo){
        const session=this.vfx.activeVideo,video=session.video;
        if(!video.paused){
          testPauseAt=performance.now();
          video.pause();
          pausedSession=session;
        }
        frame.pixels=renderedPixels(this,video,media.mirror);
      }
      probe.held=frame;
      probe.request=null;
      pauseEntries=document.getAnimations().filter(animation=>animation.playState==='running');
      for(const animation of pauseEntries)animation.pause();
    }
    return result;
  };
  proto.destroy=function(){
    const result=destroy.apply(this,arguments);
    probe.retired={disposed:this.disposed,canvasRemoved:!this.canvas.isConnected,
      decoders:document.querySelectorAll('.battle-vfx-media video,.battle-vfx-decoder').length};
    return result;
  };
  probe.resume=()=>{
    if(pausedSession?.video.isConnected){
      // Screenshot collection may take longer than the production stall budget
      // at DPR 2/3. Return only the test pause time to that watchdog.
      pausedSession.lastFrameAt+=performance.now()-testPauseAt;
      pausedSession.video.play().catch(()=>{});
    }
    pausedSession=null;
    probe.held=null;
    for(const animation of pauseEntries)if(animation.playState==='paused')animation.play();
    pauseEntries=[];
  };
  probe.restore=()=>{
    probe.resume();proto.render=render;proto.advanceClock=advanceClock;proto.videoElapsed=videoElapsed;
    proto.hit=hit;proto.destroy=destroy;
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

function measureDomain(trace,id,spec,minHold){
  const frames=trace.frames;
  const cutStart=frames.find(frame=>frame.cut?.hero===id);
  const active=frames.filter(frame=>frame.domain?.id===id && frame.domain.phase==='active');
  const fading=frames.filter(frame=>frame.domain?.id===id && frame.domain.phase==='fading');
  const fadesGone=frames.find(frame=>fading.length && frame.time>fading[0].time && !frame.domain);
  const hit=trace.hits.find(hit=>hit.hero===id && hit.actor[0]==='a' && hit.kind==='damage' && hit.finisher);
  assert(active.length && fading.length && fadesGone, id+' domain lifecycle was painted');
  const hold=fading[0].time-active[0].time;
  const fade=fadesGone.time-fading[0].time;
  assert(cutStart && frames.every(frame=>!frame.shatter && !frame.fx?.visible),'shatter and screen impact disabled');
  assert(hold>=minHold && hold<=Math.max(4000,minHold+1100),'domain active '+hold);
  assert(fade>=220 && fade<=550,'domain fade '+fade);
  assert(active.some(frame=>frame.domain.opacity>=.97));
  assert(active.some(frame=>frame.domain.zoom>1.008));
  assert(active.some(frame=>frame.hud.total && Number(frame.hud.total.replace(/,/g,''))>0));
  const source=active.find(frame=>frame.domain.size[0]===1672)?.domain;
  assert.deepEqual(source?.size,[1672,941]);
  assert.equal(source.source,'domain_'+id+'.png');
  assert.equal(source.sizing,'cover');
  if(spec.mobile)assert(viewportEqual(source.bounds,spec.width,spec.height),'domain must fill the mobile wings');
  assert(hit);
  return {duration:hold,fade,source,cutinCount:frames.filter(frame=>frame.cut?.hero===id).length};
}

function measureVideo(trace,id,rate){
  const {frames}=trace;
  const active=frames.filter(row=>row.media?.heroId===id && !row.media.mirror);
  const visible=active.filter(row=>row.media.framesUploaded>0 && row.media.alpha>.02);
  assert(visible.length>10,id+' video was presented');
  assert(active.every(row=>row.layering?.stage && row.layering.beforeFlags),id+' video must sit below flags');
  assert(visible.some(row=>row.hud.cards===6 && row.hud.flags===12 && row.hud.total),id+' HUD above video');
  assert(active.every(row=>!row.active.some(fx=>fx.hero===id && fx.role!=='spark')),
    id+' nine-grid burst is omitted on video path');
  assert(visible.some(row=>row.media.currentTime>.3 && row.media.framesUploaded>=5));
  assert(active.find(row=>row.media.framesUploaded).media.alpha<=.05,id+' fade starts at first uploaded video frame');
  if(rate===1)assert(active.some(row=>row.media.alpha>.05 && row.media.alpha<.95 && row.media.presentedMediaTime<.3),
    id+' fade-in has an actually painted intermediate step');
  assert(visible.some(row=>row.media.alpha>.96));
  assert(visible.some(row=>row.media.presentedMediaTime>=2.57 && row.media.alpha<.62),
    id+' final 420ms opacity tail');
  assert(visible.every(row=>closeTo(row.media.playbackRate,rate,.05)));
  const hits=trace.hits.filter(hit=>hit.hero===id && hit.actor[0]==='a' && hit.target[0]==='e' &&
    hit.kind==='damage' && hit.amount>0);
  assert.deepEqual(hits.map(hit=>hit.due),cues[id]);
  const aligned=hits.map(hit=>{
    assert(hit.media?.heroId===id,id+' live video at hit');
    const ms=hit.media.presentedMediaTime*1000;
    assert(closeTo(ms,hit.due,125),id+' media frame offset '+(ms-hit.due));
    return {index:hit.index,due:hit.due,presented:Math.round(ms),offset:Math.round(ms-hit.due),amount:hit.amount,
      target:hit.target,finisher:hit.finisher};
  });
  assert.equal(hits.at(-1).finisher,true);
  assert(hits.every(hit=>frames.some(row=>row.time===hit.time && row.hud.float>0 && row.hud.total &&
    row.filters.includes('chromatic') && row.filters.includes('shockwave'))),
  id+' each of the three moments has same-frame text and camera effects');
  const first=active[0],last=active.at(-1);
  assert(last.media.presentedMediaTime>=2.73 && last.media.presentedMediaTime<=3.05,
    id+' end media '+last.media.presentedMediaTime);
  const wall=Math.round(last.time-first.time);
  assert(closeTo(wall,2850/rate,Math.max(300,500/rate)),id+' motion duration '+wall+'ms at '+rate+'×');
  return {rate,wall,aligned,firstAlpha:visible[0].media.alpha,lastAlpha:visible.at(-1).media.alpha,
    framesUploaded:last.media.framesUploaded,lastMedia:last.media.presentedMediaTime};
}

function verifyPixels(frame,request){
  assert(frame.media.currentTime>.3 && frame.media.framesUploaded>=5);
  assert(closeTo(frame.media.presentedMediaTime,request.at,.12),request.label+' capture frame');
  const {pixels}=frame;
  assert(pixels.sampled.changed>=100,request.label+' empty Pixi output');
  assert(pixels.colors[request.color]>=12,
    request.label+' missing '+request.color+' CG pixels: '+JSON.stringify(pixels.colors));
  if(request.at===1.05)assert(pixels.sampled.black>=1000,request.label+' need a dark source sample');
  assert(pixels.maxDelta.edge<=3,
    request.label+' hard horizontal edge: '+JSON.stringify(pixels));
  assert(pixels.maxDelta.black<=14,request.label+' black backdrop changed: '+JSON.stringify(pixels));
}

async function runDomainCinema(browser,origin,spec,{root,out},helpers){
  const {action,panel,battle,geometry,startFullVfxFixture,screenshot,verifyBattleArt}=helpers;
  const context=await browser.newContext({viewport:{width:spec.width,height:spec.height},deviceScaleFactor:spec.dpr,
    isMobile:!!spec.mobile,hasTouch:!!spec.mobile});
  const p=await context.newPage(),issues=[],requests=[];
  const shot=label=>screenshot(p,spec,label);
  const powerSave=spec.name==='power',canvas=spec.name==='canvas',light=powerSave||canvas;
  const fallback=light||spec.file,rate=spec.speed||1;
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
  const newRequests=()=>requests.filter(url=>domainRequest.test(url)||crackRequest.test(url)||videoRequest.test(url));
  const noLayers=()=>p.waitForFunction(()=>!document.querySelector('.battle-domain,.battle-shatter'));
  const start=async opts=>{
    await startFullVfxFixture(p,{formation,powerSave,...opts});
    await p.evaluate(installSceneProbe);
    for(let i=1;i<rate;i++)await battle(p,'speed').click();
  };
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
  async function settle(route='skip'){
    if(route==='leave')await p.evaluate(()=>Sky.ui.go('lobby'));
    else {
      await battle(p,'skip').click();
      await p.locator('.battle-result').waitFor();
      const result=await p.evaluate(()=>Sky.battlePage.inspect());
      assert.equal(result.phase,'result');
      assert(!result.vfx.activeVideo,'settlement pauses and retires the active video');
      assert.equal(await p.locator('.battle-vfx-decoder').count(),0,'settlement releases decoder elements');
      await battle(p,'return').click();
      await action(p,'home').click();
    }
    await noLayers();
    const retired=await p.evaluate(()=>cinemaProbe.retired);
    assert.deepEqual(retired,{disposed:true,canvasRemoved:true,decoders:0});
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
    const weapons=spec.name==='desktop'?await verifyWeapons(p,spec,helpers):null;
    assert.deepEqual(newRequests(),[],'menus keep cinema art off the network');
    const stage=await geometry(p,spec);
    await start();
    const ready=await p.evaluate(()=>Sky.battlePage.inspect());
    assert.equal(ready.renderer,canvas?'canvas2d':'pixi-webgl');
    assert.equal(ready.cinema.supported,!light);

    const rally={};
    if(fallback){
      await call({kind:'fallback',hero:'h01'});
      await cast('h01');
      const {cut}=await readCut(p,'h01',{fallback:light});
      await cut.locator('.battle-cut-skip').click();
      await capture('cinema-fallback');
      await p.waitForFunction(()=>cinemaProbe.hits.some(hit=>hit.hero==='h01' && hit.finisher));
      const trace=await read();
      assert(trace.frames.every(f=>!f.media && !f.shatter && !f.fx?.visible));
      assert(trace.frames.some(f=>f.active.some(fx=>fx.hero==='h01')),'the nine-grid fallback is visible');
      if(light)assert.deepEqual(newRequests(),[],'power save and Canvas2D request no heavy cinema art');
      assert(!requests.some(url=>videoRequest.test(url)),'file and light modes avoid the CG decoder');
      rally.h01={fallback:true,hits:trace.hits.filter(hit=>hit.hero==='h01')};
      await settle();
    }else{
      const readyDomains=new Set(requests.filter(url=>domainRequest.test(url)).map(url=>url.split('/').at(-1)));
      assert.deepEqual([...readyDomains].sort(),formation.map(id=>'domain_'+id+'.png').sort());
      await p.waitForFunction(()=>['h01','h08'].every(id=>Sky.battlePage.inspect().vfx.vfxVideos?.includes(id)));
      for(const id of ['h01','h08']){
        await reset();
        await cast(id);
        const {cut,actual}=await readCut(p,id);
        if(spec.mobile && id==='h01'){
          assert(actual.sides.some(side=>side.matte && side.mask.includes('gradient')));
          await shot('cinema-cutin-'+id);
        }
        if(spec.name==='desktop' && id==='h01')await cut.waitFor({state:'detached',timeout:6000});
        else await cut.locator('.battle-cut-skip').click();
        await p.locator('#bleed .battle-domain[data-hero="'+id+'"]').waitFor({state:'attached'});
        await noLayers();
        await p.waitForFunction(id=>cinemaProbe.frames.at(-1)?.domain===null &&
          cinemaProbe.frames.some(frame=>frame.domain?.id===id && frame.domain.phase==='fading'),id);
        const trace=await read();
        rally[id]={cut:actual,domain:measureDomain(trace,id,spec,2850/rate-100),video:measureVideo(trace,id,rate)};
      }
      await settle();

      if(rate===1){
        await start();
        for(const id of ['h01','h08']){
          await reset();
          await call({kind:'video',hero:id,...videoShots[id][0]});
          await cast(id);
          const {cut}=await readCut(p,id);
          await cut.locator('.battle-cut-skip').click();
          const earlier=videoShots[id][0],later=videoShots[id][1];
          verifyPixels(await capture(earlier.label),earlier);
          await call({kind:'video',hero:id,...later});
          verifyPixels(await capture(later.label),later);
          await noLayers();
        }
        await settle();
      }

      if(spec.name==='desktop'){
        await start();
        await call({kind:'domain',hero:'h02'});
        await cast('h02');
        const {cut}=await readCut(p,'h02');
        await cut.locator('.battle-cut-skip').click();
        const sample=await capture('cg-h02-atlas-fallback');
        assert(!sample.media && sample.active.some(fx=>fx.hero==='h02'),'unconfigured h02 plays atlas');
        await settle();

        await start();
        await p.evaluate(()=>{
          const clip=[...document.querySelectorAll('.battle-vfx-decoder')]
            .find(video=>video.src.includes('/vfx_h08.mp4'));
          Object.defineProperty(clip,'readyState',{configurable:true,get:()=>1});
        });
        await call({kind:'domain',hero:'h08'});
        await cast('h08');
        const coldCut=await readCut(p,'h08');
        await coldCut.cut.locator('.battle-cut-skip').click();
        const cold=await capture('cg-h08-not-ready-fallback');
        assert(!cold.media && cold.active.some(fx=>fx.hero==='h08'),'unready original CG plays atlas');
        await settle();

        await start();
        await cast('h01');
        const stalledCut=await readCut(p,'h01');
        await stalledCut.cut.locator('.battle-cut-skip').click();
        await p.waitForFunction(()=>Sky.battlePage.inspect()?.vfx.activeVideo?.presentedMediaTime>=.48);
        const clip=await p.locator('.battle-vfx-decoder[src*="vfx_h01.mp4"]').evaluate(video=>{
          video.pause();return video.currentTime;
        });
        await p.waitForFunction(()=>cinemaProbe.hits.some(hit=>hit.hero==='h01' && hit.finisher));
        const stalled=await read();
        const recovered=stalled.hits.filter(hit=>hit.hero==='h01' && hit.target[0]==='e');
        assert.deepEqual(recovered.map(hit=>hit.due),cues.h01,'fallback never duplicates or loses a damage beat');
        assert(recovered[0].media?.heroId==='h01' && recovered.slice(1).every(hit=>!hit.media));
        assert(stalled.frames.some(frame=>frame.active.some(fx=>fx.hero==='h01')));
        rally.stalled={pausedAt:clip,hits:recovered.map(hit=>({due:hit.due,video:!!hit.media,amount:hit.amount}))};
        await settle();

        await start();
        await cast('h08');
        const skipCut=await readCut(p,'h08');
        await skipCut.cut.locator('.battle-cut-skip').click();
        await p.waitForFunction(()=>Sky.battlePage.inspect()?.vfx.activeVideo?.presentedMediaTime>=.4);
        await settle();
        rally.skipWhileActive=true;

        await start({
          encounter:'arena',enemyRage:true,formation:['h01','h02','h04','h05','h06','h10']
        });
        const mirrorShot={kind:'video',hero:'h08',at:1.05,color:'cyan',mirror:true,label:'cg-h08-enemy-mirror'};
        await call(mirrorShot);
        const mirrored=await capture(mirrorShot.label);
        verifyPixels(mirrored,mirrorShot);
        assert.equal(mirrored.media.mirror,true);
        assert(requests.some(url=>url.endsWith('/vfx_h08.mp4')),'arena loads CG for an enemy not in formation');
        await settle('leave');
      }
    }
    const embedded=spec.file?await verifyBattleArt(p):null;
    assert.deepEqual(requests.filter(url=>crackRequest.test(url)),[],'disabled crack never requested');
    assert.equal(await p.locator('.battle-shatter').count(),0);
    assert.deepEqual([...new Set(issues)],[]);
    return {name:spec.name,stage,rate,renderer:ready.renderer,resolution:ready.resolution,fallback,lobbyNewRequests,
      requestedDomains:[...new Set(requests.filter(url=>domainRequest.test(url)).map(url=>url.split('/').at(-1)))].sort(),
      requestedClips:[...new Set(requests.filter(url=>videoRequest.test(url)).map(url=>url.split('/').at(-1)))].sort(),
      crackRequests:requests.filter(url=>crackRequest.test(url)).length,weapons,rally,shots,embedded,errors:issues};
  }catch(error){
    const diagnostic=await p.evaluate(()=>({state:window.Sky?.battlePage?.inspect(),
      last:window.cinemaProbe?.frames.slice(-2),request:window.cinemaProbe?.request,held:window.cinemaProbe?.held})).catch(()=>null);
    if(out)await shot('cinema-failure').catch(()=>{});
    throw new Error(spec.name+' '+error.message+'\n'+JSON.stringify({diagnostic,issues:[...new Set(issues)]}),{cause:error});
  }finally{await context.close();}
}

module.exports={runDomainCinema};
