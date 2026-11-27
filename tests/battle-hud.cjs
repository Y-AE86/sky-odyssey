'use strict';
const assert=require('node:assert/strict');

const leads=['h01','h02','h03','h04','h05','h06'];
const statuses=['status_shield','status_freeze','status_curse','status_heal_ring'];
const allArt=[...leads.map(id=>'proj_'+id),...statuses];

async function observeBattle(p){
  await p.evaluate(()=>{
    const proto=Sky.BattleScene.prototype, render=proto.render;
    const raf=window.requestAnimationFrame, root=document.querySelector('.battle-page');
    const cast=Sky.Battle.cast;
    // Exercise the real critical roll in a reproducible three-strike capture.
    // Only replace this cast's RNG input, never its result, labels or animation.
    Sky.Battle.cast=(fight,slot)=>{
      if(fight.units.find(unit=>unit.side==='ally' && unit.slot===slot)?.heroId!=='h01')return cast(fight,slot);
      const rng=fight.rng,rolls=[.92,.43,.81];
      fight.rng=()=>rolls.shift()??rng();
      try{return cast(fight,slot);}finally{fight.rng=rng;}
    };
    const log=window.__hudTest={
      requested:null,held:null,photos:{},projectiles:{},statuses:{},gaps:[],impacts:[],camera:[],finals:[],criticals:0,
      composition:{rightEdge:null,allEdges:null,kickEdge:null,freezeTop:null}
    };
    const infoFor=(node)=>{
      const r=node.getBoundingClientRect();
      return {x:r.left,y:r.top,w:r.width,h:r.height,right:r.right,bottom:r.bottom};
    };
    let savedAnims=[],lastImpact=null;
    const resume=()=>{
      log.held=null;log.requested=null;
      for(const a of savedAnims)if(a.playState==='paused')a.play();
      savedAnims=[];
    };
    // Keep a presented frame and its DOM animations intact while Playwright copies pixels.
    // All inputs, hit resolution and rendering before this point use the real game loop.
    window.requestAnimationFrame=callback=>raf.call(window,function present(t){
      if(log.held)raf.call(window,present);
      else callback(t);
    });
    function sample(t){
      if(!root.contains(this.host))return;
      const view=this.inspect(), vfx=view.vfx;
      const canvas=this.canvas.getBoundingClientRect();
      const c=view.camera;
      const pickMin=(key,next,field)=>{
        if(!log.composition[key] || next[field]<log.composition[key][field])log.composition[key]=next;
      };
      const bodies={};
      for(const node of this.nodes){
        if(!node.sprite?.visible)continue;
        const {x,y,width,height}=node.sprite.getBounds(true);
        const body=bodies[node.key]={key:node.key,x,y,width,height,left:x,right:canvas.width-x-width};
        const margin=Math.min(body.left,body.right);
        pickMin('allEdges',{key:node.key,margin,zoom:c.zoom,kick:c.kick},'margin');
        if(node.key==='e5') {
          pickMin('rightEdge',{...body,zoom:c.zoom,kick:c.kick},'right');
          if(c.kick && c.focus>.25)pickMin('kickEdge',{...body,zoom:c.zoom,kick:c.kick},'right');
        }
      }
      for(const shot of vfx.projectiles||[]){
        const key=shot.key+'-'+shot.actor[0];
        const samples=log.projectiles[key] ||= [];
        if(!samples.length || Math.abs(shot.progress-samples.at(-1).progress)>.08){
          if(samples.length<40)samples.push({...shot,t});
        }
      }
      for(const state of vfx.statuses||[]){
        const key=state.key+'-'+state.target;
        const saved=log.statuses[key] ||= {first:{...state},last:null,phases:[],motion:0};
        saved.last={...state};
        saved.motion=Math.max(saved.motion,Math.abs(state.rotation-saved.first.rotation));
        if(!saved.phases.includes(state.phase))saved.phases.push(state.phase);
      }
      const placed=[...this.vfx.statuses.values()].flatMap(state=>{
        const body=bodies[state.target];
        if(!body)return [];
        const bounds=state.view.getBounds(true);
        const relativeTop=(bounds.top-body.y)/body.height;
        const sample={key:state.key,target:state.target,alpha:state.view.worldAlpha,relativeTop,
          width:bounds.width,height:bounds.height,y:bounds.y,releasing:state.ending!==null};
        if(state.key==='status_freeze' && bounds.height>0)pickMin('freezeTop',sample,'relativeTop');
        return [sample];
      });
      if(c && log.camera.length<600)log.camera.push({t,zoom:c.zoom,kick:c.kick,hold:c.hitstopRemaining});
      const impact=view.impact;
      if(impact?.actor){
        const stamp=[impact.actor,impact.target,impact.hold,impact.critical,impact.finisher].join('/');
        if(lastImpact!==stamp){
          log.impacts.push({...impact,t});
          lastImpact=stamp;
        }
      }
      const labels=[...root.querySelectorAll('.battle-float[data-target]')];
      const positions=labels.map(el=>{
        const r=infoFor(el),f=this.flagPoint(el.dataset.target);
        const gap=canvas.top+f.y-r.bottom;
        if(r.w>0 && this.byKey[el.dataset.target].hp>0 && log.gaps.length<8000)
          log.gaps.push({gap,target:el.dataset.target,kind:el.className});
        return {target:el.dataset.target,text:el.textContent,kind:el.className,box:r,gap,fontSize:parseFloat(getComputedStyle(el).fontSize)};
      });
      if(labels.some(el=>el.matches('.critical')))log.criticals++;
      const final=vfx.active.find(a=>a.finisher && a.frame>=3);
      if(final && !log.finals.some(e=>e.key===final.key))log.finals.push({...final});
      const shots=vfx.projectiles||[], rings=vfx.statuses||[];
      let capture=false;
      switch(log.requested){
        case 'hud-ready':
          capture=root.querySelectorAll('.battle-card.is-charged').length>=4 && rings.some(r=>r.key==='status_freeze') &&
            rings.some(r=>r.key==='status_shield') && rings.some(r=>r.key==='status_curse');break;
        case 'basic-flight':
          capture=shots.some(s=>s.actor[0]==='a' && s.progress>.34 && s.progress<.81);break;
        case 'combo-finish':{
          const combo=labels.filter(el=>el.matches('.combo-hit') && el.dataset.target[0]==='e');
          const last=combo.at(-1);
          capture=vfx.active.some(a=>a.key==='h01' && a.actor[0]==='a' && a.finisher && a.frame>=3 && a.frame<=5) &&
            combo.length>=2 && new DOMMatrix(getComputedStyle(last).transform).a>=1.1;
          break;
        }
        case 'heal-ring':
          capture=rings.some(s=>s.key==='status_heal_ring') && labels.filter(el=>el.matches('.heal') && el.textContent!=='+0').length>=3 &&
            vfx.active.some(a=>a.key==='h03' && a.actor[0]==='a' && a.frame===4);break;
        case 'shield':
          capture=rings.filter(s=>s.key==='status_shield' && s.target[0]==='a' && s.phase==='active').length>=3 &&
            vfx.active.some(a=>a.key==='h04' && a.actor[0]==='a' && a.frame===3);break;
        case 'right-edge':
          capture=c.kick && c.focus>.25 && impact?.actor==='a5' && impact.target==='e5' &&
            vfx.active.some(a=>a.key==='h06' && a.actor==='a5' && a.target==='e5' && a.frame===3);break;
      }
      if(capture && !log.held){
        const total=root.querySelector('.battle-total'), counter=total.querySelector('strong');
        const css=getComputedStyle(total);
        log.held=log.requested;
        log.photos[log.held]={positions,shots,rings,placed,bodies,camera:c,impact,
          active:[...this.vfx.active].filter(({sprite})=>sprite.visible).map(({info:a,sprite})=>
            ({key:a.key,role:a.role,frame:a.frame,finisher:a.finisher,magnification:a.magnification,alpha:sprite.worldAlpha})),
          total:{hidden:total.hidden,text:total.innerText,background:css.backgroundColor,border:css.borderTopWidth,
            box:infoFor(total),number:infoFor(counter)},stage:infoFor(this.canvas)};
        savedAnims=root.getAnimations({subtree:true}).filter(a=>a.playState==='running');
        for(const animation of savedAnims)animation.pause();
      }
    }
    proto.render=function(...args){
      const result=render.apply(this,args);
      // HUD text is laid out against the freshly presented camera in this same task.
      queueMicrotask(()=>sample.call(this,args[0]));
      return result;
    };
    window.__hudResume=resume;
    window.__hudRestore=()=>{resume();window.requestAnimationFrame=raf;proto.render=render;Sky.Battle.cast=cast;};
  });
}

