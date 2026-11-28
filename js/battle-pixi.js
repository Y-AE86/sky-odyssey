(() => {
  'use strict';
  const Sky = window.Sky = window.Sky || {};
  const P = window.PIXI;
  const tau = Math.PI * 2;
  const palette = {ink: 0xc18aff, ice: 0x8fefff, water: 0x69ebcd, light: 0xffdf87, gear: 0xffae61,
    blood: 0xff698f, thunder: 0x75bfff, fire: 0xff8449};
  const melee = new Set(['h01','h06','h08','h10','h11','enemy_vanguard']);
  const execution = new Set(['h01','h06','h11']);
  const imageCache = new Map();
  // Width, height and midpoint between the boots in the standing PNG.
  // Weapons and trailing capes often shift the centre of the image away from the feet.
  const stances = {
    h01:[1079,1081,.54], h02:[1028,1193,.49], h03:[946,1198,.57],
    h04:[1033,1239,.59], h05:[1240,1239,.52], h06:[1125,1239,.585],
    h07:[1016,1194,.50], h08:[1013,1272,.60], h09:[994,1243,.52],
    h10:[1073,1237,.49], h11:[884,1216,.52], enemy_boss_mech:[1282,1237,.54],
    enemy_vanguard:[1192,1152,.47], enemy_caster:[1156,1248,.50], enemy_striker:[1243,1102,.46]
  };
  const clamp = n => Math.max(0, Math.min(1, n));
  const shockwaveMs=260, chromaticMs=100;
  // Filter coordinates describe the captured rectangle in CSS pixels. inputSize
  // and inputClamp are supplied by Pixi for the actual DPR and pooled texture.
  const impactFragment=`
    precision highp float;
    varying vec2 vTextureCoord;
    uniform sampler2D uSampler;
    uniform vec4 inputSize, inputClamp, outputFrame;
    uniform vec2 uCenter, uSplitCenter, uSplitExtentInv;
    uniform float uRadius, uWidth, uAmplitude, uGlint, uSplit;

    void main() {
      vec2 uv = vTextureCoord;
      vec2 pixel = uv * inputSize.xy;
      float band = 0.0;
      float edge = 0.0;
      if (uAmplitude > 0.0) {
        vec2 delta = pixel + outputFrame.xy - uCenter;
        float radiusSquared = dot(delta, delta);
        float inner = max(0.0, uRadius - uWidth);
        float outer = uRadius + uWidth;
        if (radiusSquared >= inner * inner && radiusSquared < outer * outer) {
          float distance = sqrt(radiusSquared);
          float ring = (distance - uRadius) / uWidth;
          band = 1.0 - smoothstep(0.15, 1.0, abs(ring));
          vec2 room = min(pixel, outputFrame.zw - pixel);
          edge = smoothstep(1.0, 15.0, min(room.x, room.y));
          float bend = sin(ring * 3.14159) * band * edge * uAmplitude;
          uv -= delta / max(distance, 1.0) * bend * inputSize.zw;
        }
      }
      uv = clamp(uv, inputClamp.xy, inputClamp.zw);
      vec4 color = texture2D(uSampler, uv);
      if (uSplit > 0.0) {
        vec2 d = (pixel + outputFrame.xy - uSplitCenter) * uSplitExtentInv;
        float ellipse = dot(d, d);
        if (ellipse < 1.0) {
          float room = min(uv.x - inputClamp.x, inputClamp.z - uv.x) * inputSize.x;
          float weight = (1.0 - smoothstep(0.38, 1.0, ellipse)) * smoothstep(0.0, 9.0, room);
          vec2 split = vec2(uSplit * weight * inputSize.z, 0.0);
          color.r = mix(color.r, texture2D(uSampler, clamp(uv + split, inputClamp.xy, inputClamp.zw)).r, 0.78);
          color.b = mix(color.b, texture2D(uSampler, clamp(uv - split, inputClamp.xy, inputClamp.zw)).b, 0.78);
          color.a = max(color.a, max(color.r, color.b));
        }
      }
      // The backdrop is a CSS layer. A faint specular glint keeps the ripple
      // visible in transparent space, while the captured actors actually refract.
      float glint = band * band * uGlint * edge * (1.0 - color.a);
      gl_FragColor = color + vec4(vec3(0.72, 0.88, 1.0) * glint, glint);
    }`;

  class CameraImpulses {
    constructor(layer, renderer) {
      this.layer=layer;
      this.area=new P.Rectangle();
      const create=()=>new P.Filter(undefined,impactFragment,{
        uCenter:new Float32Array(2),uSplitCenter:new Float32Array(2),uSplitExtentInv:new Float32Array(2),
        uRadius:0,uWidth:1,uAmplitude:0,uGlint:0,uSplit:0
      });
      this.shockwaveFilter=create();
      this.chromaticFilter=create();
      // Both variants share the same program. Compile before the first impact.
      renderer.shader.bind(this.shockwaveFilter,true);
    }
    shockwave(time,targets,ground) {
      this.wave={time,targets,ground};
    }
    chromatic(time,target) {
      this.split={time,target};
    }
    draw(time,w,h,dpr,cam) {
      if(!this.wave && !this.split) return;
      if(this.wave && time-this.wave.time>=shockwaveMs)this.wave=null;
      if(this.split && time-this.split.time>=chromaticMs)this.split=null;
      if(!this.wave && !this.split){this.detach();return;}

      // Fuse simultaneous effects in one full-density pass. Each filter can also
      // run independently, with its inactive branch skipped inside the shader.
      const filter=this.wave ? this.shockwaveFilter : this.chromaticFilter;
      const u=filter.uniforms;
      if(this.wave) {
        const wave=this.wave, t=clamp((time-wave.time)/shockwaveMs);
        if(wave.targets) {
          let x=0,y=0;
          for(const target of wave.targets) {
            const point=target.pose;
            x+=point ? point.x/w : target.x+target.dx;
            const height=point ? point.size/h : .204*target.magnification*target.depth;
            y+=(point ? point.y/h : target.y+target.dy)-(wave.ground?0:height*.48);
          }
          wave.originX=x/wave.targets.length;
          wave.originY=y/wave.targets.length;
          wave.targets=null;
        }
        const strength=wave.ground?.72:1;
        wave.x=u.uCenter[0]=wave.originX*w*cam.zoom+cam.x;
        wave.y=u.uCenter[1]=wave.originY*h*cam.zoom+cam.y;
        wave.radius=u.uRadius=h*(.018+.29*(1-(1-t)**1.25));
        wave.amplitude=u.uAmplitude=4.2*strength*(1-t)**1.45;
        u.uWidth=Math.max(8,h*.026);
        u.uGlint=.11*strength*(1-t)**1.5;
        wave.progress=t;
      }else u.uAmplitude=u.uGlint=0;
      if(this.split) {
        const target=this.split.target, pose=target.pose;
        const size=pose?.size ?? h*.204*target.magnification*target.depth;
        const width=pose?.width ?? size;
        // Only the contact and its surrounding flare need the two extra samples.
        // Keep the rest of the camera clear, including unrelated faces.
        u.uSplitCenter[0]=(pose?.x ?? (target.x+target.dx)*w)*cam.zoom+cam.x;
        u.uSplitCenter[1]=((pose?.y ?? (target.y+target.dy)*h)-size*.48)*cam.zoom+cam.y;
        u.uSplitExtentInv[0]=1/(Math.max(width*.86+24,h*.18)*cam.zoom);
        u.uSplitExtentInv[1]=1/(Math.max(size*.79+20,h*.18)*cam.zoom);
        const t=clamp((time-this.split.time)/chromaticMs);
        this.split.offset=u.uSplit=4.2*Math.exp(-4.2*t)*(1-t);
        this.split.progress=t;
      }else u.uSplit=0;
      filter.resolution=dpr;
      this.area.width=w;
      this.area.height=h;
      if(this.current!==filter) {
        this.layer.filterArea=this.area;
        this.layer.filters=[filter];
        this.current=filter;
      }
    }
    detach() {
      if(!this.current)return;
      this.layer.filters=null;
      this.layer.filterArea=null;
      this.current=null;
    }
    inspect() {
      const {wave,split}=this, active=[];
      if(wave)active.push('shockwave');
      if(split)active.push('chromatic');
      return {active,shockwave:wave ? {x:wave.x,y:wave.y,radius:wave.radius,amplitude:wave.amplitude,
        progress:wave.progress,duration:shockwaveMs} : null,
        chromatic:split ? {offset:split.offset,progress:split.progress,duration:chromaticMs} : null};
    }
    destroy() {
      this.detach();
      this.wave=this.split=null;
      this.shockwaveFilter.destroy();
      this.chromaticFilter.destroy();
    }
  }

  // Flash inside the original silhouette, including thin hair and transparent weapons.
  if (P) {
    class ActorShader extends P.BatchShaderGenerator {
      generateSampleSrc(count) {return super.generateSampleSrc(count).replace(/vTextureCoord/g,'uv');}
    }
    class ActorBatch extends P.BatchRenderer {
      setShaderGenerator() {
        this.shaderGenerator=new ActorShader(P.BatchRenderer.defaultVertexSrc,`
          varying vec2 vTextureCoord; varying vec4 vColor; varying float vTextureId;
          uniform sampler2D uSamplers[%count%];
          vec4 actorPixel(vec2 uv){vec4 color; %forloop% return color;}
          void main(){
            vec4 base=actorPixel(vTextureCoord);
            if(vColor.r >= vColor.a*.02){gl_FragColor=base*vColor;return;}
            gl_FragColor=vec4(mix(base.rgb,vec3(1.,.98,.94)*base.a,.71),base.a)*vColor.a;
          }`);
      }
    }
    P.extensions.add({name:'skyBattleActors',type:P.ExtensionType.RendererPlugin,ref:ActorBatch});
  }

  function getImage(url) {
    if (!imageCache.has(url)) {
      const image = new Image();
      const loading = new Promise((resolve, reject) => {
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('无法读取战斗星灵原图'));
      });
      imageCache.set(url, loading);
      loading.catch(() => imageCache.delete(url));
      image.src = url;
    }
    return imageCache.get(url);
  }

  // The two painters use the same world coordinates. Canvas2D keeps battle playable
  // when the browser or operating system has disabled WebGL.
  class Paint {
    constructor(graphics, ctx) { this.g = graphics; this.ctx = ctx; }
    color(value, alpha) {
      return 'rgba(' + ((value >> 16) & 255) + ',' + ((value >> 8) & 255) + ',' + (value & 255) + ',' + alpha + ')';
    }
    ellipse(x, y, rx, ry, color, alpha, stroke = 0) {
      if (alpha <= 0 || rx <= 0 || ry <= 0) return;
      if (this.g) {
        this.g.lineStyle(stroke, color, alpha);
        if (!stroke) this.g.beginFill(color, alpha);
        this.g.drawEllipse(x, y, rx, ry);
        if (!stroke) this.g.endFill();
      } else {
        const c = this.ctx;
        c.beginPath(); c.ellipse(x,y,rx,ry,0,0,tau);
        if (stroke) { c.strokeStyle = this.color(color,alpha); c.lineWidth = stroke; c.stroke(); }
        else { c.fillStyle = this.color(color,alpha); c.fill(); }
      }
    }
    path(points, color, alpha, width = 0) {
      if (alpha <= 0) return;
      if (this.g) {
        const g = this.g;
        g.lineStyle(width,color,alpha);
        if (!width) g.beginFill(color,alpha);
        g.moveTo(points[0],points[1]);
        for(let i = 2; i < points.length; i += 2) g.lineTo(points[i],points[i+1]);
        if (!width) {g.closePath(); g.endFill();}
      } else {
        const c = this.ctx;
        c.beginPath(); c.moveTo(points[0],points[1]);
        for (let i = 2; i < points.length; i += 2) c.lineTo(points[i],points[i+1]);
        if (width) { c.strokeStyle = this.color(color,alpha); c.lineWidth = width; c.stroke(); }
        else { c.closePath(); c.fillStyle = this.color(color,alpha); c.fill(); }
      }
    }
  }
  function bounds(slot, side) {
    const row = slot % 3, front = slot < 3;
    const x = (front ? .386 : .225) - row * .062;
    const rearInset=front?0:(row+1)*.012;
    return {x: side === 'ally' ? x : 1-x-rearInset, y:(front ? .545 : .512)+row*.142,depth:[.88,.96,1.04][row]};
  }
  function polygon(cx,cy,rx,ry,sides,angle=0) {
    const points = [];
    for(let i = 0; i <= sides; i++) {
      const a = angle + i*tau/sides;
      points.push(cx+Math.cos(a)*rx,cy+Math.sin(a)*ry);
    }
    return points;
  }
  class BattleCamera {
    constructor() {this.reset();}
    reset() {
      this.zoom=1; this.x=this.y=this.focus=0;
      this.aim={x:.5,y:.5}; this.kick=null; this.move=null;
    }
    frame(aim,time) {
      const target=aim?1:0;
      this.move={from:this.focus,to:target,start:time,ms:aim?180:260};
      if(aim)this.aim=aim;
    }
    strike(dir,power,time) {this.kick={dir,power,start:time};}
    update(time,w,h,left,right) {
      if(this.move){
        const m=this.move,t=clamp((time-m.start)/m.ms);
        this.focus=m.from+(m.to-m.from)*t*t*(3-2*t);
        if(t===1)this.move=null;
      }
      let dx=0,dy=0,punch=0;
      if(this.kick){
        const {start,dir,power}=this.kick, t=clamp((time-start)/190);
        const wave=Math.cos(t*tau*2.5)*Math.exp(-4*t)*(1-t);
        dx=dir.x*w*power*wave; dy=(dir.y+.25)*h*power*wave;
        punch=.04*(power/.009)*Math.max(0,1-t*3)**2;
        if(t===1)this.kick=null;
      }
      const zoom=1+.115*this.focus+punch;
      const gutter=Math.max(6,w*.007);
      // Fit the current pose rectangles, including weapons, lunge and recoil.
      // Only spend as much horizontal camera movement as the frame can carry.
      this.zoom=right>left ? Math.min(zoom,(w-2*gutter)/(right-left)) : zoom;
      const desiredX=(1-this.zoom)*this.aim.x*w+(.5-this.aim.x)*.16*this.focus*w+dx;
      this.x=Math.max(gutter-left*this.zoom,Math.min(w-gutter-right*this.zoom,desiredX));
      this.y=(1-this.zoom)*this.aim.y*h+(.51-this.aim.y)*.12*this.focus*h+dy;
    }
  }
  class BattleScene {
    constructor(host, units, powerSave) {
      this.host = host;
      this.powerSave = powerSave;
      const hasBoss=units.some(unit=>unit.boss);
      this.nodes = units.map(u => {
        const sourceFacing=u.heroId.startsWith('enemy_') ? 'left' : 'right';
        const mirror=sourceFacing!==(u.side==='enemy' ? 'left' : 'right');
        const position=bounds(u.slot,u.side);
        // Keep both upper guards readable around the mech's wide wings.
        if(hasBoss && u.side==='enemy'){
          if(u.slot===0){position.x-=.058;position.y-=.026;}
          if(u.slot===3)position.x+=.020;
        }
        return {...position,key:u.key,slot:u.slot,side:u.side,heroId:u.heroId,sourceFacing,mirror,
          boss:u.boss,magnification:u.boss ? 1.52 : 1,hp:u.hp,maxHp:u.maxHp,shield:u.shield,rage:u.rage,
          status:{...u.status},sprite:null,dx:0,dy:0};
      });
      this.byKey = Object.fromEntries(this.nodes.map(n => [n.key,n]));
      this.nodes.sort((a,b) => a.y-b.y);
      this.camera = new BattleCamera();
      this.feedbackClock=0;
      this.hitstopRemaining=0;
      this.basicWindupMs=80;
      this.basicHitMs=255;
      this.trails=[];
      this.bursts=[];
      this.focus = null;
      this.effects = [];
      this.textures = new Map();
      this.ratio = window.devicePixelRatio || 1;
      this.canvas = document.createElement('canvas');
      this.canvas.setAttribute('aria-label','星盘战台，左方我队六个阵位，右方敌队六个阵位');
      this.domLayer = document.createElement('div');
      this.domLayer.className = 'battle-dom-units';
      this.domLayer.style.transformOrigin='0 0';
      this.rim=document.createElement('div');
      this.rim.setAttribute('aria-hidden','true');
      this.rim.style.cssText='position:absolute;inset:0;pointer-events:none;z-index:2;opacity:0';
      host.append(this.domLayer,this.canvas);
      (document.querySelector('#bleed[data-page="battle"]') || host).append(this.rim);
      // Avoid consuming two WebGL contexts just to test support. Renderer's exception
      // uses a fresh canvas, since a canvas cannot switch its context type.
      try {
        P.BaseTexture.defaultOptions.mipmap = P.MIPMAP_MODES.ON;
        P.BaseTexture.defaultOptions.scaleMode = P.SCALE_MODES.LINEAR;
        this.app = new P.Application({view:this.canvas, width:2,height:2, resolution:window.devicePixelRatio || 1,
          backgroundAlpha:0, autoDensity:true, antialias:true, powerPreference:'high-performance',
          autoStart:false, sharedTicker:false, eventMode:'none'});
        this.battleCamera = new P.Container();
        this.shadows = new P.Container();
        this.groundFxLayer = new P.Container();
        this.unitLayer = new P.Container();
        this.overFxLayer = new P.Container();
        this.flags = new P.Container();
        this.groundRings=new P.Graphics();
        this.sparks=new P.Graphics();
        this.sparks.blendMode=P.BLEND_MODES.ADD;
        this.groundFxLayer.addChild(this.groundRings);
        this.groundInk=new Paint(this.groundRings,null);
        this.sparkInk=new Paint(this.sparks,null);
        this.overlay = new P.Graphics();
        this.overFxLayer.addChild(this.overlay,this.sparks);
        this.battleCamera.addChild(this.shadows,this.groundFxLayer,this.unitLayer,this.overFxLayer);
        this.app.stage.addChild(this.battleCamera,this.flags);
        if(!powerSave)this.vfx=new Sky.BattleVfx(this.overFxLayer,this.app.renderer,this.byKey,this.groundFxLayer);
        this.app.ticker.maxFPS = powerSave ? 30 : 60;
        this.ink = new Paint(this.overlay,null);
      } catch (err) {
        const fresh = this.canvas.cloneNode(false);
        this.canvas.replaceWith(fresh); this.canvas = fresh;
        this.ctx = fresh.getContext('2d');
        this.shadowInk = this.ink = new Paint(null,this.ctx);
      }
      if(this.app && !powerSave)this.impulses=new CameraImpulses(this.battleCamera,this.app.renderer);
      this.resize();
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(host);
    }
    resize() {
      this.w = this.host.clientWidth;
      this.h = this.host.clientHeight;
      if (!this.w || !this.h) return;
      this.ratio = window.devicePixelRatio || 1;
      if (this.app) {
        this.app.renderer.resolution = this.ratio;
        this.app.renderer.resize(this.w,this.h);
      } else {
        this.canvas.width = Math.round(this.w*this.ratio);
        this.canvas.height = Math.round(this.h*this.ratio);
        this.ctx.imageSmoothingEnabled = true;
        this.ctx.imageSmoothingQuality = 'high';
      }
    }
    footMark(ink,enemy) {
      if(enemy) {
        // Fade the crimson spill into the ground beyond the brighter perimeter.
        for(let step=0;step<6;step++) {
          ink.ellipse(0,0,129-step*5,22-step*1.75,0xfb3159,.045+step*.011);
        }
      }
      ink.ellipse(0,0,100,12,0x20172f,.45);
      ink.ellipse(0,0,66,7.4,0x171123,.47);
      if(enemy){
        ink.ellipse(0,0,101,14.2,0x691330,.92,6);
        ink.ellipse(0,0,101,14.2,0xff536e,.97,3.7);
        ink.ellipse(0,0,91,10.9,0xffa3ab,.72,1.6);
      }
    }
    async load() {
      const heroes = [...new Set(this.nodes.map(n => n.heroId))];
      const offline = Sky.art.loadOfflineTextures();
      const effectsReady=this.vfx?.preload(heroes);
      const sources = await Promise.all(heroes.map(async id => {
        const fileImage=await getImage(Sky.art(id,'chibi'));
        const stance=stances[id];
        const original=stance && fileImage.naturalWidth===stance[0] && fileImage.naturalHeight===stance[1];
        const packed=original && (await offline)?.[id];
        let embeddedImage;
        if(packed) {
          try { embeddedImage=await getImage(packed); }
          catch { /* A damaged entry can still use the decoded local PNG. */ }
        }
        const direct=location.protocol==='file:' && !embeddedImage;
        return {id,direct,stance:original && stance,img:embeddedImage || fileImage};
      }));
      if (this.disposed) return;
      for(const {id,direct,stance,img} of sources) {
        let texture;
        if (this.app && !direct) {
          const base = new P.BaseTexture(img,{mipmap:P.MIPMAP_MODES.ON, scaleMode:P.SCALE_MODES.LINEAR, anisotropicLevel:8});
          texture = new P.Texture(base);
          this.textures.set(id,texture);
        }
        for(const n of this.nodes.filter(n => n.heroId === id)) {
          n.image = img;
          n.footX=stance ? stance[2] : .5;
          n.footY=stance ? 1-16/img.naturalHeight : .985;
          // The standing PNGs leave 16px on each edge of the silhouette.
          n.heightFactor=stance ? .972/(1-32/img.naturalHeight) : 1;
          if (texture) {
            n.sprite = new P.Sprite(texture);
            n.sprite.anchor.set(n.footX,n.footY);
            n.sprite.eventMode = 'none';
            n.sprite.pluginName = 'skyBattleActors';
            // Store the ally and enemy ground geometry once, then move each instance.
            this.shadowShapes ||= {};
            if(!this.shadowShapes[n.side]) {
              const shape=new P.Graphics();
              this.footMark(new Paint(shape,null),n.side==='enemy');
              this.shadowShapes[n.side]=shape;
            }
            n.shadow=this.shadowShapes[n.side].clone();
            this.shadows.addChild(n.shadow);
          } else if (this.app && direct) {
            const body = document.createElement('div');
            body.className='battle-file-unit '+n.side;
            const shadow = document.createElement('i');
            const portrait = img.cloneNode();
            portrait.alt = '';
            body.append(shadow,portrait);
            this.domLayer.append(body);
            n.dom = {body,shadow,portrait};
          }
        }
      }
      for(const n of this.nodes) {
        if(n.sprite) this.unitLayer.addChild(n.sprite);
        if(this.app) {
          n.flag=new P.Graphics();
          n.flagInk=new Paint(n.flag,null);
          this.flags.addChild(n.flag);
        }
      }
      this.ready = true;
      this.render(performance.now(),0);
      await effectsReady;
    }
    planUltimate(action,clock) {
      this.ultimatePlan=this.vfx?.plan(action,clock);
      return this.ultimatePlan;
    }
    state(units) {
      for(const u of units) Object.assign(this.byKey[u.key],{hp:u.hp,shield:u.shield,rage:u.rage,status:{...u.status}});
    }
    attackSound(key) {return melee.has(this.byKey[key].heroId)?'slash':'cast';}
    advanceClock(delta) {
      // Freeze only the battle timeline. Camera impulses, hit colours, buttons and
      // the next presentation frame continue on the live render ticker.
      this.feedbackClock+=delta;
      const held=Math.min(delta,this.hitstopRemaining);
      this.hitstopRemaining-=held;
      return delta-held;
    }
    beginAction(action,clock) {
      this.actionStart=clock; this.trailIndex=0;
      this.openingImpact=true;
      const n=this.byKey[action.actor], target=this.byKey[action.hits[0]?.target];
      if(!target)return;
      if(action.kind==='basic')this.vfx?.launchBasic(action,clock,this.basicHitMs);
      if(action.kind==='ultimate' && !this.powerSave){
        const targets=[...new Set(action.hits.map(hit=>this.byKey[hit.target]))];
        const cx=targets.reduce((sum,t)=>sum+t.x,0)/targets.length;
        const cy=targets.reduce((sum,t)=>sum+t.y,0)/targets.length;
        this.camera.frame({x:(n.x+cx*2)/3,y:(n.y+cy*2)/3-.11},this.feedbackClock);
      }
    }
    elapsedAction(actor,target,progress,dash,elapsed=progress*430) {
      const n=this.byKey[actor],dest=this.byKey[target];
      if(!n || !dest || !dash)return;
      const dir=n.side==='ally'?1:-1, close=melee.has(n.heroId);
      const windup=this.basicWindupMs;
      const pull=Math.sin(clamp(elapsed/windup)*Math.PI*.5)*.013;
      if(elapsed<windup){n.dx=-dir*pull; n.dy=0; return;}
      const lunge=clamp((elapsed-windup)/135);
      const reach=1-2**(-9*lunge);
      const back=clamp((elapsed-this.basicHitMs)/(430-this.basicHitMs));
      const settle=(1-back)**2*(1-2*back);
      if(close){
        const step=reach*settle;
        n.dx=((dest.x-n.x)*.82*step)-dir*pull*(1-reach);
        n.dy=(dest.y-n.y)*.78*step-Math.sin(lunge*Math.PI)*.035;
        while(n.sprite && !this.powerSave && this.trailIndex<4){
          const at=windup+8+this.trailIndex*23;
          if(elapsed<at)break;
          this.trailIndex++;
          if(elapsed-at<180)this.afterimage(n,dest,at);
        }
      }else{
        const recoil=clamp((elapsed-windup)/120);
        n.dx=dir*(.009*Math.sin(recoil*Math.PI*2)*(1-recoil)-pull*(1-recoil));
        n.dy=-.003*Math.sin(recoil*Math.PI);
      }
    }
    afterimage(n,dest,at) {
      const ghost=new P.Sprite(n.sprite.texture), t=(at-this.basicWindupMs)/135, reach=1-2**(-9*t);
      ghost.eventMode='none';
      ghost.anchor.copyFrom(n.sprite.anchor);
      ghost.scale.copyFrom(n.sprite.scale);
      ghost.blendMode=P.BLEND_MODES.ADD;
      ghost.tint=palette[Sky.D.hero(n.heroId).element];
      const dir=n.side==='ally'?1:-1;
      ghost.position.set((n.x+(dest.x-n.x)*.82*reach-dir*.013*(1-reach))*this.w,
        (n.y+(dest.y-n.y)*.78*reach-Math.sin(t*Math.PI)*.035)*this.h);
      this.unitLayer.addChildAt(ghost,this.unitLayer.getChildIndex(n.sprite));
      this.trails.push({sprite:ghost,start:this.actionStart+at});
    }
    resetMotion(clearEffects=false) {
      if(this.focus && !this.powerSave){
        this.previousFocus=this.focus;
        this.camera.frame(null,this.feedbackClock);
      }
      this.focus=null;
      this.ultimatePlan=null;
      if(clearEffects){
        this.effects.length=0;
        this.bursts.length=0; this.lastImpact=null; this.hitstopRemaining=0;
        this.camera.reset(); this.previousFocus=null;
        this.rim.style.opacity=0; this.rimStart=null;
        for(const t of this.trails)t.sprite.destroy();
        this.trails.length=0;
        this.groundRings?.clear(); this.sparks?.clear();
        this.overlay?.clear();
        this.vfx?.destroy();
        this.impulses?.destroy();
        this.impulses=null;
      }
      for(const n of this.nodes){n.dx=n.dy=0;if(clearEffects)n.reaction=null;}
    }
    hit(actor,hit,element,ultimate,clock,effectClock,index,due,meta={}) {
      const n = this.byKey[hit.target];
      if (!n) return;
      n.hp = hit.hp; n.shield = hit.shield;
      if(hit.rage!==undefined)n.rage=hit.rage;
      if(hit.status)n.status={...hit.status};
      if(hit.periodic){
        this.effects.push({actor:hit.source || actor,target:n.key,element:'fire',periodic:true,start:clock,duration:330});
        return;
      }
      const damage=hit.kind==='damage', plan=ultimate ? this.ultimatePlan : null;
      const finisher=ultimate && !!meta.finisher;
      const entries=plan?.byHit.get(index);
      const attacker=this.byKey[actor];
      if(this.impulses && ultimate && (damage ? n.side!==attacker.side : n.side===attacker.side)) {
        if(this.openingImpact || finisher) {
          const group=entries?.find(entry=>entry.info.role==='group');
          this.impulses.shockwave(clock,group ? group.info.targets.map(key=>this.byKey[key]) : [n],
            !damage && hit.kind==='heal');
        }
        if(damage && (hit.crit || finisher || (this.openingImpact && execution.has(attacker.heroId))))
          this.impulses.chromatic(clock,n);
        this.openingImpact=false;
      }
      const progression=meta.beats>1?clamp((meta.beat-1)/(meta.beats-1)):0;
      if(damage){
        const source=this.byKey[hit.source || actor];
        const dx=(n.x-source.x)*this.w,dy=(n.y-source.y)*this.h,dist=Math.hypot(dx,dy)||1;
        const dir={x:dx/dist,y:dy/dist};
        const heavy=hit.crit || finisher;
        const hold=this.powerSave?0:heavy?72:!ultimate?43:0;
        this.hitstopRemaining=Math.max(this.hitstopRemaining,hold);
        n.reaction={dir,start:this.feedbackClock,motionStart:effectClock};
        const sparks=this.powerSave?0:heavy?14:ultimate?9+Math.round(4*progression):8;
        this.lastImpact={actor,target:n.key,critical:!!hit.crit,finisher,hold,sparks,beat:meta.beat,beats:meta.beats};
        if(!this.powerSave){
          const power=heavy?.009:ultimate?.0058+.002*progression:.0045;
          this.camera.strike(dir,power,this.feedbackClock);
          this.bursts.push({start:effectClock,x:n.x+n.dx,y:n.y+n.dy,dir,color:palette[element],count:sparks,heavy});
          if(heavy || ultimate){
            this.rimStart=this.feedbackClock;
            this.rim.style.boxShadow='inset 0 0 '+(heavy?3.2:1.9)+'cqw #'+palette[element].toString(16).padStart(6,'0');
          }
        }
      }else{
        if(hit.kind==='heal')this.vfx?.healRing(n.key,effectClock);
        if(finisher && !this.powerSave){
          this.hitstopRemaining=Math.max(this.hitstopRemaining,65);
          this.camera.strike({x:this.byKey[actor].side==='ally'?.70:-.70,y:-.52},.009,this.feedbackClock);
          this.lastImpact={actor,target:n.key,critical:false,finisher,hold:65,sparks:0,beat:meta.beat,beats:meta.beats};
        }
      }
      if(plan)this.vfx.impact(entries,effectClock,clock);
      const covered=plan && (plan.targets.has(index) || !damage);
      if(!covered){
        const spark=damage && (!ultimate || plan) && this.vfx?.spark(actor,n.key,index,due,effectClock,clock);
        if(!spark){
          const fallbackUltimate=ultimate && !plan;
          this.effects.push({actor,target:n.key,element,ultimate:fallbackUltimate,start:clock,duration:fallbackUltimate?625:325});
        }
      }
    }
    effect(p,e,time) {
      const actor=this.byKey[e.actor], target=this.byKey[e.target];
      const w=this.w,h=this.h, x=(target.x+target.dx)*w,y=(target.y+target.dy-.10)*h;
      const t=clamp((time-e.start)/e.duration), fade=1-t, color=palette[e.element] || palette.light;
      const dir=actor.side==='ally' ? 1 : -1, cx=(actor.x+actor.dx)*w,cy=(actor.y+actor.dy-.1)*h;
      const r=h*(e.ultimate ? .19 : .07), k=t*r;
      if(e.periodic){
        for(let i=0;i<3;i++){
          const xx=x+(i-1)*r*.40,yy=y-t*r*.8+(i%2)*r*.36;
          p.path([xx-r*.11,yy+r*.32,xx,yy+r*.11,xx+r*.09,yy-r*.30,xx+r*.18,yy+r*.03],
            color,fade,h*.004*fade);
        }
      } else if (!e.ultimate) {
        p.path([x-dir*r*.7,y+r*.4,x+dir*r*.5*fade,y-r*.35],0xffefc5,fade,h*.005*fade);
      } else if (e.element==='ice') {
        for(let i=0;i<6;i++) {
          const xx=x+(i-2.5)*r*.24, yy=y-r*(1.7+Math.sin(i)*.5)*(1-t);
          p.path([xx-r*.12,yy-r*.5,xx+r*.045,yy-r*.27,xx+r*.04,yy+r*.13,xx-r*.06,yy-r*.025],color,fade*.9);
          p.path([xx-r*.12,yy-r*.5,xx+r*.04,yy+r*.13],0xeaffff,fade,h*.002);
        }
      } else if (e.element==='ink') {
        // The curved ribbons taper at both ends. A slender silver core follows
        // the same blade while the shorter trail opens into seven ink petals.
        const sweep=.65+.60*t, petals=.38+.80*Math.sin(t*Math.PI*.8);
        for(let j=0;j<2;j++) {
          const edge=[],inner=[],spine=[];
          for(let i=0;i<=18;i++) {
            const f=i/18, wgt=Math.sin(f*Math.PI),xx=x+dir*(f-.5)*r*(2.25+j*.30)*sweep;
            const yy=y+r*((f-.48)*.76-wgt*(.58+j*.19)+(j-.5)*.33)+r*.13*t;
            edge.push(xx,yy);
            inner.unshift(xx,yy+r*wgt*(j?.085:.16)*fade);
            if(i>1&&i<18) spine.push(xx,yy+r*wgt*.02);
          }
          p.path([...edge,...inner],j?0xc089fd:0x7d39ce,fade*(j?.83:.9));
          p.path(spine,j?0xf5d6ff:0xe5b8ff,fade*.94,h*.0028);
        }
        for(let j=0;j<7;j++) {
          const a=-Math.PI*.92+j*Math.PI*.14, length=r*(.36+(j%2)*.14)*petals;
          const vx=Math.cos(a)*length, vy=Math.sin(a)*length, px=-vy*.18,py=vx*.18;
          const baseY=y+r*.18;
          p.path([x,baseY,x+vx*.26+px,baseY+vy*.26+py,x+vx*.66+px,baseY+vy*.66+py,
            x+vx,baseY+vy,x+vx*.62-px,baseY+vy*.62-py,x+vx*.30-px,baseY+vy*.30-py],j%2?0xca85ff:0x9050ed,fade*.61);
          p.path([x,baseY,x+vx*.46,baseY+vy*.46,x+vx,baseY+vy],0xf2d4ff,fade*.78,h*.0018);
        }
      } else if (e.element==='blood') {
        for(let j=0;j<3;j++) {
          const path=[];
          for(let i=0;i<=13;i++) {
            const f=i/13, xx=(f-.5)*r*2;
            path.push(x+dir*xx, y+(j-1)*r*.25+Math.sin(f*Math.PI)*r*.5+(f-.5)*r*.6);
          }
          p.path(path,color,fade*.85,h*.012*fade+h*.002);
        }
      } else if (e.element==='light') {
        p.path(polygon(x,y,r*(.5+t*.3),r*(.72+t*.2),6,-Math.PI/2),color,fade,h*.006);
        p.path(polygon(x,y,r*.42,r*.54,4,0),0xffffdd,fade*.9,h*.003);
        p.path([x-r*.5,y,x+r*.5,y,x,y,x,y-r*.88],color,fade,h*.007);
      } else if (e.element==='gear') {
        const end=Math.min(1,t*3+.35);
        for(let j=-1;j<=1;j++) {
          const off=j*r*.09;
          p.path([cx+(x-cx)*Math.max(0,end-.6),cy+(y-cy)*Math.max(0,end-.6)+off,cx+(x-cx)*end,cy+(y-cy)*end+off],color,fade,h*.008);
        }
        p.path(polygon(x,y,r*.47,r*.47,8,t*2),0xffe2a4,fade,h*.003);
      } else {
        for(let i=0;i<3;i++) {
          const rr=r*((i+1)/4+t*.7);
          p.ellipse(x,y+r*.3,rr,rr*.34,color,fade,h*.004);
        }
        for (let i=0;i<2;i++) {
          const a=t*tau*.65+i*Math.PI, fx=x+Math.cos(a)*r*.57,fy=y+Math.sin(a)*r*.24;
          p.path([fx-r*.14,fy,fx,fy-r*.055,fx+r*.085,fy,fx,fy+r*.04],0xffdf83,fade);
          p.path([fx-r*.10,fy,fx-r*.19,fy-r*.065,fx-r*.18,fy+r*.05],0xffdf83,fade);
        }
      }
      if (e.ultimate) {
        const groundY=(target.y+target.dy)*h;
        const ringR=r*(.18+1.04*Math.sqrt(t));
        p.ellipse(x,groundY,ringR,ringR*.26,color,fade*.83,h*.005);
        p.ellipse(x,groundY,ringR*.90,ringR*.234,0xffedc8,fade*.68,h*.002);
        for(let i=0;i<8;i++) {
          const a=i*tau/8+.18;
          const sx=x+Math.cos(a)*ringR*.94,sy=groundY+Math.sin(a)*ringR*.245;
          const size=r*(i%2 ? .035 : .055)*fade;
          p.path([sx,sy-size,sx+size*.48,sy,sx,sy+size,sx-size*.48,sy],i%2?color:0xffe5af,fade*.86);
        }
        const flash=Math.max(0,1-t/.43);
        if(flash>0){
          const core=r*(.10+.18*flash);
          p.ellipse(x,y,core,core*.65,color,flash*.21);
          p.path([x-core*1.6,y,x-core*.11,y-core*.16,x,y-core*1.33,x+core*.12,y-core*.16,
            x+core*1.6,y,x+core*.12,y+core*.13,x,y+core,x-core*.11,y+core*.14],0xfffbeb,flash*.94);
        }
      }
      const count=this.powerSave ? 4 : e.ultimate ? 46 : 9;
      const spray=e.ultimate?r*Math.pow(t,.68):k;
      for(let i=0;i<count;i++) {
        const a=i*2.39996 + target.slot*.69, speed=.46+(i%7)*.18;
        const xx=x+Math.cos(a)*spray*speed, yy=y+Math.sin(a)*spray*speed+t*t*r*.24;
        const l=h*(i%5===0 ? .021 : .009)*fade;
        const dx=Math.cos(a)*l,dy=Math.sin(a)*l;
        if(e.ultimate && i%3===0){
          p.path([xx+dx,yy+dy,xx-dy*.26,yy+dx*.26,xx-dx*.6,yy-dy*.6,xx+dy*.26,yy-dx*.26],0xfff8e7,fade);
        }else p.path([xx,yy,xx-dx,yy-dy],color,fade*.95,h*.0034*fade+.25);
      }
      p.ellipse(x,y,Math.max(0.1,k*.58),Math.max(0.1,k*.58),color,fade*.56,h*.0035*fade+.3);
    }
    flagGeometry(ink,n,x,y,alpha) {
      const bw=this.w*48/1280,bh=Math.max(2,this.h*4/720);
      const col=n.side==='ally'?0x71e4b9:0xf490a3;
      const left=x-bw*.5, right=x+bw*.5, top=y-bh*.5, bottom=y+bh*.5, edge=bh*.22;
      ink.path([left-edge,top-edge,right+edge,top-edge,right+edge,bottom+edge,left-edge,bottom+edge],0x162034,alpha);
      if(n.hp){
        const end=left+bw*clamp(n.hp/n.maxHp);
        ink.path([left,top,end,top,end,bottom,left,bottom],col,alpha);
        ink.path([left,top+edge*.56,end,top+edge*.56],0xf4fff9,.72*alpha,edge);
      }
      if(n.shield>0){
        const end=left+bw*clamp((n.hp+n.shield)/n.maxHp);
        const start=end-bw*clamp(n.shield/n.maxHp);
        ink.path([start,top,end,top,end,bottom,start,bottom],0xf5fcff,alpha);
      }
      for(let i=0;i<4;i++){
        const mid=x+(i-1.5)*bh*1.9, cy=bottom+bh*1.04, r=bh*.62;
        const lit=n.rage>=(i+1)*25, gold=n.rage>=100;
        ink.path([mid-r-edge,cy,mid,cy-r-edge,mid+r+edge,cy,mid,cy+r+edge],0x15192a,.94*alpha);
        ink.path([mid-r,cy,mid,cy-r,mid+r,cy,mid,cy+r],lit?(gold?0xffdc87:0x9ee4ef):0x536074,alpha);
      }
    }
    flagPoint(key) {
      const n=this.byKey[key],cam=this.camera;
      if(!n)return null;
      const x=n.pinX ?? n.x*this.w;
      const y=n.pinY ?? (n.y-.22)*this.h;
      return {x:x*cam.zoom+cam.x,y:(y-this.h*2.4/720)*cam.zoom+cam.y};
    }
    drawBursts(clock,ground) {
      const ink=ground?(this.groundInk || this.ink):(this.sparkInk || this.ink),w=this.w,h=this.h;
      for(const b of this.bursts){
        const t=clamp((clock-b.start)/270),fade=1-t;
        const x=b.x*w,y=b.y*h,k=1-Math.exp(-3.5*t);
        if(ground){
          const r=(b.heavy?.075:.044)*h*(.19+k);
          ink.ellipse(x,y,r,r*.28,b.color,.64*fade,Math.max(.55,h*.0023*fade));
          continue;
        }
        const aim=Math.atan2(b.dir.y,b.dir.x), cy=y-.10*h;
        for(let i=0;i<b.count;i++){
          const a=aim+Math.sin(i*2.4+1.12)*1.12;
          const vx=Math.cos(a),vy=Math.sin(a);
          const length=h*(.046+(i%5)*.014)*(b.heavy?1.28:1);
          const d=length*(.12+.88*k);
          const xx=x+vx*d, yy=cy+vy*d+.038*h*t*t;
          const tail=h*(.005+(i%3)*.003)*fade;
          ink.path([xx,yy,xx-vx*tail,yy-vy*tail],i%3===0?0xfff0d2:b.color,fade*.9,Math.max(.5,h*.0023*fade));
        }
      }
    }
    actorPose(n,clock) {
      const age=n.reaction?this.feedbackClock-n.reaction.start:Infinity;
      const poseAge=n.reaction?clock-n.reaction.motionStart:Infinity;
      if(n.hp<=0 && poseAge>=190)return null;
      const w=this.w,h=this.h,t=clamp(poseAge/190);
      const push=(1-t)**2*Math.cos(t*Math.PI*1.55);
      const recoil=push*w*(this.powerSave?.004:.018);
      const rx=n.reaction?.dir.x ?? 0,ry=n.reaction?.dir.y ?? 0;
      const x=(n.x+n.dx)*w+rx*recoil,y=(n.y+n.dy)*h+ry*recoil;
      const stretch=this.powerSave?0:push,tilt=rx*.12*stretch;
      const breath=this.powerSave?1:1+.007*Math.sin(clock/540+n.slot*1.8);
      const size=h*.204*n.magnification*n.depth*breath*n.heightFactor;
      const width=size*n.image.naturalWidth/n.image.naturalHeight;
      const sign=n.mirror ? -1 : 1,sx=sign*(1-.18*stretch),sy=1+.15*stretch;
      const horizontal=width*Math.abs(sx)*Math.cos(tilt);
      const anchor=sign<0?1-n.footX:n.footX;
      const slant=-Math.sin(tilt)*size*sy;
      const upper=-n.footY*slant,lower=(1-n.footY)*slant;
      return {x,y,size,width,sx,sy,tilt,white:age<50,red:age>=50 && age<115,
        left:x-horizontal*anchor+Math.min(upper,lower),right:x+horizontal*(1-anchor)+Math.max(upper,lower)};
    }
    render(time,effectClock=0) {
      if (!this.ready || this.disposed || !this.w) return;
      if (window.devicePixelRatio !== this.ratio) this.resize();
      const w=this.w,h=this.h, c=this.ctx;
      if (this.app) {if(this.effects.length || this.drewEffects) this.overlay.clear();}
      else {c.setTransform(this.ratio,0,0,this.ratio,0,0); c.clearRect(0,0,w,h);}
      const cam=this.camera;
      let left=Infinity,right=-Infinity;
      for(const n of this.nodes){
        n.pose=this.actorPose(n,effectClock);
        if(!n.pose)continue;
        left=Math.min(left,n.pose.left);
        right=Math.max(right,n.pose.right);
      }
      cam.update(this.feedbackClock,w,h,left,right);
      if(this.app){
        this.battleCamera.position.set(cam.x,cam.y); this.battleCamera.scale.set(cam.zoom);
        this.flags.position.set(cam.x,cam.y); this.flags.scale.set(cam.zoom);
        if(this.domLayer.childElementCount)this.domLayer.style.transform='translate('+cam.x+'px,'+cam.y+'px) scale('+cam.zoom+')';
      }else{c.translate(cam.x,cam.y);c.scale(cam.zoom,cam.zoom);}
      if(this.rimStart!=null){
        const t=clamp((this.feedbackClock-this.rimStart)/40);
        this.rim.style.opacity=String(.52*(1-t));
        if(t===1)this.rimStart=null;
      }
      if(this.bursts.length || this.drewBursts){this.groundRings?.clear();this.sparks?.clear();}
      this.bursts=this.bursts.filter(b=>effectClock-b.start<270);
      this.drewBursts=this.bursts.length>0;
      this.drawBursts(effectClock,true);
      for(let i=this.trails.length-1;i>=0;i--){
        const trail=this.trails[i],age=effectClock-trail.start;
        if(age>=180){trail.sprite.destroy();this.trails.splice(i,1);}
        else trail.sprite.alpha=.32*(1-clamp(age/180))**1.4;
      }
      for(const n of this.nodes) {
        const visible=!!n.pose;
        if(n.sprite) n.sprite.visible=n.shadow.visible=visible;
        if(n.flag) n.flag.visible=visible;
        if(n.dom) n.dom.body.hidden=!visible;
        if(!visible) continue;
        const {x,y,size,width,sx,sy,tilt,white,red}=n.pose;
        const lit=this.focus || this.previousFocus;
        const alpha=lit && !lit.has(n.key) ? 1-.65*(this.powerSave?Number(!!this.focus):cam.focus) : 1;
        const shadowWidth=size*.30*(1-Math.min(.30,Math.abs(n.dx)));
        const shadowAlpha=n.side==='enemy' ? Math.max(.68,alpha) : alpha;
        if(n.shadow) {
          n.shadow.position.set((n.x+n.dx)*w,(n.y+n.dy*.60)*h-1);
          n.shadow.scale.set(shadowWidth/100,size*.050/12);
          n.shadow.alpha=shadowAlpha;
        } else if (!n.dom) {
          c.save();c.translate(x,(n.y+n.dy*.60)*h-1);c.scale(shadowWidth/100,size*.050/12);
          c.globalAlpha=shadowAlpha;this.footMark(this.shadowInk,n.side==='enemy');c.restore();
        }
        if(n.dom) {
          const {body,shadow,portrait}=n.dom;
          body.style.cssText='left:'+x+'px;top:'+y+'px;z-index:'+Math.round(n.y*100);
          portrait.style.cssText='width:'+width+'px;height:'+size+'px;left:'+(-width*n.footX)+'px;top:'+(-size*n.footY)+
            'px;transform-origin:'+n.footX*100+'% '+n.footY*100+'%;transform:rotate('+tilt+'rad) scale('+sx+','+sy+
            ');filter:'+(white?'brightness(2.4)':red?'sepia(1) saturate(4) brightness(.65)':'brightness('+alpha+')');
          shadow.style.cssText='width:'+shadowWidth*2+'px;height:'+size*.10+'px;opacity:'+shadowAlpha+';top:'+(-n.dy*.40*h)+'px';
        } else if(n.sprite) {
          n.sprite.position.set(x,y);
          n.sprite.scale.set(sx*width/n.image.naturalWidth,sy*size/n.image.naturalHeight);
          n.sprite.rotation=tilt;
          n.sprite.tint=white?0x00ffff:red?0xa7384c:Math.round(alpha*255)*0x010101;
        } else {
          c.save(); c.translate(x,y);c.rotate(tilt); c.scale(sx,sy);
          if(white || red || alpha<1)c.filter=white?'brightness(2.4)':red?'sepia(1) saturate(4) brightness(.65)':'brightness('+alpha+')';
          c.drawImage(n.image,-width*n.footX,-size*n.footY,width,size); c.restore();
        }
        // Each flag and gauge is vector geometry at the canvas' actual backing density.
        n.pinX=x; n.pinY=y-size*sy-h*.010;
        if(n.flag) {
          n.flag.position.set(n.pinX,n.pinY); n.flag.alpha=alpha;
          if(n.flagHP!==n.hp || n.flagShield!==n.shield || n.flagRage!==n.rage || n.flagW!==w || n.flagH!==h) {
            n.flag.clear(); this.flagGeometry(n.flagInk,n,0,0,1);
            n.flagHP=n.hp; n.flagShield=n.shield; n.flagRage=n.rage; n.flagW=w; n.flagH=h;
          }
        } else this.flagGeometry(this.ink,n,n.pinX,n.pinY,alpha);
      }
      this.drawBursts(effectClock,false);
      this.effects=this.effects.filter(e=>time-e.start<e.duration);
      this.drewEffects=this.effects.length>0;
      for(const e of this.effects) this.effect(this.ink,e,time);
      if(this.app){
        this.vfx?.draw(effectClock,time,w,h);
        this.impulses?.draw(time,w,h,this.ratio,cam);
        this.app.render();
        this.vfx?.presented(time);
      }
    }
    inspect() {
      const vfx=this.vfx?.inspect() || {ready:[],active:[],last:null,artReady:[],projectiles:[],statuses:[],embers:[]};
      vfx.procedural=[...new Set(this.effects.filter(e=>e.ultimate).map(e=>this.byKey[e.actor].heroId))];
      return {renderer:this.app?'pixi-webgl':'canvas2d',resolution:this.ratio, canvas:[this.canvas.width,this.canvas.height],
        camera:{zoom:this.camera.zoom,x:this.camera.x,y:this.camera.y,kick:!!this.camera.kick,focus:this.camera.focus,
          hitstopRemaining:this.hitstopRemaining,filters:this.impulses?.inspect() || {active:[],shockwave:null,chromatic:null}},
        impact:this.lastImpact||null,
        layers:this.app?['groundFxLayer','unitLayer','overFxLayer']:[],
        stage:[this.w,this.h],positions:this.nodes.map(n=>({key:n.key,heroId:n.heroId,x:n.x,y:n.y,mirror:n.mirror,
          sourceFacing:n.sourceFacing,depth:n.depth,boss:n.boss,magnification:n.magnification,
          artwork:'original',source:n.dom?'native-image':this.app?'pixi-texture':'canvas-image'})),textures:[...this.textures].map(([heroId,t])=>({heroId,
          width:t.baseTexture.realWidth,height:t.baseTexture.realHeight,mipmap:t.baseTexture.mipmap,scaleMode:t.baseTexture.scaleMode})),ready:!!this.ready,
        vfx,ultimateVfx:vfx};
    }
    destroy() {
      this.disposed=true;
      this.rim.remove();
      this.observer.disconnect();
      if(this.app) {
        this.impulses?.destroy();
        this.impulses=null;
        this.vfx?.destroy();
        this.app.destroy(true,{children:true,texture:false,baseTexture:false});
        for(const shape of Object.values(this.shadowShapes||{}))shape.destroy();
        for(const t of this.textures.values()) t.destroy(true);
      }
      this.host.replaceChildren();
    }
  }
  Sky.BattleScene=BattleScene;
})();
