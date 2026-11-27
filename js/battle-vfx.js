(() => {
  'use strict';
  const Sky=window.Sky, P=window.PIXI;
  const cells=3, cell=418, size=cells*cell;
  const supportOpacity=.65;
  const canvases=new Map();
  const bound=(value,min,max)=>Math.max(min,Math.min(max,value));
  const statuses=['status_shield','status_freeze','status_curse','status_heal_ring'];

  async function lightCanvas(url,sequence){
    if(!canvases.has(url)){
      const pending=(async()=>{
        const image=new Image();
        image.src=url;
        await image.decode();
        const width=image.naturalWidth,height=image.naturalHeight;
        if(sequence && (width!==size || height!==size))throw new Error('Unexpected VFX atlas size');
        const canvas=document.createElement('canvas');
        canvas.width=width; canvas.height=height;
        const ctx=canvas.getContext('2d',{willReadFrequently:true});
        ctx.drawImage(image,0,0);
        const pixels=ctx.getImageData(0,0,width,height), rgba=pixels.data;
        // The Pixi canvas sits over a CSS scene. Give the light an alpha channel
        // in memory so additive black cannot cover that backdrop.
        for(let i=0;i<rgba.length;i+=4){
          const peak=Math.max(rgba[i],rgba[i+1],rgba[i+2]);
          if(peak<=8){rgba[i+3]=0;continue;}
          const straight=255/peak;
          rgba[i]*=straight; rgba[i+1]*=straight; rgba[i+2]*=straight;
          rgba[i+3]*=(peak-8)/247;
        }
        ctx.putImageData(pixels,0,0);
        // Keep exact 418px UV rectangles with a transparent border for linear sampling.
        for(let edge=0;sequence && edge<=size;edge+=cell){
          ctx.clearRect(edge-1,0,2,size);
          ctx.clearRect(0,edge-1,size,2);
        }
        return canvas;
      })();
      canvases.set(url,pending);
      pending.catch(()=>canvases.delete(url));
    }
    return canvases.get(url);
  }

  function lightSprite(texture){
    const sprite=new P.Sprite(texture);
    sprite.anchor.set(.5);
    sprite.eventMode='none';
    sprite.blendMode=P.BLEND_MODES.ADD;
    return sprite;
  }
  function unitAnchor(n,w,h){
    // Use the body position in battle-camera space, including lunges and knockback.
    const body=n.sprite;
    const height=body ? body.texture.orig.height*Math.abs(body.scale.y) : h*(n.boss?.285:.204)*n.depth;
    return {x:body?.x ?? (n.x+n.dx)*w, y:body?.y ?? (n.y+n.dy)*h, height};
  }

  class BattleVfx {
    constructor(layer,renderer,nodes,groundLayer){
      this.layer=layer;
      this.groundLayer=groundLayer || layer;
      this.renderer=renderer;
      this.nodes=nodes;
      this.units=Object.values(nodes);
      this.atlases=new Map();
      this.artTextures=new Map();
      this.active=new Set();
      this.flights=new Set();
      this.statuses=new Map();
      this.last=null;
      this.rotationSeed=Math.floor(performance.now()*1000)>>>0;
    }
    preload(heroes){
      const pending=[];
      for(const key of new Set(['spark',...heroes])){
        const layout=Sky.art.battleVfx(key);
        if(layout)pending.push(this.load(key,layout));
      }
      for(const key of new Set([...statuses,...heroes.map(hero=>'proj_'+hero)]))
        if(Sky.art.battleArt(key))pending.push(this.load(key,null));
      return Promise.all(pending);
    }
    async load(key,layout){
      const offline=location.protocol==='file:';
      let base;
      try {
        const url=layout ? (offline ? await Sky.art.loadOfflineVfx(key) : layout.src) :
          (offline ? await Sky.art.loadOfflineBattleArt(key) : Sky.art.battleArt(key));
        if(!url || this.disposed)return;
        const canvas=await lightCanvas(url,!!layout);
        if(this.disposed)return;
        base=new P.BaseTexture(canvas,{mipmap:P.MIPMAP_MODES.OFF,scaleMode:P.SCALE_MODES.LINEAR});
        this.renderer.texture.bind(base);
        const source=offline?'embedded':'png';
        if(!layout){
          const texture=new P.Texture(base);
          const fragments=[];
          if(key==='status_freeze'){
            // Cut through the transparent centre. The four pieces split apart on thaw.
            const mx=Math.floor(canvas.width/2),my=Math.floor(canvas.height/2);
            for(const y of [0,my])for(const x of [0,mx])
              fragments.push(new P.Texture(base,new P.Rectangle(x,y,x ? canvas.width-x : mx,y ? canvas.height-y : my)));
          }
          this.artTextures.set(key,{key,texture,fragments,base,source});
          return;
        }
        const frames=Array.from({length:cells*cells},(_,i)=>new P.Texture(base,new P.Rectangle(
          i%cells*cell,Math.floor(i/cells)*cell,cell,cell)));
        this.atlases.set(key,{key,layout,base,frames,source});
      }catch{
        base?.destroy();
      }
    }
    create(atlas,{actor,target=null,targets=null,role,hitIndex,due,start,scale,alpha=1,rotation=0,finisher=false}){
      const sprite=lightSprite(atlas.frames[0]);
      const {kind,anchorY}=atlas.layout;
      const support=kind==='heal' || kind==='shield';
      const opacity=alpha*(support ? supportOpacity : 1);
      sprite.anchor.set(.5,anchorY);
      sprite.alpha=opacity;
      sprite.rotation=rotation;
      sprite.visible=false;
      const info={key:atlas.key,heroId:this.nodes[actor].heroId,actor,target,targets,role,hitIndex,due,
        source:atlas.source,startedAt:null,impactAt:null,renderedImpactAt:null,frame:null,frames:[],
        active:true,rotation,blendMode:sprite.blendMode,finisher,magnification:finisher?1.45:1};
      const entry={atlas,sprite,info,start,scale,alpha:opacity,impactClock:null};
      this.active.add(entry);
      // Support flare cores radiate behind the silhouette. The persistent shield
      // shell still sits in front, keeping its outline without adding a second core to the face.
      (support ? this.groundLayer : this.layer).addChild(sprite);
      return entry;
    }
    plan(action,clock){
      const actor=this.nodes[action.actor], atlas=this.atlases.get(actor.heroId);
      if(!atlas)return null;
      const {kind,mode,impactFrame,frameMs,stagger,scale,groupScale,alpha=1,groupAlpha=.86,impactHold=0}=atlas.layout;
      const targets=new Map();
      action.hits.forEach((hit,index)=>{
        const target=this.nodes[hit.target];
        if(target && hit.kind===kind && (kind==='damage' ? target.side!==actor.side : target.side===actor.side))
          targets.set(index,hit.target);
      });
      if(!targets.size)return null;
      const firstHit=targets.keys().next().value;
      const lastIndex=[...targets.keys()].at(-1);
      const windup=impactFrame*frameMs;
      let attackNumber=0,lastHit=windup;
      const due=action.hits.map((hit,index)=>{
        if(targets.has(index))lastHit=windup+attackNumber++*stagger;
        return targets.has(index) ? lastHit : lastHit+(hit.kind==='heal'?108:36);
      });
      let duration=due.at(-1)+245;
      const byHit=new Map();
      const add=(index,role,target,keys,magnification,alpha)=>{
        const finisher=index===lastIndex && role!=='group';
        const entry=this.create(atlas,{actor:action.actor,target,targets:keys,role,hitIndex:index,finisher,
          due:due[index],start:clock+due[index]-windup,scale:magnification,alpha});
        if(!byHit.has(index))byHit.set(index,[]);
        byHit.get(index).push(entry);
        duration=Math.max(duration,due[index]+(atlas.frames.length-impactFrame)*frameMs+impactHold);
      };
      if(mode==='single'){
        for(const [index,target] of targets)add(index,mode,target,null,scale,index===lastIndex?alpha:alpha*.75);
      }
      else{
        if(mode==='group')add(firstHit,'group',null,[...new Set(targets.values())],groupScale,groupAlpha);
        for(const [index,target] of targets)add(index,mode==='projectile'?'projectile':'target',target,null,scale,alpha);
      }
      return {due,duration,firstHit,byHit,targets};
    }
    impact(entries,clock,time){
      for(const entry of entries || []){
        if(entry.info.key==='h01')
          for(const other of this.active)
            if(other!==entry && other.info.key==='h01' && other.info.target===entry.info.target &&
                other.impactClock!==null && other.fadeAt===undefined)other.fadeAt=clock;
        entry.impactClock=clock;
        entry.info.impactAt=time;
        if(entry.info.role!=='spark')this.last=entry.info;
      }
    }
    spark(actor,target,index,due,clock,time){
      this.landBasic(actor,target);
      const atlas=this.atlases.get('spark');
      if(!atlas)return false;
      // A private sequence leaves the battle's seeded damage and target RNG alone.
      this.rotationSeed=(Math.imul(this.rotationSeed,1664525)+1013904223)>>>0;
      const rotation=(this.rotationSeed/4294967296-.5)*.62;
      const entry=this.create(atlas,{actor,target,role:'spark',hitIndex:index,due,start:clock,scale:atlas.layout.scale,rotation});
      this.impact([entry],clock,time);
      return true;
    }
    launchBasic(action,clock,firstHitDue){
      if(this.disposed || action.kind!=='basic')return;
      const actor=this.nodes[action.actor],key='proj_'+actor.heroId;
      const hit=action.hits.find(hit=>hit.kind==='damage' && this.nodes[hit.target].side!==actor.side);
      if(!hit || !Sky.art.battleArt(key))return;
      this.flights.add({key,actor:actor.key,target:hit.target,start:clock+80,end:clock+firstHitDue,
        sprite:null,origin:null,progress:0});
    }
    removeFlight(flight){
      flight.sprite?.destroy();
      this.flights.delete(flight);
    }
    landBasic(actor,target){
      for(const flight of this.flights)
        if(flight.actor===actor && flight.target===target)this.removeFlight(flight);
    }
    drawFlights(clock,w,h){
      for(const flight of this.flights){
        if(clock>=flight.end){this.removeFlight(flight);continue;}
        if(clock<flight.start)continue;
        const art=this.artTextures.get(flight.key);
        if(!art)continue;
        const actor=this.nodes[flight.actor],target=this.nodes[flight.target];
        if(!flight.sprite){
          const origin=unitAnchor(actor,w,h),dir=actor.side==='ally'?1:-1;
          flight.origin={x:(origin.x+dir*origin.height*.16)/w,y:(origin.y-origin.height*.50)/h};
          flight.sprite=lightSprite(art.texture);
          // Anchor at the leading tip. The tail stays behind the contact point on both sides.
          flight.sprite.anchor.set(.89,.5);
          this.layer.addChild(flight.sprite);
        }
        const end=unitAnchor(target,w,h),sx=flight.origin.x*w,sy=flight.origin.y*h;
        const dx=end.x-sx,dy=end.y-end.height*.48-sy;
        const t=bound((clock-flight.start)/(flight.end-flight.start),0,1),arc=h*.035;
        const sprite=flight.sprite;
        sprite.position.set(sx+dx*t,sy+dy*t-arc*Math.sin(Math.PI*t));
        sprite.rotation=Math.atan2(dy-Math.PI*arc*Math.cos(Math.PI*t),dx);
        sprite.scale.set(h*.205/art.texture.width*(.83+.17*t));
        sprite.alpha=.72+.25*Math.min(1,t*6);
        flight.progress=t;
      }
    }
    addState(key,n,clock){
      const art=this.artTextures.get(key);
      if(!art)return null;
      const id=key+':'+n.key,ground=key==='status_curse' || key==='status_heal_ring';
      const view=new P.Container(),sprite=lightSprite(art.texture);
      view.eventMode='none';
      view.addChild(sprite);
      (ground?this.groundLayer:this.layer).addChild(view);
      const state={id,key,target:n.key,n,art,ground,view,sprite,start:clock,ending:null,pieces:[]};
      this.statuses.set(id,state);
      return state;
    }
    syncState(key,n,enabled,clock){
      const state=this.statuses.get(key+':'+n.key);
      if(enabled && !state)this.addState(key,n,clock);
      else if(enabled && state.ending!==null){
        state.start=clock; state.ending=null;
        for(const piece of state.pieces)piece.destroy();
        state.pieces.length=0; state.sprite.visible=true;
      }else if(!enabled && state && state.ending===null){
        state.ending=clock;
        if(key==='status_freeze'){
          state.sprite.visible=false;
          for(const texture of state.art.fragments){
            const piece=lightSprite(texture);
            state.view.addChild(piece);
            state.pieces.push(piece);
          }
        }
      }
    }
    healRing(target,clock){
      const n=this.nodes[target];
      if(!n || this.disposed)return;
      const existing=this.statuses.get('status_heal_ring:'+target);
      if(existing){existing.start=clock;existing.ending=null;}
      else this.addState('status_heal_ring',n,clock);
    }
    removeState(state){
      state.view.destroy({children:true});
      this.statuses.delete(state.id);
    }
    drawStates(clock,w,h){
      for(const n of this.units){
        this.syncState('status_shield',n,n.hp>0 && n.shield>0,clock);
        this.syncState('status_freeze',n,n.hp>0 && n.status?.freeze>0,clock);
        this.syncState('status_curse',n,n.hp>0 && (n.status?.curse>0 || n.status?.breakArmor>0),clock);
      }
      for(const state of this.statuses.values()){
        const {n,key,sprite,view,ground}=state;
        const age=Math.max(0,clock-state.start);
        const heal=key==='status_heal_ring',freeze=key==='status_freeze',shield=key==='status_shield';
        if(heal && age>=190 && state.ending===null)state.ending=state.start+190;
        const duration=heal?460:freeze?220:180;
        const release=state.ending===null?0:bound((clock-state.ending)/duration,0,1);
        if(release>=1){this.removeState(state);continue;}
        const body=unitAnchor(n,w,h);
        const period=freeze?400:1250;
        const breath=Math.sin(age*Math.PI*2/period+n.slot);
        const size=ground ? (heal?.98+Math.min(age/360,1)*.47:1.14) :
          freeze ? .94 : 1.16+.022*breath+.13*release;
        const scale=body.height*size/state.art.texture.width;
        // Keep the ice below the chest, even as the upper fragments spread on thaw.
        const lift=ground ? .015 : freeze ? .255-.07*release : .48;
        const scaleY=freeze ? body.height*.57/state.art.texture.height : ground ? scale*.36 : scale;
        view.position.set(body.x,body.y-body.height*lift);
        // Rotate inside the flattened parent to keep the ellipse level with the stage.
        view.scale.set(scale,scaleY);
        if(ground)sprite.rotation=age*Math.PI*2/(heal?2600:7200);
        const intensity=heal?.84:ground?.72:shield?.65:.76;
        const flash=!ground && release>0?.35*Math.max(0,1-release*2):0;
        const entry=heal?.6+.4*bound(age/80,0,1):.35+.65*bound(age/140,0,1);
        const illumination=.38+.62*(n.flag?.alpha ?? 1);
        const opacity=heal || shield ? supportOpacity : 1;
        view.alpha=bound(intensity+breath*.055+flash,0,1)*entry*(1-release)*illumination*opacity;
        if(state.pieces.length){
          for(const piece of state.pieces){
            const frame=piece.texture.frame,dx=frame.x ? 1 : -1,dy=frame.y ? 1 : -1;
            const width=state.art.texture.width;
            piece.position.set(frame.x+frame.width/2-width/2+dx*release*width*.17,
              frame.y+frame.height/2-state.art.texture.height/2+dy*release*width*.06+release*release*width*.10);
            piece.rotation=dx*dy*release*.17;
          }
        }
      }
    }
    position(entry,clock,w,h){
      const {info,sprite,atlas}=entry;
      const {ground,impactFrame,frameMs}=atlas.layout;
      const actor=this.nodes[info.actor];
      const nodes=info.targets ? info.targets.map(id=>this.nodes[id]) : [this.nodes[info.target]];
      let x=0,y=0;
      for(const n of nodes){
        const body=unitAnchor(n,w,h);
        x+=body.x;
        y+=ground?body.y:body.y-body.height*.48;
      }
      x/=nodes.length; y/=nodes.length;
      let direction=1;
      if(info.role==='projectile'){
        direction=actor.side==='ally' ? -1 : 1;
        if(entry.impactClock===null){
          const t=bound((clock-entry.start)/(impactFrame*frameMs),0,1);
          const origin=unitAnchor(actor,w,h), ax=origin.x, ay=origin.y-origin.height*.50;
          x=ax+(x-ax)*t;
          y=ay+(y-ay)*t-Math.sin(t*Math.PI)*h*.025;
        }
      }
      sprite.position.set(x,y);
      const buildup=info.frame / Math.max(1,impactFrame);
      const scale=h*entry.scale/cell*(info.finisher ? 1+.45*bound(buildup,0,1) : 1);
      sprite.scale.set(direction*scale,scale);
    }
    draw(clock,time,w,h){
      if(this.disposed)return;
      this.drawStates(clock,w,h);
      this.drawFlights(clock,w,h);
      for(const entry of this.active){
        if(clock<entry.start)continue;
        const {atlas,sprite,info,impactClock}=entry;
        const {impactFrame,frameMs,impactHold=0}=atlas.layout;
        const frame=impactClock===null ? bound(Math.floor((clock-entry.start)/frameMs),0,impactFrame-1) :
          impactFrame+Math.floor(Math.max(0,clock-impactClock-impactHold)/frameMs);
        const fade=entry.fadeAt===undefined?1:1-bound((clock-entry.fadeAt)/82,0,1);
        if(frame>=atlas.frames.length || !fade){this.remove(entry);continue;}
        sprite.alpha=entry.alpha*fade;
        if(info.startedAt===null)info.startedAt=time;
        if(frame!==info.frame){
          info.frame=frame;
          info.frames.push(frame);
          sprite.texture=atlas.frames[frame];
        }
        sprite.visible=true;
        this.position(entry,clock,w,h);
      }
    }
    presented(time){
      for(const {atlas,info} of this.active)
        if(info.frame===atlas.layout.impactFrame && info.renderedImpactAt===null)
          info.renderedImpactAt=time;
    }
    remove(entry){
      entry.sprite.destroy();
      entry.info.active=false;
      this.active.delete(entry);
    }
    clear(){
      for(const entry of this.active)this.remove(entry);
      for(const flight of this.flights)this.removeFlight(flight);
      for(const state of this.statuses.values())this.removeState(state);
    }
    inspect(){
      return {ready:[...this.atlases.keys()],active:[...this.active].map(entry=>entry.info),last:this.last,
        artReady:[...this.artTextures.keys()],
        projectiles:[...this.flights].filter(f=>f.sprite).map(f=>({key:f.key,actor:f.actor,target:f.target,
          progress:f.progress,rotation:f.sprite.rotation,x:f.sprite.x,y:f.sprite.y,
          source:this.artTextures.get(f.key).source,blendMode:f.sprite.blendMode})),
        statuses:[...this.statuses.values()].map(s=>({key:s.key,target:s.target,phase:s.ending===null?'active':'release',
          rotation:s.sprite.rotation,perspective:s.view.scale.y/s.view.scale.x,source:s.art.source,blendMode:s.sprite.blendMode,
          x:s.view.x,y:s.view.y,layer:s.ground?'ground':'over'}))};
    }
    destroy(){
      this.disposed=true;
      this.clear();
      for(const {base,frames} of this.atlases.values()){
        for(const frame of frames)frame.destroy();
        base.destroy();
      }
      this.atlases.clear();
      for(const {base,texture,fragments} of this.artTextures.values()){
        for(const piece of fragments)piece.destroy();
        texture.destroy(); base.destroy();
      }
      this.artTextures.clear();
    }
  }
  Sky.BattleVfx=BattleVfx;
})();
