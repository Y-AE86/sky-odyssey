(() => {
  'use strict';
  const Sky = window.Sky = window.Sky || {};
  const P = window.PIXI;
  const tau = Math.PI * 2;
  const palette = {ink: 0xc18aff, ice: 0x8fefff, water: 0x69ebcd, light: 0xffdf87, gear: 0xffae61, blood: 0xff698f};
  const accents = {东煌: 0x76dfd2, 圣辉: 0xffdf9c, 机巧: 0xffb07d, 秘影: 0xbc9bff};
  const imageCache = new Map();
  const clamp = n => Math.max(0, Math.min(1, n));
  // Use the existing RGBA vertex channel as a per-sprite flash flag. A direct
  // fragment blend gives the same premultiplied white silhouette without creating
  // an extra off-screen render target for every unit struck by an area attack.
  if (P) {
    class ActorBatch extends P.BatchRenderer {
      setShaderGenerator() {
        super.setShaderGenerator({fragment:
          'varying vec2 vTextureCoord; varying vec4 vColor; varying float vTextureId; uniform sampler2D uSamplers[%count%];' +
          'void main(void){ vec4 color; %forloop% if(vColor.r<vColor.a*0.02){ gl_FragColor=vec4(mix(color.rgb,vec3(color.a),0.79),color.a)*vColor.a; } else { gl_FragColor=color*vColor; } }'});
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
    const x = (front ? .38 : .216) - row * .055;
    return {x: side === 'ally' ? x : 1-x, y: (front ? .55 : .526) + row * .129, depth: .92 + row * .08};
  }
  function polygon(cx,cy,rx,ry,sides,angle=0) {
    const points = [];
    for(let i = 0; i <= sides; i++) {
      const a = angle + i*tau/sides;
      points.push(cx+Math.cos(a)*rx,cy+Math.sin(a)*ry);
    }
    return points;
  }
  class BattleScene {
    constructor(host, units, powerSave) {
      this.host = host;
      this.powerSave = powerSave;
      this.nodes = units.map(u => ({...bounds(u.slot,u.side),key:u.key,slot:u.slot,side:u.side,heroId:u.heroId,
        boss:u.boss, hp:u.hp,maxHp:u.maxHp,shield:u.shield,sprite:null,dx:0,dy:0,hurt:0}));
      this.byKey = Object.fromEntries(this.nodes.map(n => [n.key,n]));
      this.nodes.sort((a,b) => a.y-b.y);
      this.flashes = [];
      this.focus = null;
      this.effects = [];
      this.textures = new Map();
      this.ratio = window.devicePixelRatio || 1;
      this.canvas = document.createElement('canvas');
      this.canvas.setAttribute('aria-label','星盘战台，左方我队六个阵位，右方敌队六个阵位');
      this.domLayer = document.createElement('div');
      this.domLayer.className = 'battle-dom-units';
      host.append(this.domLayer,this.canvas);
      // Avoid consuming two WebGL contexts just to test support. Renderer's exception
      // uses a fresh canvas, since a canvas cannot switch its context type.
      try {
        P.BaseTexture.defaultOptions.mipmap = P.MIPMAP_MODES.ON;
        P.BaseTexture.defaultOptions.scaleMode = P.SCALE_MODES.LINEAR;
        this.app = new P.Application({view:this.canvas, width:2,height:2, resolution:window.devicePixelRatio || 1,
          backgroundAlpha:0, autoDensity:true, antialias:true, powerPreference:'high-performance',
          autoStart:false, sharedTicker:false, eventMode:'none'});
        this.world = new P.Container();
        this.shadows = new P.Container();
        this.actors = new P.Container();
        this.flags = new P.Container();
        this.overlay = new P.Graphics();
        this.world.addChild(this.shadows,this.actors,this.flags,this.overlay);
        this.app.stage.addChild(this.world);
        this.app.ticker.maxFPS = powerSave ? 30 : 60;
        this.ink = new Paint(this.overlay,null);
      } catch (err) {
        const fresh = this.canvas.cloneNode(false);
        this.canvas.replaceWith(fresh); this.canvas = fresh;
        this.ctx = fresh.getContext('2d');
        this.shadowInk = this.ink = new Paint(null,this.ctx);
      }
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
    async load() {
      const heroes = [...new Set(this.nodes.map(n => n.heroId))];
      const sources = await Promise.all(heroes.map(async id => {
        const direct = location.protocol === 'file:' && Sky.art.isCustomChibi(id);
        const url = direct ? Sky.art(id,'chibi') : await Sky.art.textureURL(id);
        return [id, direct, await getImage(url)];
      }));
      if (this.disposed) return;
      for(const [id,direct,img] of sources) {
        let texture;
        if (this.app && !direct) {
          const base = new P.BaseTexture(img,{mipmap:P.MIPMAP_MODES.ON, scaleMode:P.SCALE_MODES.LINEAR, anisotropicLevel:8});
          texture = new P.Texture(base);
          this.textures.set(id,texture);
        }
        for(const n of this.nodes.filter(n => n.heroId === id)) {
          n.image = img;
          if (texture) {
            n.sprite = new P.Sprite(texture);
            n.sprite.anchor.set(.5,.985);
            n.sprite.eventMode = 'none';
            n.sprite.pluginName = 'skyBattleActors';
            // All foot shadows share the geometry. Moving and breathing adjust
            // transforms; neither action changes the two underlying ellipses.
            if(!this.shadowShape) {
              this.shadowShape=new P.Graphics();
              const ink=new Paint(this.shadowShape,null);
              ink.ellipse(0,0,100,12,0x17112e,.38);
              ink.ellipse(0,0,73,7.44,0x191122,.34);
            }
            n.shadow=this.shadowShape.clone();
            this.shadows.addChild(n.shadow);
          } else if (this.app && direct) {
            const body = document.createElement('div');
            body.className = 'battle-file-unit';
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
        if(n.sprite) this.actors.addChild(n.sprite);
        if(this.app) {
          n.flag=new P.Graphics();
          n.flagInk=new Paint(n.flag,null);
          this.flags.addChild(n.flag);
        }
      }
      this.ready = true;
    }
    state(units) {
      for(const u of units) Object.assign(this.byKey[u.key],{hp:u.hp,shield:u.shield});
    }
    elapsedAction(actor, target, progress, dash) {
      const n = this.byKey[actor], dest = this.byKey[target];
      if (!n || !dest || !dash) return;
      const step = progress < .42 ? Math.sin(progress/.42*Math.PI/2) :
        progress < .52 ? 1 : Math.cos((progress-.52)/.48*Math.PI/2);
      n.dx = (dest.x-n.x)*.73*step;
      n.dy = (dest.y-n.y)*.70*step - Math.sin(step*Math.PI)*.055;
    }
    resetMotion() {
      this.focus = null;
      for (const n of this.nodes) {n.dx = n.dy = n.hurt = 0;}
    }
    hit(actor, hit, element, ultimate, clock) {
      const n = this.byKey[hit.target];
      if (!n) return;
      n.hp = hit.hp; n.shield = hit.shield;
      if (hit.kind === 'damage') n.hurt = clock+165;
      this.effects.push({actor, target:n.key, element, ultimate, start:clock, duration:ultimate ? 625 : 325});
      if (ultimate && hit.kind === 'damage' && !this.powerSave) this.shakeUntil = clock+170;
    }
    effect(p,e,time) {
      const actor=this.byKey[e.actor], target=this.byKey[e.target];
      const w=this.w,h=this.h, x=(target.x+target.dx)*w,y=(target.y+target.dy-.10)*h;
      const t=clamp((time-e.start)/e.duration), fade=1-t, color=palette[e.element] || palette.light;
      const dir=actor.side==='ally' ? 1 : -1, cx=(actor.x+actor.dx)*w,cy=(actor.y+actor.dy-.1)*h;
      const r=h*(e.ultimate ? .19 : .07), k=t*r;
      if (!e.ultimate) {
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
      const count=this.powerSave ? 4 : e.ultimate ? 34 : 9;
      for(let i=0;i<count;i++) {
        const a=i*2.39996 + target.slot*.69, speed=.40+(i%7)*.14;
        const xx=x+Math.cos(a)*k*speed, yy=y+Math.sin(a)*k*speed + t*t*r*.24;
        const l=h*(i%5===0 ? .017 : .007)*fade;
        p.path([xx,yy,xx-Math.cos(a)*l,yy-Math.sin(a)*l],i%3===0?0xfff5dd:color,fade*.95,h*.0034*fade+.25);
      }
      p.ellipse(x,y,Math.max(0.1,k*.58),Math.max(0.1,k*.58),color,fade*.56,h*.0035*fade+.3);
    }
    flagGeometry(ink,n,x,y,alpha) {
      const bw=this.w*.043,bh=this.h*.005;
      const fac=accents[Sky.D.hero(n.heroId).faction] || 0xffffff,col=n.side==='ally'?0x9fe8e0:0xf5a6ad;
      ink.path([x-bw*.62,y,x-bw*.55,y-bh,x-bw*.48,y,x-bw*.55,y+bh],fac,alpha);
      ink.path([x-bw*.44,y-bh*.65,x+bw*.47,y-bh*.65,x+bw*.47,y+bh*.8,x-bw*.44,y+bh*.8],0x12132a,.84*alpha);
      if(n.hp) ink.path([x-bw*.43,y,x-bw*.43+bw*.88*clamp(n.hp/n.maxHp),y],col,alpha,bh*.85);
      if(n.shield>0) ink.path([x-bw*.43,y+bh,x-bw*.43+bw*.88*clamp(n.shield/n.maxHp),y+bh],0xffdd83,alpha,bh*.45);
    }
    render(time) {
      if (!this.ready || this.disposed || !this.w) return;
      if (window.devicePixelRatio !== this.ratio) this.resize();
      const w=this.w,h=this.h, c=this.ctx;
      if (this.app) {if(this.effects.length || this.drewEffects) this.overlay.clear();}
      else {c.setTransform(this.ratio,0,0,this.ratio,0,0); c.clearRect(0,0,w,h);}
      const shake = time < this.shakeUntil ? .003*w*Math.sin(time*.13)*(this.shakeUntil-time)/170 : 0;
      if (this.app) this.world.x = shake;
      else c.translate(shake,0);
      for(const n of this.nodes) {
        const flashing=n.hurt>time;
        const visible=n.hp>0 || flashing;
        if(n.sprite) n.sprite.visible=n.shadow.visible=visible;
        if(n.flag) n.flag.visible=visible;
        if(n.dom) n.dom.body.hidden=!visible;
        if(!visible) continue;
        const alpha=this.focus && !this.focus.has(n.key) ? .35 : 1;
        const recoil=flashing ? Math.sin((n.hurt-time)/165*Math.PI)*.013*w*(n.side==='ally'?-1:1) : 0;
        const x=(n.x+n.dx)*w+recoil,y=(n.y+n.dy)*h;
        const breath=this.powerSave ? 1 : 1+.007*Math.sin(time/540+n.slot*1.8);
        const size=h*(n.boss?.285:.204)*n.depth*breath;
        const width=size*n.image.naturalWidth/n.image.naturalHeight;
        const sign=n.side==='enemy'?-1:1;
        const shadowWidth=size*.30*(1-Math.min(.30,Math.abs(n.dx)));
        if(n.shadow) {
          n.shadow.position.set(x,(n.y+n.dy*.60)*h-1);
          n.shadow.scale.set(shadowWidth/100,size*.050/12);
          n.shadow.alpha=alpha;
        } else if (!n.dom) {
          this.shadowInk.ellipse(x,(n.y+n.dy*.60)*h-1,shadowWidth,size*.050,0x17112e,.38*alpha);
          this.shadowInk.ellipse(x,(n.y+n.dy*.60)*h-1,shadowWidth*.73,size*.031,0x191122,.34*alpha);
        }
        if(n.dom) {
          const {body,shadow,portrait}=n.dom;
          body.style.cssText='left:'+x+'px;top:'+y+'px;z-index:'+Math.round(n.y*100);
          portrait.style.cssText='width:'+width+'px;height:'+size+'px;transform:translate(-50%,-98.5%) scaleX('+sign+');filter:'+(flashing?'brightness(2.5) saturate(.65)':alpha<1?'brightness(.35)':'none');
          shadow.style.cssText='width:'+shadowWidth*2+'px;height:'+size*.10+'px;top:'+(-n.dy*.40*h)+'px';
        } else if(n.sprite) {
          n.sprite.position.set(x,y);
          n.sprite.scale.set(sign*width/n.image.naturalWidth,size/n.image.naturalHeight);
          n.sprite.tint=flashing?0x00ffff:alpha<1?0x595959:0xffffff;
        } else {
          c.save(); c.translate(x,y); c.scale(sign,1);
          if(flashing || alpha<1) c.filter=flashing?'brightness(2.5)':'brightness(.35)';
          c.drawImage(n.image,-width*.5,-size*.985,width,size); c.restore();
        }
        // Each flag and gauge is vector geometry at the canvas' actual backing density.
        if(n.flag) {
          n.flag.position.set(x,y-size*.995); n.flag.alpha=alpha;
          if(n.flagHP!==n.hp || n.flagShield!==n.shield || n.flagW!==w || n.flagH!==h) {
            n.flag.clear(); this.flagGeometry(n.flagInk,n,0,0,1);
            n.flagHP=n.hp; n.flagShield=n.shield; n.flagW=w; n.flagH=h;
          }
        } else this.flagGeometry(this.ink,n,x,y-size*.995,alpha);
      }
      this.effects=this.effects.filter(e=>time-e.start<e.duration);
      this.drewEffects=this.effects.length>0;
      for(const e of this.effects) this.effect(this.ink,e,time);
      if(this.app) this.app.render();
    }
    inspect() {
      return {renderer:this.app?'pixi-webgl':'canvas2d',resolution:this.ratio, canvas:[this.canvas.width,this.canvas.height],
        stage:[this.w,this.h],positions:this.nodes.map(n=>({key:n.key,x:n.x,y:n.y,mirror:n.side==='enemy',depth:n.depth,
          source:n.dom?'native-image':this.app?'pixi-texture':'canvas-image'})),textures:[...this.textures.values()].map(t=>({
          width:t.baseTexture.realWidth,height:t.baseTexture.realHeight,mipmap:t.baseTexture.mipmap,scaleMode:t.baseTexture.scaleMode})),ready:!!this.ready};
    }
    destroy() {
      this.disposed=true;
      this.observer.disconnect();
      if(this.app) {
        this.app.destroy(true,{children:true,texture:false,baseTexture:false});
        this.shadowShape?.destroy();
        for(const t of this.textures.values()) t.destroy(true);
      }
      this.host.replaceChildren();
    }
  }
  Sky.BattleScene=BattleScene;
})();
