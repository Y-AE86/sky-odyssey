(() => {
  'use strict';
  const Sky=window.Sky, P=window.PIXI;
  const cells=3, cell=418, size=cells*cell;
  const supportOpacity=.65;
  const emberTailMs=500;
  const videoDefaults={duration:2850,beats:[260,1080,1920]};
  const vfxVideoSpecs={
    h01:{...videoDefaults,earlyFinish:true,presentation:{
      cues:[240,370,880,1020,1160,1300,1760,1900,2060], weights:[7,8,9,10,11,11,12,14,18],
      stagger:0, accent:1020
    }},
    h08:{...videoDefaults,beats:[200,1020,1860],presentation:{
      cues:[200,540,960,1180,1560,1880], weights:[11,12,14,15,16,32], stagger:35
    }}
  };
  const videoKeyVertex=`
    attribute vec2 aVertexPosition, aTextureCoord;
    uniform mat3 translationMatrix, projectionMatrix;
    varying mediump vec2 vUV;
    void main() {
      vec3 position = projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0);
      gl_Position = vec4(position.xy, 0.0, 1.0);
      vUV = aTextureCoord;
    }`;
  const videoKeyFragment=`
    precision mediump float;
    varying mediump vec2 vUV;
    uniform sampler2D uFrame;
    uniform vec2 uCrop;
    uniform float uAlpha, uMirror;
    void main() {
      vec2 uv = 0.5 + (vUV - 0.5) * uCrop;
      uv.x = mix(uv.x, 1.0 - uv.x, uMirror);
      vec3 sampleColor = texture2D(uFrame, uv).rgb;
      float peak = max(sampleColor.r, max(sampleColor.g, sampleColor.b));
      float key = smoothstep(0.035, 0.10, peak);
      float edge = smoothstep(0.0, 0.04, vUV.x) * smoothstep(0.0, 0.04, 1.0 - vUV.x);
      vec3 light = clamp((sampleColor - 0.028) * 1.09, 0.0, 1.0);
      float coverage = max(light.r, max(light.g, light.b));
      gl_FragColor = vec4(light, coverage) * (key * edge * uAlpha);
    }`;
  const emberColors={ink:0xc18aff,ice:0x8fefff,water:0x69ebcd,light:0xffdf87,
    gear:0xffae61,blood:0xff698f,thunder:0x75bfff,fire:0xff8449};
  const canvases=new Map();
  const bound=(value,min,max)=>Math.max(min,Math.min(max,value));
  const smooth=(start,end,value)=>{
    const t=bound((value-start)/(end-start),0,1);
    return t*t*(3-2*t);
  };
  function integerParts(amount,slots) {
    const weight=slots.reduce((sum,slot)=>sum+slot.weight,0);
    const rest=amount-slots.length;
    const shares=slots.map((slot,index)=>{
      const numerator=rest*slot.weight;
      return {index,amount:1+Math.floor(numerator/weight),remainder:numerator%weight};
    });
    const leftover=amount-shares.reduce((sum,share)=>sum+share.amount,0);
    const order=[...shares].sort((a,b)=>b.remainder-a.remainder || b.index-a.index);
    for(let i=0;i<leftover;i++)order[i].amount++;
    return shares.map(share=>share.amount);
  }

  function divideCues(positive,cues) {
    const total=positive.reduce((sum,{hit})=>sum+hit.amount,0);
    const count=Math.min(total,cues.length);
    // A low-HP target still reaches the last visual beat, with no zero-valued popups.
    const slots=Array.from({length:count},(_,i)=>cues[count===1 ? cues.length-1 :
      Math.round(i*(cues.length-1)/(count-1))]);
    const prefix=[0];
    for(const slot of slots)prefix.push(prefix.at(-1)+slot.weight);
    let used=0,damage=0;
    return positive.map(({hit},index)=>{
      damage+=hit.amount;
      const left=positive.length-index-1;
      let best=Math.max(used+1,count-(total-damage)), mismatch=Infinity;
      const ideal=prefix.at(-1)*damage/total;
      for(let end=best;end<=Math.min(count-left,used+hit.amount);end++){
        const difference=Math.abs(prefix[end]-ideal);
        if(difference<mismatch){best=end;mismatch=difference;}
      }
      const part=slots.slice(used,best);
      used=best;
      return part;
    });
  }
  const statuses=['status_shield','status_freeze','status_curse','status_heal_ring'];
  // Reuse the original sheets and apply a sprite tint at draw time. Both
  // entrances share the same donor textures and individual hit timing.
  const variants={
    h07:{atlas:'h02',projectile:'h01',tint:0xd5a7ff,layout:{groupScale:.55,stagger:65}},
    h08:{atlas:'h05',projectile:'h05',tint:0xa4deff,layout:{mode:'group',scale:.30,groupScale:.52,stagger:72}},
    h09:{atlas:'h04',projectile:'h04',tint:0xffad69,layout:{kind:'damage',mode:'group',scale:.32,groupScale:.60,stagger:68}},
    h10:{atlas:'h03',projectile:'h03',tint:0xa9e8ff,layout:{groupScale:.53}},
    h11:{atlas:'h06',projectile:'h06',tint:0xff99bb,layout:{scale:.44}},
    enemy_boss_mech:{atlas:'h05',projectile:'h05',tint:0xc2aaff,layout:{mode:'group',scale:.30,groupScale:.52}},
    enemy_vanguard:{atlas:'h04',projectile:'h04',tint:0xc4a8ff},
    enemy_caster:{atlas:'h02',projectile:'h01',tint:0xc5a1ff},
    enemy_striker:{atlas:'h06',projectile:'h05',tint:0xffb8ab}
  };

  function lightBounds(rgba,tileX,tileY){
    let left=cell-1,right=0,top=cell-1,bottom=0;
    // The outer texel of each cell is cleared by lightCanvas.
    for(let y=1;y<cell-1;y++){
      const row=((tileY+y)*size+tileX)*4+3;
      let first=1;
      while(first<cell-1 && !rgba[row+first*4])first++;
      if(first===cell-1)continue;
      if(first<left)left=first;
      if(y<top)top=y;
      bottom=y;
      let last=cell-2;
      while(last>right && !rgba[row+last*4])last--;
      if(last>right)right=last;
    }
    if(bottom===0)return {x:2,y:2,width:2,height:2};
    // Keep two transparent texels around the visible light for linear sampling.
    const x=Math.max(0,left-2), y=Math.max(0,top-2);
    return {x,y,width:Math.min(cell,right+3)-x,height:Math.min(cell,bottom+3)-y};
  }

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
        const bounds=sequence ? Array.from({length:cells*cells},(_,i)=>
          lightBounds(rgba,i%cells*cell,Math.floor(i/cells)*cell)) : null;
        return {canvas,bounds};
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
    const height=body ? body.texture.orig.height*Math.abs(body.scale.y) :
      n.pose?.size ?? h*.204*n.magnification*n.depth;
    return {x:body?.x ?? (n.x+n.dx)*w, y:body?.y ?? (n.y+n.dy)*h, height};
  }

  class BattleVfx {
    constructor(layer,renderer,nodes,groundLayer,screenLayer,host){
      this.layer=layer;
      this.groundLayer=groundLayer || layer;
      this.screenLayer=screenLayer;
      this.host=host;
      this.renderer=renderer;
      this.nodes=nodes;
      this.units=Object.values(nodes);
      this.atlases=new Map();
      this.artTextures=new Map();
      this.active=new Set();
      this.embers=new Set();
      this.flights=new Set();
      this.statuses=new Map();
      this.last=null;
      this.vfxVideos=new Map();
      this.activeVideo=null;
      this.rotationSeed=Math.floor(performance.now()*1000)>>>0;
    }
    preloadVideoFx(id){
      // Chromium gives file: video an opaque origin for WebGL. Use the
      // embedded nine-cell atlas there, without starting a doomed upload.
      if(!this.screenLayer || !this.host || location.protocol==='file:' || this.vfxVideos.has(id))return;
      const src=Sky.art.vfxVideo?.(id);
      if(!src)return;
      const video=document.createElement('video');
      video.defaultMuted=video.muted=video.playsInline=true;
      video.preload='auto';
      video.className='battle-vfx-decoder';
      video.setAttribute('aria-hidden','true');
      video.disablePictureInPicture=true;
      const entry={id,video,failed:false};
      video.addEventListener('error',()=>{entry.failed=true;});
      // Keep a real layout box behind the Pixi canvas. Leaving the decoder
      // detached or display:none can starve video presentation callbacks.
      this.host.append(video);
      video.src=src;
      video.load();
      this.vfxVideos.set(id,entry);
    }
    preload(heroes){
      this.ultimateKeys=['spark',...heroes];
      const pending=[];
      for(const key of new Set(this.ultimateKeys.map(id=>variants[id]?.atlas || id))){
        const layout=Sky.art.battleVfx(key);
        if(layout)pending.push(this.load(key,layout));
      }
      if(this.screenLayer)
        for(const key of new Set([...statuses,...heroes.map(id=>'proj_'+(variants[id]?.projectile || id))]))
          if(Sky.art.battleArt(key))pending.push(this.load(key,null));
      for(const id of new Set(heroes))this.preloadVideoFx(id);
      return Promise.all(pending);
    }
    async load(key,layout){
      const offline=location.protocol==='file:';
      let base;
      try {
        const url=layout ? (offline ? await Sky.art.loadOfflineVfx(key) : layout.src) :
          (offline ? await Sky.art.loadOfflineBattleArt(key) : Sky.art.battleArt(key));
        if(!url || this.disposed)return;
        const {canvas,bounds}=await lightCanvas(url,!!layout);
        if(this.disposed)return;
        base=new P.BaseTexture(canvas,{mipmap:P.MIPMAP_MODES.OFF,scaleMode:P.SCALE_MODES.LINEAR});
        this.renderer?.texture.bind(base);
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
        const orig=new P.Rectangle(0,0,cell,cell);
        const renderFrames=frames.map((frame,i)=>{
          const {x,y,width,height}=bounds[i];
          if(width===cell && height===cell)return frame;
          const trim=new P.Rectangle(x,y,width,height);
          const uv=new P.Rectangle(frame.frame.x+x,frame.frame.y+y,width,height);
          return new P.Texture(base,uv,orig,trim);
        });
        this.atlases.set(key,{key,layout,base,frames,renderFrames,source});
      }catch{
        base?.destroy();
      }
    }
    create(atlas,{actor,target=null,targets=null,role,hitIndex,due,start,scale,alpha=1,rotation=0,finisher=false}){
      const frames=atlas.renderFrames || atlas.frames;
      const sprite=lightSprite(frames[0]);
      const next=lightSprite(frames[0]);
      const {kind,anchorY}=atlas.layout;
      const support=kind==='heal' || kind==='shield';
      const opacity=alpha*(support ? supportOpacity : 1);
      const cinemaScale=kind==='damage' && this.screenLayer ? role==='group' ? 1.32 : finisher ? 1.28 : 1 : 1;
      for(const frame of [sprite,next]){
        frame.anchor.set(.5,anchorY);
        frame.tint=atlas.tint ?? 0xffffff;
        frame.visible=false;
      }
      const info={key:atlas.key,heroId:this.nodes[actor].heroId,actor,target,targets,role,hitIndex,due,
        artKey:atlas.artKey || atlas.key,tint:sprite.tint,
        source:atlas.source,startedAt:null,impactAt:null,renderedImpactAt:null,frame:null,frames:[],
        active:true,rotation,blendMode:sprite.blendMode,finisher,magnification:finisher?1.45:1,
        sub:0,blend:0,nextFrame:null,scale:0,cinemaScale,angle:rotation,alpha:0,nextAlpha:0};
      const layer=support ? this.groundLayer : this.layer;
      const targetNodes=targets ? targets.map(id=>this.nodes[id]) : [this.nodes[target]];
      const entry={atlas,frames,sprite,next,info,layer,targetNodes,start,scale:scale*cinemaScale,support,
        alpha:opacity,impactClock:null};
      this.active.add(entry);
      // Support flare cores radiate behind the silhouette. The persistent shield
      // shell still sits in front, keeping its outline without adding a second core to the face.
      layer.addChild(sprite,next);
      return entry;
    }
    presentationPlan(action,targets,legacyDue){
      const heroId=this.nodes[action.actor].heroId;
      const design=vfxVideoSpecs[heroId]?.presentation;
      if(!design)return null;
      const groups=new Map(), events=[], commits=new Map(), starts=new Map();
      for(const [index,target] of targets){
        if(!groups.has(target))groups.set(target,{order:groups.size,positive:[]});
        const hit=action.hits[index];
        if(hit.amount>0)groups.get(target).positive.push({index,hit});
      }
      for(const {order,positive} of groups.values()){
        if(!positive.length)continue;
        const offset=order*design.stagger;
        const cues=design.cues.map((base,i)=>({base,due:base+offset,weight:design.weights[i]}));
        const divided=divideCues(positive,cues);
        const pieces=[];
        positive.forEach(({index,hit},i)=>{
          const slots=divided[i], amounts=integerParts(hit.amount,slots);
          const {shield,rage,status,...visible}=hit;
          let remaining=hit.amount;
          starts.set(index,slots[0].due);
          slots.forEach((slot,j)=>{
            const amount=amounts[j];
            const commit=j===slots.length-1;
            remaining-=amount;
            const display=commit ? {...hit,amount,crit:false} :
              {...visible,amount,hp:hit.hp+remaining,crit:false};
            pieces.push({due:slot.due,hit:display,index,commit,count:true,
              emphasis:slot.base===design.accent?'accent':'light'});
            if(commit)commits.set(index,slot.due);
          });
        });
        // Preserve the number of actual criticals, placing their presentation marks
        // on the target's closing beats without changing the real hit snapshots.
        const criticals=positive.filter(({hit})=>hit.crit).length;
        if(criticals)for(const event of pieces.slice(-criticals))event.hit.crit=true;
        pieces.forEach((event,part)=>{
          event.part=part;
          event.parts=pieces.length;
          event.targetFinisher=part===pieces.length-1;
        });
        events.push(...pieces);
      }
      const lastForTarget=new Map();
      action.hits.forEach((hit,index)=>{
        if(commits.has(index)){
          lastForTarget.set(hit.target,commits.get(index));
          return;
        }
        const previous=lastForTarget.get(hit.target);
        const group=groups.get(hit.target);
        let due;
        if(targets.has(index)){
          if(design.stagger)due=design.cues.at(-1)+group.order*design.stagger;
          else{
            const following=group.positive.find(entry=>entry.index>index);
            const next=following ? starts.get(following.index) : null;
            if(next!==null)due=Math.min(next,previous===undefined?Math.max(0,next-60):previous+24);
            else due=previous===undefined?legacyDue[index]:previous+24;
          }
        }else{
          const predecessor=commits.get(index-1);
          due=predecessor===undefined?legacyDue[index]:predecessor+(hit.kind==='heal'?108:24);
        }
        // In particular, two reflected hits update the same caster. Their HP
        // snapshots must stay in engine order, even if a target was fully shielded.
        due=Math.max(due,previous ?? 0);
        commits.set(index,due);
        lastForTarget.set(hit.target,due);
        events.push({due,hit,index,commit:true,count:false,emphasis:'light'});
      });
      events.sort((a,b)=>a.due-b.due || a.index-b.index);
      const finisher=events.findLast(event=>event.count);
      if(finisher){
        finisher.finisher=true;
        finisher.emphasis='final';
      }
      return {events,interrupted:false};
    }
    plan(action,clock,speed=1){
      const actor=this.nodes[action.actor],variant=variants[actor.heroId];
      const donor=this.atlases.get(variant?.atlas || actor.heroId);
      if(!donor)return null;
      const atlas=variant ? {...donor,key:actor.heroId,artKey:donor.key,tint:variant.tint,
        layout:{...donor.layout,...variant.layout}} : donor;
      const {kind,impactFrame,frameMs,stagger}=atlas.layout;
      const targets=new Map();
      action.hits.forEach((hit,index)=>{
        const target=this.nodes[hit.target];
        if(target && !hit.periodic && hit.kind===kind && (kind==='damage' ? target.side!==actor.side : target.side===actor.side))
          targets.set(index,hit.target);
      });
      if(!targets.size)return null;
      const firstHit=targets.keys().next().value;
      const windup=impactFrame*frameMs;
      let attackNumber=0,lastHit=windup;
      const atlasDue=action.hits.map((hit,index)=>{
        if(targets.has(index))lastHit=windup+attackNumber++*stagger;
        return targets.has(index) ? lastHit : lastHit+(hit.kind==='heal'?108:36);
      });
      const videoEntry=this.vfxVideos.get(actor.heroId);
      const spec=vfxVideoSpecs[actor.heroId] || videoDefaults;
      if(videoEntry && !videoEntry.failed && videoEntry.video.readyState>=2 && !videoEntry.video.seeking){
        const hitIndices=[...targets.keys()];
        const beats=spec.beats;
        const hitTimeMap=new Map();
        if(spec.earlyFinish && hitIndices.length<=beats.length){
          hitIndices.forEach((index,i)=>hitTimeMap.set(index,beats[i]));
        }else if(hitIndices.length===1){
          hitTimeMap.set(hitIndices[0],beats[beats.length-1]);
        }else{
          hitIndices.forEach((index,i)=>{
            const t=i*(beats.length-1)/(hitIndices.length-1);
            const before=Math.floor(t), after=Math.ceil(t);
            hitTimeMap.set(index,Math.round(beats[before]+(beats[after]-beats[before])*(t-before)));
          });
        }
        let prevHit=beats[0];
        const due=action.hits.map((hit,index)=>{
          if(hitTimeMap.has(index)){prevHit=hitTimeMap.get(index);return prevHit;}
          return prevHit+(hit.kind==='heal'?108:36);
        });
        const plan={due,duration:spec.duration,firstHit,byHit:new Map(),targets,videoVfx:actor.heroId};
        const live=this.playVideoFx(videoEntry,actor.side==='enemy',clock,spec,speed);
        if(live){
          plan.presentation=this.presentationPlan(action,targets,due);
          live.fallback=(time,elapsed)=>{
            if(plan.presentation && !live.framesUploaded){
              plan.videoVfx=null;
              plan.presentation=null;
              plan.due=atlasDue;
              plan.duration=atlasDue.at(-1)+245;
              this.planAtlas(action,time-elapsed,atlas,plan);
              return;
            }
            const remaining=new Map([...targets].filter(([index])=>!live.completed.has(index)));
            if(plan.presentation){
              plan.presentation.interrupted=true;
              // The UI reconciles original snapshots in one frame. Give only
              // the uncommitted original hit indices a matching atlas peak.
              plan.due=due.map((value,index)=>live.completed.has(index)?value:elapsed);
            }
            this.planAtlas(action,time-elapsed,atlas,{...plan,targets:remaining},time);
          };
          return plan;
        }
      }
      return this.planAtlas(action,clock,atlas,{due:atlasDue,duration:atlasDue.at(-1)+245,firstHit,byHit:new Map(),targets});
    }
    planAtlas(action,clock,atlas,plan,minClock=-Infinity){
      const {mode,impactFrame,frameMs,scale,groupScale,alpha=1,groupAlpha=.86,impactHold=0}=atlas.layout;
      const {due,byHit,targets}=plan;
      const firstHit=targets.keys().next().value;
      const lastIndex=[...targets.keys()].at(-1);
      const windup=impactFrame*frameMs;
      const add=(index,role,target,keys,magnification,alpha)=>{
        const finisher=index===lastIndex && role!=='group';
        const entry=this.create(atlas,{actor:action.actor,target,targets:keys,role,hitIndex:index,finisher,
          due:due[index],start:Math.max(minClock,clock+due[index]-windup),scale:magnification,alpha});
        // Start one shower during the final flare, then carry it past the whole cast.
        entry.emberPending=finisher && !!this.screenLayer;
        if(!byHit.has(index))byHit.set(index,[]);
        byHit.get(index).push(entry);
        plan.duration=Math.max(plan.duration,due[index]+(atlas.frames.length-impactFrame)*frameMs+impactHold);
      };
      if(mode==='single'){
        for(const [index,target] of targets)add(index,mode,target,null,scale,index===lastIndex?alpha:alpha*.75);
      }
      else{
        if(mode==='group' && firstHit!==undefined)
          add(firstHit,'group',null,[...new Set(targets.values())],groupScale,groupAlpha);
        for(const [index,target] of targets)add(index,mode==='projectile'?'projectile':'target',target,null,scale,alpha);
      }
      return plan;
    }
    playVideoFx(entry,mirror,clock,spec,speed){
      this.stopVideoFx();
      const {video}=entry;
      if(!video.videoWidth || !video.videoHeight || video.currentTime>.04)return null;
      let resource,texture,geometry,shader,mesh;
      try{
        // The generic image resource uploads HTMLVideoElement directly
        // without relying on Pixi's shared video ticker or readiness events.
        resource=new P.BaseImageResource(video);
        const base=new P.BaseTexture(resource,{mipmap:P.MIPMAP_MODES.OFF,scaleMode:P.SCALE_MODES.LINEAR});
        texture=new P.Texture(base);
        this.renderer.texture.bind(base);
        geometry=new P.Geometry()
          .addAttribute('aVertexPosition',[0,0,1,0,1,1,0,1],2)
          .addAttribute('aTextureCoord',[0,0,1,0,1,1,0,1],2)
          .addIndex([0,1,2,0,2,3]);
        shader=P.Shader.from(videoKeyVertex,videoKeyFragment,{
          uFrame:texture,uCrop:new Float32Array([1,1]),uAlpha:0,uMirror:mirror?1:0
        });
        mesh=new P.Mesh(geometry,shader);
        mesh.eventMode='none';
        mesh.visible=false;
        this.screenLayer.addChild(mesh);
        const session={entry,video,mirror,spec,heroId:entry.id,resource,texture,geometry,shader,mesh,
          clock,start:performance.now(),lastFrameAt:null,mediaTime:0,firstMediaTime:null,pendingTime:null,
          framesUploaded:0,alpha:0,completed:new Set(),failed:false};
        this.activeVideo=session;
        if(video.requestVideoFrameCallback){
          const present=(now,frame)=>{
            if(this.activeVideo!==session)return;
            session.pendingTime=frame.mediaTime;
            session.callback=video.requestVideoFrameCallback(present);
          };
          session.callback=video.requestVideoFrameCallback(present);
        }
        video.playbackRate=speed;
        video.play().catch(()=>{session.failed=true;});
        return session;
      }catch{
        entry.failed=true;
        if(this.activeVideo?.entry===entry)this.stopVideoFx();
        else{
          mesh?.destroy();
          shader?.destroy();
          geometry?.destroy();
          texture?.destroy(true);
          resource?.destroy();
        }
        return null;
      }
    }
    markVideoHit(index){
      this.activeVideo?.completed.add(index);
    }
    stopVideoFx(){
      const session=this.activeVideo;
      if(!session)return;
      this.activeVideo=null;
      const {video,callback,mesh,geometry,shader,texture,resource}=session;
      if(callback!==undefined)video.cancelVideoFrameCallback(callback);
      video.pause();
      if(!video.error && video.currentTime>0)video.currentTime=0;
      mesh.destroy();
      geometry.destroy();
      shader.destroy();
      texture.destroy(true);
      resource.destroy();
      this.screenLayer.visible=false;
    }
    videoElapsed(now,speed,elapsed=0,clock=this.activeVideo?.clock){
      const active=this.activeVideo;
      if(!active)return null;
      const {entry,video,texture,spec}=active;
      if(video.playbackRate!==speed)video.playbackRate=speed;
      const frame=video.requestVideoFrameCallback ? active.pendingTime : video.currentTime;
      if(frame!==null && video.readyState>=2 && (!active.framesUploaded || frame>active.mediaTime)){
        try{
          if(this.renderer.gl.isContextLost())throw new Error('video texture context lost');
          texture.update();
          this.renderer.texture.bind(texture.baseTexture);
          active.mediaTime=frame;
          active.firstMediaTime ??= frame;
          active.lastFrameAt=now;
          active.framesUploaded++;
        }catch{
          active.failed=entry.failed=true;
        }
      }
      const played=video.currentTime*1000;
      const visual=active.mediaTime*1000;
      if(active.framesUploaded && visual>=spec.duration-85 && played>=spec.duration)return spec.duration;
      const stalled=now-(active.lastFrameAt ?? active.start)>(active.framesUploaded?450:620);
      if(entry.failed || active.failed || stalled || video.ended){
        this.stopVideoFx();
        active.fallback?.(clock,elapsed);
        return null;
      }
      return visual;
    }
    drawVideoFx(w,h){
      const active=this.activeVideo;
      if(!active || !active.framesUploaded)return;
      const {mesh,shader,video,mediaTime,spec}=active;
      const aspect=w*video.videoHeight/(h*video.videoWidth);
      shader.uniforms.uCrop[0]=Math.min(1,aspect);
      shader.uniforms.uCrop[1]=Math.min(1,1/aspect);
      mesh.scale.set(w,h);
      const age=mediaTime*1000;
      // A cold decoder can first present after media time zero. Start the
      // entrance from that real frame but keep the exit anchored to the clip.
      const fadeInAge=(mediaTime-active.firstMediaTime)*1000;
      active.alpha=shader.uniforms.uAlpha=smooth(0,80,fadeInAge)*(1-smooth(spec.duration-420,spec.duration,age));
      this.screenLayer.visible=mesh.visible=active.alpha>.002;
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
      const variant=variants[actor.heroId],artKey=variant ? 'proj_'+variant.projectile : key;
      const hit=action.hits.find(hit=>hit.kind==='damage' && this.nodes[hit.target].side!==actor.side);
      if(!hit || !this.artTextures.has(artKey))return;
      this.flights.add({key,artKey,tint:variant?.tint ?? 0xffffff,actor:actor.key,target:hit.target,start:clock+80,end:clock+firstHitDue,
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
        const art=this.artTextures.get(flight.artKey);
        if(!art)continue;
        const actor=this.nodes[flight.actor],target=this.nodes[flight.target];
        if(!flight.sprite){
          const origin=unitAnchor(actor,w,h),dir=actor.side==='ally'?1:-1;
          flight.origin={x:(origin.x+dir*origin.height*.16)/w,y:(origin.y-origin.height*.50)/h};
          flight.sprite=lightSprite(art.texture);
          flight.sprite.tint=flight.tint;
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
      const {info,sprite,next,atlas,targetNodes}=entry;
      const {ground,impactFrame,frameMs}=atlas.layout;
      const actor=this.nodes[info.actor];
      let x=0,y=0;
      for(const n of targetNodes){
        const body=unitAnchor(n,w,h);
        x+=body.x;
        y+=ground?body.y:body.y-body.height*.48;
      }
      x/=targetNodes.length; y/=targetNodes.length;
      const buildup=bound((clock-entry.start)/Math.max(1,impactFrame*frameMs),0,1);
      let direction=1;
      if(info.role==='projectile'){
        direction=actor.side==='ally' ? -1 : 1;
        if(entry.impactClock===null){
          const origin=unitAnchor(actor,w,h), ax=origin.x, ay=origin.y-origin.height*.50;
          x=ax+(x-ax)*buildup;
          y=ay+(y-ay)*buildup-Math.sin(buildup*Math.PI)*h*.025;
        }
      }
      let scale=h*entry.scale/cell, rotation=info.rotation;
      if(entry.impactClock===null){
        scale*=(1-.055*buildup)*(info.finisher ? 1+.45*smooth(0,1,buildup) : 1);
        rotation-=direction*.018*Math.sin(buildup*Math.PI);
      }else{
        const age=Math.max(0,clock-entry.impactClock);
        const settle=smooth(80,(atlas.frames.length-impactFrame)*frameMs,age);
        const amplitude=entry.support ? .10 : info.role==='spark' ? .24 : .16;
        const rebound=amplitude*Math.exp(-age/90)*(.46+Math.sin(age/30));
        scale*=info.magnification*(1+rebound+settle*.11);
        rotation+=direction*(.027*Math.sin(age/42)*Math.exp(-age/118)+settle*.085);
      }
      sprite.position.set(x,y); next.position.set(x,y);
      sprite.scale.set(direction*scale,scale); next.scale.set(direction*scale,scale);
      sprite.rotation=next.rotation=rotation;
      info.scale=scale; info.angle=rotation;
    }
    spawnEmbers(entry,time,w,h){
      entry.emberPending=false;
      if(!this.emberTexture){
        const canvas=document.createElement('canvas');
        canvas.width=canvas.height=24;
        const ctx=canvas.getContext('2d');
        const glow=ctx.createRadialGradient(12,12,0,12,12,12);
        glow.addColorStop(0,'#fff');
        glow.addColorStop(.26,'#ffffffe8');
        glow.addColorStop(.55,'#ffffff64');
        glow.addColorStop(1,'#ffffff00');
        ctx.fillStyle=glow;
        ctx.fillRect(0,0,24,24);
        const base=new P.BaseTexture(canvas,{mipmap:P.MIPMAP_MODES.OFF,scaleMode:P.SCALE_MODES.LINEAR});
        this.emberTexture=new P.Texture(base);
      }
      const {info,sprite}=entry;
      const caster=Sky.D.hero(info.heroId);
      const tint=entry.atlas.tint ?? emberColors[caster.element] ?? emberColors.light;
      const count=entry.support ? 14 : entry.atlas.layout.mode==='group' ? 22 : 18;
      const view=new P.Container();
      view.eventMode='none';
      const shift=(1+this.nodes[info.actor].slot)*.63+info.hitIndex*.41;
      const particles=Array.from({length:count},(_,index)=>{
        // Golden-angle spacing and analytic variation are independent of both RNG streams.
        const angle=shift+index*2.39996;
        const spread=.76+.24*Math.sin(index*5.74+shift);
        const x=Math.cos(angle), y=Math.sin(angle);
        const light=lightSprite(this.emberTexture);
        light.tint=tint; light.visible=false;
        view.addChild(light);
        return {light,x,y,spread,delay:(index*31)%94,size:4+spread*6,phase:index*1.93};
      });
      const burst={key:info.key,actor:info.actor,count,tint,visible:0,view,particles,
        x:sprite.x/w,y:sprite.y/h,startedAt:time,atlasEndedAt:null,remainingMs:null};
      entry.emberBurst=burst;
      this.embers.add(burst);
      entry.layer.addChild(view);
    }
    drawEmbers(time,w,h){
      for(const burst of this.embers){
        const {atlasEndedAt,particles,startedAt}=burst;
        const tail=atlasEndedAt===null ? 0 : bound((time-atlasEndedAt)/emberTailMs,0,1);
        burst.remainingMs=atlasEndedAt===null ? null : emberTailMs*(1-tail);
        if(tail>=1){this.removeEmbers(burst);continue;}
        const envelope=1-smooth(0,1,tail);
        const age=time-startedAt;
        let visible=0;
        burst.view.position.set(burst.x*w,burst.y*h);
        for(const {light,x,y,spread,delay,size,phase} of particles){
          if(age<delay)continue;
          const t=(age-delay)/1000, travel=1-Math.exp(-3.5*t);
          light.position.set(h*x*spread*(.039+.16*travel),
            h*(y*spread*(.029+.102*travel)-.038*t+.016*t*t));
          const scale=h*size*1.35/(720*24);
          light.scale.set(scale*(1-.34*tail)*(1-.22*Math.abs(y)),scale*(1-.37*tail));
          light.alpha=envelope*smooth(0,.065,t)*Math.min(1,.945+.35*Math.sin(17*t+phase));
          light.visible=true;
          visible++;
        }
        burst.visible=visible;
      }
    }
    removeEmbers(burst){
      burst.view.destroy({children:true,texture:false,baseTexture:false});
      this.embers.delete(burst);
    }
    draw(clock,time,w,h){
      if(this.disposed)return;
      if(this.screenLayer){
        this.drawStates(clock,w,h);
        this.drawFlights(clock,w,h);
        this.drawVideoFx(w,h);
      }
      for(const entry of this.active){
        if(clock<entry.start)continue;
        const {atlas,frames,sprite,next,info,impactClock}=entry;
        const {impactFrame,frameMs,impactHold=0}=atlas.layout;
        const phase=(impactClock===null ? clock-entry.start : Math.max(0,clock-impactClock-impactHold))/frameMs;
        const localFrame=impactClock===null ? bound(Math.floor(phase),0,impactFrame-1) : Math.floor(phase);
        const frame=impactClock===null ? localFrame : impactFrame+localFrame;
        const fade=entry.fadeAt===undefined?1:1-bound((clock-entry.fadeAt)/82,0,1);
        if(frame>=atlas.frames.length || !fade){
          if(fade && entry.emberPending && info.renderedImpactAt!==null)this.spawnEmbers(entry,time,w,h);
          this.remove(entry,time);
          continue;
        }
        const sub=bound(phase-localFrame,0,1-Number.EPSILON);
        const last=frame===atlas.frames.length-1;
        // Never crossfade an unreached impact into the preceding cell. After the hit
        // the authored hold leaves sub at zero until the original frame clock resumes.
        const canBlend=!!this.screenLayer && !last && (impactClock!==null || frame+1<impactFrame);
        const blend=canBlend ? smooth(.36,1,sub) : 0;
        const alpha=entry.alpha*fade*(last ? 1-smooth(.04,1,sub) : 1);
        info.sub=sub; info.blend=blend; info.nextFrame=canBlend ? frame+1 : null;
        sprite.alpha=info.alpha=alpha*(1-blend);
        next.alpha=info.nextAlpha=alpha*blend;
        if(info.startedAt===null)info.startedAt=time;
        if(frame!==info.frame){
          info.frame=frame;
          info.frames.push(frame);
          sprite.texture=frames[frame];
          if(canBlend)next.texture=frames[frame+1];
        }
        sprite.visible=true;
        next.visible=blend>0;
        this.position(entry,clock,w,h);
        if(entry.emberPending && impactClock!==null && frame>=Math.max(5,impactFrame+1))
          this.spawnEmbers(entry,time,w,h);
      }
      this.drawEmbers(time,w,h);
    }
    presented(time){
      for(const {atlas,info} of this.active)
        if(info.frame===atlas.layout.impactFrame && info.renderedImpactAt===null)
          info.renderedImpactAt=time;
    }
    remove(entry,time){
      entry.sprite.destroy();
      entry.next.destroy();
      if(entry.emberBurst && time!==undefined)entry.emberBurst.atlasEndedAt=time;
      entry.info.active=false;
      this.active.delete(entry);
    }
    clear(){
      this.stopVideoFx();
      for(const entry of this.active)this.remove(entry);
      for(const burst of this.embers)this.removeEmbers(burst);
      this.emberTexture?.destroy(true);
      this.emberTexture=null;
      for(const flight of this.flights)this.removeFlight(flight);
      for(const state of this.statuses.values())this.removeState(state);
    }
    inspect(){
      const ready=this.ultimateKeys?.filter(id=>this.atlases.has(variants[id]?.atlas || id)) || [];
      const live=this.activeVideo;
      const activeVideo=live ? {heroId:live.heroId,mirror:live.mirror,currentTime:live.video.currentTime,
        presentedMediaTime:live.mediaTime,firstPresentedTime:live.firstMediaTime,framesUploaded:live.framesUploaded,alpha:live.alpha,
        playing:!live.video.paused,playbackRate:live.video.playbackRate} : null;
      return {ready,active:[...this.active].map(entry=>entry.info),last:this.last,
        vfxVideos:[...this.vfxVideos.values()].filter(v=>!v.failed && v.video.readyState>=2).map(v=>v.id),
        activeVideo,
        embers:[...this.embers].map(({key,actor,count,visible,tint,startedAt,atlasEndedAt,remainingMs})=>
          ({key,actor,count,visible,tint,startedAt,atlasEndedAt,remainingMs})),
        artReady:[...this.artTextures.keys()],
        projectiles:[...this.flights].filter(f=>f.sprite).map(f=>({key:f.key,actor:f.actor,target:f.target,
          progress:f.progress,rotation:f.sprite.rotation,x:f.sprite.x,y:f.sprite.y,
          artKey:f.artKey,tint:f.tint,source:this.artTextures.get(f.artKey).source,blendMode:f.sprite.blendMode})),
        statuses:[...this.statuses.values()].map(s=>({key:s.key,target:s.target,phase:s.ending===null?'active':'release',
          rotation:s.sprite.rotation,perspective:s.view.scale.y/s.view.scale.x,source:s.art.source,blendMode:s.sprite.blendMode,
          x:s.view.x,y:s.view.y,layer:s.ground?'ground':'over'}))};
    }
    destroy(){
      this.disposed=true;
      this.clear();
      for(const entry of this.vfxVideos.values()){
        const {video}=entry;
        video.pause();
        video.removeAttribute('src');
        video.load();
        video.remove();
      }
      this.vfxVideos.clear();
      for(const {base,frames,renderFrames=frames} of this.atlases.values()){
        for(let i=0;i<frames.length;i++){
          if(renderFrames[i]!==frames[i])renderFrames[i].destroy();
          frames[i].destroy();
        }
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
