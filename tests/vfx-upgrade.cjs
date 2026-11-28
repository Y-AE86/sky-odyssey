'use strict';
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');

// The capture probe holds a completed draw only for screenshots. Timing runs
// use a separate battle and let the real renderer advance without any waits
// inside its frame callbacks.
function installProbe(){
  window.effectUpgrade?.restore();
  const proto=Sky.BattleScene.prototype;
  const {render,hit,advanceClock,destroy}=proto;
  const log={capture:null,held:null,frames:[],hits:[],pending:[],retired:null};
  window.effectUpgrade=log;
  function embers(scene){return scene.vfx?.inspect().embers || [];}
  proto.hit=function(actor,entry,element,ultimate,now){
    log.pending.push({actor,hero:this.byKey[actor]?.heroId,target:entry.target,kind:entry.kind,
      amount:entry.amount,ultimate,at:now,critical:!!entry.crit,finisher:!!arguments[8]?.finisher});
    return hit.apply(this,arguments);
  };
  proto.advanceClock=function(){
    if(log.held)return 0;
    return advanceClock.apply(this,arguments);
  };
  proto.render=function(now,clock){
    if(log.held)return;
    const start=performance.now();
    render.apply(this,arguments);
    const submit=performance.now()-start;
    log.scene=this;
    if(!this.ready)return;
    const passes=this.battleCamera?.filters?.length || 0;
    const filterState=passes ? this.impulses?.inspect() : null;
    const filters=filterState?.active.length || 0;
    const atlas=[...this.vfx?.active || []].filter(({info})=>info.heroId==='h01' && info.frame!==null);
    const spark=[...this.vfx?.active || []].find(({info})=>info.key==='spark' && info.frame!==null);
    const info=entry=>{
      const {frame,sub,blend,nextFrame,scale,angle,startedAt}=entry.info;
      return {frame,sub,blend,nextFrame,scale,angle,startedAt,alpha:entry.sprite.alpha,
        nextAlpha:entry.info.nextAlpha,blendMode:entry.sprite.blendMode};
    };
    const liveEmbers=embers(this).filter(item=>item.key==='h01');
    const frame={now,clock,submit,passes,filters,filterState,atlas:atlas.map(info),spark:spark?info(spark):null,
      embers:liveEmbers.map(item=>({...item}))};
    log.frames.push(frame);
    const hits=log.pending.splice(0);
    for(const current of hits){
      const onFrame=[...this.vfx?.active || []]
        .map(({info})=>info).filter(info=>info.impactAt===current.at && info.actor===current.actor &&
          (info.target===current.target || info.targets?.includes(current.target)));
      const matching=onFrame.map(info=>({key:info.key,frame:info.frame,frames:[...info.frames],blend:info.blend,
        impactAt:info.impactAt,renderedImpactAt:info.renderedImpactAt,source:info.source}));
      log.hits.push({...current,drawAt:now,clock,atlas:matching,filters});
    }
    const last=log.hits.findLast(item=>item.hero==='h01' && item.target==='e1' && item.finisher);
    const boss=this.byKey.e1;
    const capture=log.capture;
    const wantsFlash=capture==='boss-flash' && boss?.pose?.white &&
      hits.some(item=>item.target==='e1' && item.actor==='a1' && !item.ultimate);
    const wantsImpact=capture==='shockwave-split' && last && now-last.at>=30 && now-last.at<=90 &&
      (log.baseline || filters>=2);
    const wantsTail=capture==='ember-tail' && last && !atlas.length &&
      (log.baseline ? (clock-last.clock)>=520 : liveEmbers.some(item=>item.atlasEndedAt!=null && item.visible>0));
    const wantsHealing=capture==='h10-heal-total' && hits.some(item=>item.hero==='h10' && item.kind==='heal' && item.ultimate);
    if(wantsFlash || wantsImpact || wantsTail || wantsHealing){
      const box=boss?.sprite?.getBounds();
      const host=this.host.getBoundingClientRect();
      log.held={name:capture,now,clock,filters,filterState:this.inspect().camera.filters || null,
        embers:liveEmbers,atlas:frame.atlas,bossWhite:!!boss?.pose?.white,
        boss:box ? {x:box.x+host.x,y:box.y+host.y,width:box.width,height:box.height}:null};
      log.capture=null;
    }
  };
  proto.destroy=function(){
    const answer=destroy.apply(this,arguments);
    log.retired={disposed:this.disposed,cameraDetached:!this.battleCamera?.filters?.length,
      noEmbers:embers(this).length===0,canvasRemoved:!this.canvas.isConnected};
    return answer;
  };
  log.restore=()=>{
    Object.assign(proto,{render,hit,advanceClock,destroy});
    delete window.effectUpgrade;
  };
}