async function checkPowerHud(p){
  const view=await p.evaluate(()=>Sky.battlePage.inspect());
  assert.equal(view.camera.zoom,1);
  assert.equal(view.camera.hitstopRemaining,0);
  assert.equal(Boolean(view.camera.kick),false);
  assert.deepEqual(view.vfx.artReady??[],[]);
  return {zoom:view.camera.zoom,kick:view.camera.kick,hold:view.camera.hitstopRemaining};
}

async function exerciseHud(p,spec,{startFullVfxFixture,queueVfxCast,battle,action,screenshot}){
  await startFullVfxFixture(p,{formation:leads,shield:false,statuses:true});
  await p.waitForFunction(keys=>keys.every(k=>Sky.battlePage.inspect()?.vfx.artReady.includes(k)),allArt);
  const stage=await p.evaluate(()=>{
    const box=el=>{const b=el.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height,right:b.right,bottom:b.bottom};};
    const head=document.querySelector('.battle-head'),buttons=[...head.querySelectorAll('button')];
    const cards=[...document.querySelectorAll('.battle-card')], stage=box(document.querySelector('.battle-stage'));
    const info=Sky.battlePage.inspect();
    return {round:head.querySelector('.battle-round').textContent,title:head.querySelector('.battle-title').textContent,
      oldLog:!!document.querySelector('.battle-log,.battle-allegiance'),stage,canvas:info.canvas,layers:info.layers,
      buttons:buttons.map(el=>({label:el.innerText,action:el.dataset.action || el.dataset.battle,
        box:box(el),radius:getComputedStyle(el).borderRadius})),
      cards:cards.map(el=>({box:box(el),label:el.innerText,diamonds:el.querySelectorAll('.badge-rage i').length,
        hp:getComputedStyle(el.querySelector('.badge-hp')).height,portrait:!!el.querySelector('img.portrait'),name:el.getAttribute('aria-label')}))};
  });
  assert.deepEqual(stage.layers,['groundFxLayer','unitLayer','overFxLayer']);
  assert.equal(stage.oldLog,false);assert.match(stage.round,/回合\s*\d+\s*\/\s*20/);assert.match(stage.title,/首领/);
  assert.deepEqual(stage.buttons.map(b=>b.action),['speed','auto','skip','audio-mute']);
  for(const b of stage.buttons){assert(Math.abs(b.box.w-b.box.h)<1);assert(b.box.w>=24 && b.box.w<=46);assert.notEqual(b.radius,'0px');}
  assert.equal(stage.cards.length,6);
  assert(stage.cards.every(c=>c.diamonds===4 && c.portrait && !c.label.includes('/ 100') && !c.label.includes('就绪') && c.name));
  const arm=name=>p.evaluate(name=>{window.__hudTest.requested=name;},name);
  async function take(name){
    await p.waitForFunction(name=>window.__hudTest.held===name,name,{polling:35,timeout:12000});
    await screenshot(p,spec,'hud-'+name);
    await p.evaluate(()=>window.__hudResume());
  }
  try{
    await observeBattle(p);
    await arm('hud-ready');await take('hud-ready');
    await arm('basic-flight');await take('basic-flight');
    // Observe all six basic attacks and the opposite direction before spending rage.
    await p.waitForFunction(ids=>ids.every(id=>Object.keys(window.__hudTest.projectiles).some(k=>k.startsWith('proj_'+id+'-'))) &&
      Object.keys(window.__hudTest.projectiles).some(k=>k.endsWith('-e')),leads,{timeout:30000});
    for(const [slot,name] of [[0,'combo-finish'],[2,'heal-ring'],[3,'shield'],[5,'right-edge']]){
      await arm(name);await queueVfxCast(p,slot,leads[slot],false);await take(name);
    }
    await p.waitForFunction(names=>names.every(name=>Object.values(window.__hudTest.statuses)
      .some(status=>status.first.key===name && status.phases.includes('release'))),statuses,{timeout:25000});
    const report=await p.evaluate(()=>{
      const {photos,projectiles,statuses,impacts,camera,gaps,criticals,finals,composition}=window.__hudTest;
      const sorted=[...gaps].sort((a,b)=>a.gap-b.gap);
      return {photos,projectiles,statuses,impacts,finals,criticals,composition,gapCount:gaps.length,worstGaps:sorted.slice(0,5),
        maxZoom:Math.max(...camera.map(c=>c.zoom)),maxHold:Math.max(...camera.map(c=>c.hold))};
    });
    const source=spec.file?'embedded':'png';
    for(const samples of Object.values(report.projectiles)){
      assert(samples.every(s=>s.source===source && s.blendMode===1 && Number.isFinite(s.rotation)));
    }
    for(const suffix of ['a','e']){
      const flight=Object.entries(report.projectiles).find(([key,samples])=>key.endsWith('-'+suffix) &&
        samples.some((s,i)=>i && s.progress>samples[i-1].progress && Math.sign(s.x-samples[i-1].x)===(suffix==='a'?1:-1)));
      assert(flight,'actual travel from '+suffix+' side');assert(flight[1].some(s=>Math.sign(Math.cos(s.rotation))===(suffix==='a'?1:-1)));
    }
    for(const key of statuses){
      const placed=Object.values(report.statuses).filter(s=>s.first.key===key);assert(placed.length,key);
      const floor=key==='status_curse' || key==='status_heal_ring';
      assert(placed.every(s=>s.first.source===source && s.first.blendMode===1 && s.first.layer===(floor?'ground':'over')));
      if(floor)assert(placed.some(s=>Math.abs(s.first.perspective-.36)<.02 && s.motion>0),key+' spins inside a flattened plane');
    }
    assert(report.maxZoom>=1.09 && report.maxHold>0);
    assert(report.criticals>0 && report.impacts.some(i=>i.finisher && i.hold>=65));
    assert(report.photos['combo-finish'].positions.filter(n=>n.kind.includes('combo-hit') && n.text.includes('暴击')).length===2);
    assert(report.finals.some(f=>f.key==='h01' && f.magnification===1.45));
    const total=report.photos['combo-finish'].total;
    assert(!total.hidden && total.background==='rgba(0, 0, 0, 0)' && total.border==='0px' && /总伤害/.test(total.text));
    const offset=total.box.x+total.box.w/2-stage.stage.x-stage.stage.w/2;
    assert(Math.abs(offset-Math.min(stage.stage.w*.0525,80))<1,'damage total moves right: '+offset);
    const margin=(stage.stage.bottom-total.box.bottom)/stage.stage.h;
    assert(margin>=.165 && margin<=.25,'total remains above the portrait row: '+margin);
    assert(report.gapCount>0 && report.worstGaps[0].gap>=-1,'floating combat text overlaps its HP bar: '+JSON.stringify(report.worstGaps));
    assert(report.composition.rightEdge?.right>=4 && report.composition.kickEdge?.right>=4,
      'rightmost enemy stays in view under kicks: '+JSON.stringify(report.composition));
    assert(report.composition.allEdges?.margin>=4 && report.photos['right-edge'].bodies.e5.right>=4,
      'all unit bounds fit, including a real hit on e5: '+JSON.stringify(report.composition.allEdges));
    assert(report.composition.freezeTop?.relativeTop>=.39,
      'even the uppermost freeze frame stays beneath the upper body: '+JSON.stringify(report.composition.freezeTop));
    for(const [photo,kind,base] of [['heal-ring','heal',.0202],['shield','shield',.0168]]){
      const support=report.photos[photo], labels=support.positions.filter(label=>label.kind==='battle-float '+kind);
      assert(labels.length>0 && labels.every(label=>{
        const ratio=label.fontSize/(base*stage.stage.w);
        return ratio>=1.18 && ratio<=1.22 && label.gap>0;
      }),kind+' label enlargement and blood bar gap: '+JSON.stringify(labels));
      const supportOffset=support.total.box.x+support.total.box.w/2-stage.stage.x-stage.stage.w/2;
      assert(Math.abs(supportOffset)<1,kind+' total remains centred: '+supportOffset);
      const atlas=kind==='heal'?'h03':'h04', statusKey=kind==='heal'?'status_heal_ring':'status_shield';
      const impacts=support.active.filter(frame=>frame.key===atlas && frame.frame===(kind==='heal'?4:3));
      assert(impacts.length && impacts.every(frame=>frame.alpha>0 && frame.alpha<=(frame.role==='group'?.57:.47)),
        kind+' impact atlas has the softer brightness: '+JSON.stringify(impacts));
      assert(support.placed.some(state=>state.key===statusKey && state.alpha>0) &&
        support.placed.filter(state=>state.key===statusKey).every(state=>state.alpha<=(kind==='heal'?.59:.51)),
      kind+' status glow is restrained at impact');
    }
    report.composition.damageTotalOffset=offset;
    await p.evaluate(()=>window.__hudRestore());
    await battle(p,'skip').click();await p.locator('.battle-result').waitFor();
    const settled=await p.evaluate(()=>Sky.battlePage.inspect());
    assert(settled.settled && !settled.vfx.active.length && !settled.vfx.artReady.length && !settled.vfx.statuses.length && !settled.vfx.projectiles.length);
    await battle(p,'return').click();await action(p,'home').click();
    return {stage,...report,settled:true};
  } finally {await p.evaluate(()=>window.__hudRestore?.());}
}
module.exports={exerciseHud,checkPowerHud};