const decimal=(n,d=2)=>Number(n.toFixed(d));
function frameStats(rows,state){
  const pairs=rows.flatMap((row,i)=>i && state(row) && state(rows[i-1]) ? [row.now-rows[i-1].now]:[]);
  if(!pairs.length)return null;
  const sorted=[...pairs].sort((a,b)=>a-b);
  const pct=p=>decimal(sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)]);
  const submits=rows.filter(state).map(row=>row.submit).sort((a,b)=>a-b);
  return {intervals:sorted.length,fps:decimal(1000*pairs.length/pairs.reduce((a,b)=>a+b,0)),
    p50Ms:pct(.50),p95Ms:pct(.95),p99Ms:pct(.99),maxMs:pct(1),above25Ms:sorted.filter(ms=>ms>25).length,
    above50Ms:sorted.filter(ms=>ms>50).length,submitP95Ms:decimal(submits[Math.ceil(submits.length*.95)-1])};
}
const effectsReady=p=>p.waitForFunction(()=>window.effectUpgrade?.scene?.ready &&
  ['h01','h10','spark'].every(id=>Sky.battlePage.inspect().vfx.ready.includes(id)));
const countResult=p=>p.locator('.battle-result').waitFor();

async function runVfxUpgrade(browser,origin,spec,options,helpers){
  const {action,panel,battle,geometry,startFullVfxFixture,screenshot,queueVfxCast}=helpers;
  const {baseline,root,out}=options;
  const context=await browser.newContext({viewport:{width:spec.width,height:spec.height},deviceScaleFactor:spec.dpr,
    isMobile:!!spec.mobile,hasTouch:!!spec.mobile});
  const errors=[],requests=[];
  try{
    const p=await context.newPage();
    p.setDefaultTimeout(12000);
    p.on('pageerror',e=>errors.push(e.message));
    const shaderLog=[];
    p.on('console',m=>{
      if(m.type()==='error')errors.push(m.text());
      if(/shader|GLSL|ERROR: \d+:\d+/.test(m.text()))shaderLog.push(m.text());
    });
    p.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});
    p.on('requestfailed',r=>{if(r.failure()?.errorText!=='net::ERR_ABORTED')errors.push(r.url()+' '+r.failure()?.errorText);});
    p.on('request',r=>{
      const url=r.url(); requests.push(url);
      if(/^https?:/.test(url) && (spec.file || new URL(url).origin!==origin))errors.push('external '+url);
    });
    if(spec.mobile){
      const cdp=await context.newCDPSession(p);
      await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{left:44,right:35,top:0,bottom:0}});
    }
    await p.goto(spec.file?pathToFileURL(path.join(root,'index.html')).href:origin);
    await p.waitForFunction(()=>Sky.ui?.state);
    await p.evaluate(()=>Sky.battleRenderer?.load());
    await p.evaluate(installProbe);
    await p.evaluate(baseline=>effectUpgrade.baseline=baseline,baseline);
    const stage=await geometry(p,spec);
    const fallback=spec.name==='power' || spec.name==='canvas';
    const powerSave=spec.name==='power';
    const captures={};
    const shot=async label=>screenshot(p,spec,(baseline?'before-':'after-')+label);
    const formation=['h06','h01','h04','h10','h02','h08'];
    const start=async()=>{
      await p.evaluate(()=>Object.assign(effectUpgrade,{frames:[],hits:[],pending:[],held:null,capture:null}));
      await startFullVfxFixture(p,{formation,powerSave});
      if(!fallback)await effectsReady(p);
    };
    const settle=async()=>{
      await p.evaluate(()=>effectUpgrade.held=null);
      await battle(p,'skip').click();
      await countResult(p);
      const state=await p.evaluate(()=>({
        filters:effectUpgrade.scene.battleCamera?.filters || null,
        active:Sky.battlePage.inspect().vfx.active.length,
        atlas:Sky.battlePage.inspect().vfx.ready.length,
        embers:Sky.battlePage.inspect().vfx.embers?.length || 0
      }));
      assert.deepEqual(state,{filters:null,active:0,atlas:0,embers:0});
      await battle(p,'return').click();
      await action(p,'home').click();
      const retired=await p.evaluate(()=>effectUpgrade.retired);
      assert.deepEqual(retired,{disposed:true,cameraDetached:true,noEmbers:true,canvasRemoved:true});
      return {settled:state,destroyed:retired};
    };
    const waitHit=()=>p.waitForFunction(()=>effectUpgrade.hits.some(item=>item.hero==='h01' &&
      item.target==='e1' && item.ultimate && item.finisher));
    await start();
    const {renderer,resolution,canvas}=await p.evaluate(()=>Sky.battlePage.inspect());
    assert.equal(renderer,spec.name==='canvas'?'canvas2d':'pixi-webgl');
    assert.equal(resolution,spec.dpr);
    const gpu=await p.evaluate(()=>{
      const gl=effectUpgrade.scene.app?.renderer.gl, info=gl?.getExtension('WEBGL_debug_renderer_info');
      return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL):null;
    });
    await p.waitForTimeout(850);
    const idleStart=await p.evaluate(()=>performance.now());
    await p.waitForTimeout(950);
    const idleEnd=await p.evaluate(()=>performance.now());
    await queueVfxCast(p,1,'h01',fallback);
    await waitHit();
    await p.waitForTimeout(fallback?340:1150);
    const trace=await p.evaluate(()=>({frames:effectUpgrade.frames,hits:effectUpgrade.hits}));
    const deadline=trace.hits.findLast(item=>item.hero==='h01' && item.target==='e1' && item.finisher);
    const cinematic=trace.hits.filter(item=>item.hero==='h01' && item.ultimate && item.target==='e1');
    assert.equal(cinematic.length,3);
    const h01=trace.frames.filter(row=>row.now>deadline.at-800 && row.now<deadline.at+1100);
    const quiet=trace.frames.filter(row=>row.now>=idleStart && row.now<idleEnd);
    const active=row=>row.atlas.length>0 || row.embers.length>0 || row.filters>0;
    const perf={quiet:frameStats(quiet,()=>true),active:frameStats(h01,active),filter:frameStats(h01,row=>row.filters>0)};
    const blendFrames=h01.flatMap(row=>row.atlas).filter(info=>info.blend>0 && info.blend<1 && info.nextAlpha>0);
    const sparkBlends=trace.frames.filter(row=>row.spark?.blend>0 && row.spark.blend<1).length;
    const tail=h01.filter(row=>!row.atlas.length && row.embers.some(item=>item.visible>0 && item.atlasEndedAt!=null));
    const impactSamples=cinematic.map(item=>({amount:item.amount,at:item.at,drawAt:item.drawAt,info:item.atlas.find(info=>info.key==='h01') || null,
      filters:item.filters}));
    if(fallback){
      assert(trace.frames.every(row=>!row.filters && !row.embers.length && !row.atlas.length));
      assert(!requests.some(url=>url.includes('/assets/vfx/') || /offline-(vfx|battle-art)/.test(url)));
    }else if(!baseline){
      for(const {at,drawAt,info} of impactSamples){
        assert(info,'authored h01 hit');
        assert.equal(info.frame,3);assert.equal(info.frames.at(-1),3);
        assert.equal(info.blend,0);
        assert.equal(info.renderedImpactAt,drawAt);assert.equal(info.impactAt,at);assert.equal(at,drawAt);
        assert.equal(info.source,spec.file?'embedded':'png');
      }
      assert(blendFrames.length>=2 && sparkBlends>=1,'paired opacity transitions must be rendered');
      assert(blendFrames.every(info=>info.nextFrame===info.frame+1 && info.blendMode===1));
      // The solver emits the same cell at several scales before proceeding.
      assert(h01.some((row,i)=>i && row.atlas.some(info=>h01[i-1].atlas.some(prior=>
        prior.startedAt===info.startedAt && prior.frame===info.frame && Math.abs(prior.scale-info.scale)>.000001))));
      assert(deadline.filters>=2 && h01.some(row=>row.now>deadline.at+280 && row.passes===0));
      const phases=h01.filter(row=>row.now>=deadline.at && row.filterState);
      assert(phases.some(row=>row.filterState.active.length===2 && row.passes===1));
      assert(phases.some(row=>row.filterState.active.join(',')==='shockwave'));
      assert(phases.some(row=>row.filterState.chromatic?.duration===100 && row.filterState.chromatic.offset>=3));
      assert(phases.some(row=>row.filterState.shockwave?.duration===260 && row.filterState.shockwave.radius>30));
      assert(tail.length && tail.some(row=>row.embers.some(item=>item.count>=14 && item.count<=22)));
      assert(h01.some(row=>row.now>tail[0].now+450 && !row.embers.length),'ember group retires on its own');
    }
    const cleanup=await settle();

    async function hold(label,cast){
      await p.evaluate(label=>effectUpgrade.capture=label,label);
      if(cast)await queueVfxCast(p,formation.indexOf(cast),cast,fallback);
      await p.waitForFunction(()=>effectUpgrade.held);
      if(label==='h10-heal-total'){
        captures.heal=await p.locator('.battle-total').evaluate(total=>{
          const value=total.querySelector('strong'),tag=total.querySelector('.battle-hits');
          // The pulse returns to its normal size after showing the same first number.
          for(const animation of value.getAnimations())animation.finish();
          return {kind:total.dataset.kind,value:value.textContent,text:tag.textContent,
            gap:tag.getBoundingClientRect().top-value.getBoundingClientRect().bottom,
            top:getComputedStyle(tag).top};
        });
        assert.equal(captures.heal.kind,'heal');
        assert.equal(captures.heal.text,'1 次施加');
      }
      captures[label]=await p.evaluate(()=>effectUpgrade.held);
      await shot(label);
      if(label==='shockwave-split' && spec.name==='desktop' && !baseline){
        captures.atlasDrawing=await p.evaluate(()=>{
          const scene=effectUpgrade.scene, gl=scene.app.renderer.gl;
          const swaps=[];
          for(const {atlas,sprite,next,info} of scene.vfx.active){
            for(const [view,index] of [[sprite,info.frame],[next,info.nextFrame]]){
              const full=index==null ? null : atlas.frames[index];
              if(view.visible && full && view.texture!==full)swaps.push({view,full,trim:view.texture});
            }
          }
          function pixels(){
            scene.app.render();
            const result=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);
            gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,result);
            return result;
          }
          const cropped=pixels();
          let full;
          try {
            for(const swap of swaps)swap.view.texture=swap.full;
            full=pixels();
          }finally{
            for(const swap of swaps)swap.view.texture=swap.trim;
            scene.app.render();
          }
          let changed8=0,maxChannelDelta=0;
          for(let i=0;i<full.length;i+=4){
            const delta=Math.max(Math.abs(full[i]-cropped[i]),Math.abs(full[i+1]-cropped[i+1]),
              Math.abs(full[i+2]-cropped[i+2]),Math.abs(full[i+3]-cropped[i+3]));
            if(delta>=8)changed8++;
            maxChannelDelta=Math.max(maxChannelDelta,delta);
          }
          return {draws:swaps.length,pixels:full.length/4,changed8,maxChannelDelta};
        });
        assert(captures.atlasDrawing.draws>0 && captures.atlasDrawing.changed8<=2,
          'trimmed transparent atlas quads must preserve the visible picture');
        await p.evaluate(()=>{
          const scene=effectUpgrade.scene;
          effectUpgrade.shaderPasses=scene.battleCamera.filters;
          scene.battleCamera.filters=null;
          scene.app.render();
        });
        await shot('shockwave-split-same-frame-unfiltered');
        await p.evaluate(()=>{
          const scene=effectUpgrade.scene;
          scene.battleCamera.filters=effectUpgrade.shaderPasses;
          effectUpgrade.shaderPasses=null;
          scene.app.render();
        });
      }
      if(label==='ember-tail' && !baseline){
        cleanup.midEmberClear=await p.evaluate(()=>{
          const {vfx}=effectUpgrade.scene;
          vfx.clear();
          return {embers:vfx.inspect().embers.length,active:vfx.active.size};
        });
        assert.deepEqual(cleanup.midEmberClear,{embers:0,active:0});
      }
      await p.evaluate(()=>effectUpgrade.held=null);
    }

    if(out && !fallback && (!baseline || ['desktop','mobile'].includes(spec.name))){
      await start();
      if(spec.name==='desktop')await hold('boss-flash');
      await hold('shockwave-split','h01');
      if(spec.name==='desktop'){
        await hold('ember-tail');
        await hold('h10-heal-total','h10');
      }
      await settle();
      if(spec.mobile){
        await action(p,'roster').click();
        await panel(p,'hero','h08').click();
        await p.locator('.pn-portrait img').evaluate(img=>img.decode());
        await p.locator('#toast').waitFor({state:'hidden'});
        captures.roster=await p.locator('.pn-portrait.art').evaluate(el=>({
          mask:getComputedStyle(el).maskImage,composition:getComputedStyle(el).maskComposite}));
        if(!baseline)assert(captures.roster.mask.includes('rgba(0, 0, 0, 0) 0%'));
        await shot('mobile-roster-art');
      }
    }
    if(fallback && out){
      await start();await queueVfxCast(p,1,'h01',true);await waitHit();await shot('fallback');await settle();
    }
    if(spec.name==='desktop' && !baseline){
      await start();
      await p.evaluate(()=>effectUpgrade.capture='shockwave-split');
      await queueVfxCast(p,1,'h01',false);
      await p.waitForFunction(()=>effectUpgrade.held);
      cleanup.leaveDuringImpact=await p.evaluate(()=>{
        if(!effectUpgrade.scene.battleCamera.filters?.length)throw new Error('Expected a live shader');
        effectUpgrade.held=null;
        Sky.ui.go('lobby');
        return effectUpgrade.retired;
      });
      assert.deepEqual(cleanup.leaveDuringImpact,cleanup.destroyed);
    }
    assert.deepEqual(errors,[],JSON.stringify({errors,shaderLog}));
    const clearAfter=name=>{
      const clear=h01.find(row=>row.now>deadline.at && !row.filterState?.active.includes(name));
      return !baseline && !fallback && clear ? decimal(clear.now-deadline.at) : null;
    };
    return {name:spec.name,baseline,stage,renderer,resolution,canvas,gpu,perf,impactSamples,captures,cleanup,
      blends:{example:blendFrames[0] || null,frames:blendFrames.length,sparkFrames:sparkBlends},
      embers:{firstTail:tail[0]?.embers || [],sampledTailMs:tail.length ? decimal(tail.at(-1).now-tail[0].now):0},
      shader:{peakFilters:Math.max(...trace.frames.map(row=>row.filters)),
        peakPasses:Math.max(...trace.frames.map(row=>row.passes)),
        peakOffsets:Math.max(0,...h01.map(row=>row.filterState?.chromatic?.offset || 0)),
        chromaticClearMs:clearAfter('chromatic'),shockwaveClearMs:clearAfter('shockwave'),
        simultaneousFrames:trace.frames.filter(row=>row.filters>=2).length},
      fallback,errors};
  }finally{await context.close();}
}

module.exports={runVfxUpgrade};
