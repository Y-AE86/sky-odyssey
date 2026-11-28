'use strict';
// Run with Node and Playwright installed. --vfx-only and --hud-only run focused battle suites.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const crypto=require('node:crypto');
const os=require('node:os');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const args=process.argv.slice(2);
const option=(name,fallback)=>args.includes('--'+name) ? args[args.indexOf('--'+name)+1] : fallback;
const root=path.resolve(option('root',path.resolve(__dirname,'..')));
const out=option('out',null),selected=option('case',null);
const vfxOnly=args.includes('--vfx-only');
const hudOnly=args.includes('--hud-only');
const wave6Only=args.includes('--wave6-only');
const actorUpgrade=args.includes('--actor-upgrade');
const domainCinema=args.includes('--domain-cinema');
const upgradeBaseline=args.includes('--vfx-upgrade-baseline');
const effectsUpgrade=upgradeBaseline || args.includes('--vfx-upgrade');
const {exerciseHud,checkPowerHud}=require('./battle-hud.cjs');
const {runVfxUpgrade}=require('./vfx-upgrade.cjs');
const {runActorUpgrade}=require('./actor-upgrade.cjs');
const {runDomainCinema}=require('./domain-cinema.cjs');
const chrome=option('chrome',process.env.CHROME_PATH);
const presets=[
  {name:'desktop',width:1280,height:720,dpr:1,full:true},
  {name:'retina',width:1440,height:900,dpr:2,full:true},
  {name:'mobile',width:844,height:390,dpr:3,mobile:true,full:true},
  {name:'file',width:1280,height:720,dpr:1,file:true,full:true},
  ...(effectsUpgrade && !upgradeBaseline || actorUpgrade || domainCinema) ? [
    {name:'power',width:1280,height:720,dpr:1,full:true},
    {name:'canvas',width:1280,height:720,dpr:1,full:true}
  ] : [],
  {name:'1080p',width:1920,height:1080,dpr:1,full:true,extra:true},
  {name:'qhd',width:2560,height:1440,dpr:1,full:true,extra:true},
  {name:'4k',width:3840,height:2160,dpr:1,full:true,extra:true}
];
const sha=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
const stems={h01:'c07',h02:'protag',h03:'c15',h04:'h04',h05:'h05',h06:'h06'};
const leads=Object.keys(stems);
const newStars=['h07','h08','h09','h10','h11'];
const playable=[...leads,...newStars];
const villains=['enemy_boss_mech','enemy_vanguard','enemy_caster','enemy_striker'];
const artPath=(id,kind)=>villains.includes(id) ? 'assets/chibi/'+id+'.png' :
  kind==='weapon' ? 'assets/weapons/weapon_'+id+'.png' :
  'assets/'+({poster:'posters/lobby_cg_',avatar:'avatars/avatar_',chibi:'chibi/chibi_'}[kind])+(stems[id]||id)+'.png';
function originalSize(rel){
  const file=fs.readFileSync(path.join(root,rel));
  return [file.readUInt32BE(16),file.readUInt32BE(20)];
}
async function decoded(p,locator,src){
  const view=await locator.evaluate(async img=>{
    await img.decode();
    const r=img.getBoundingClientRect();
    return {url:img.currentSrc,width:img.naturalWidth,height:img.naturalHeight,area:r.width*r.height};
  });
  assert.equal(view.url,new URL(src,p.url()).href);
  assert.deepEqual([view.width,view.height],originalSize(src));
  assert(view.area>0,'image should occupy space: '+src);
  return src;
}
const wave1Paths=[
  ...['gem','coin','ticket','core','shard','chest','dew','dust','stamina'].map(n=>'items/item_'+n),
  ...['weapon','armor','accessory','relic'].flatMap(n=>['sr','ur'].map(r=>'items/gear_'+n+'_'+r)),
  ...['quest','reward','codex','bag','shop','formation','roster','gacha','settings'].map(n=>'icons/icon_'+n),
  ...['victory','defeat','mvp','star'].map(n=>'ui/emblem_'+n),
  ...['btn_gold','btn_cyan','btn_crimson','tab_active','tab_idle'].map(n=>'ui/ui_'+n)
].map(name=>'assets/'+name+'.png');
const baseline=option('baseline',null);
const assetsDir=path.join(root,'assets');
const trackedMedia=fs.readdirSync(assetsDir,{recursive:true}).filter(n=>/\.(png|mp3|mp4)$/.test(n))
  .map(n=>'assets/'+n.split(path.sep).join('/')).sort();
const originalPaths=trackedMedia.filter(n=>n.endsWith('.png'));
if(baseline) {
  const expected=JSON.parse(fs.readFileSync(baseline,'utf8').replace(/^\uFEFF/,''));
  assert.deepEqual(expected.map(entry=>entry.path).sort(),
    expected.some(({path})=>/\.(mp3|mp4)$/.test(path)) ? trackedMedia : originalPaths,
    'asset list changed since the supplied baseline');
  for(const entry of expected)assert.equal(sha(fs.readFileSync(path.join(root,entry.path))),entry.sha256.toLowerCase(),entry.path);
}
const visualChecks=new WeakMap();
const mobileEdges=new WeakMap();
const wave2Checks=new WeakMap();
const wave4Checks=new WeakMap();
const vfxPaths={...Object.fromEntries(leads.map(id=>[id,'assets/vfx/vfx_ult_'+id+'.png'])),spark:'assets/vfx/vfx_hit_spark.png'};
const battleArtPaths=Object.fromEntries([...leads.map(id=>'proj_'+id),'status_shield','status_freeze','status_curse','status_heal_ring','vfx_impact_crack']
  .map(key=>[key,'assets/vfx/'+key+'.png']));
const factionStems={东煌:'donghuang',圣辉:'shenghui',机巧:'jiqiao',秘影:'miying'};

async function badge(p,scope,name,placement) {
  const file='assets/badges/'+name+'.png';
  assert.deepEqual(originalSize(file),[440,440]);
  await decoded(p,scope.locator('img[src$="/'+name+'.png"]'),file);
  const entries=wave4Checks.get(p).badges;
  if(!entries[name])entries[name]=[];
  if(!entries[name].includes(placement))entries[name].push(placement);
}

async function sceneBackdrop(p,name,placement) {
  const file='assets/scenes/bg_'+name+'.png';
  const size=await p.locator('#bleed').evaluate(async(node,file)=>{
    const url=new URL(file,document.baseURI).href;
    if(!getComputedStyle(node).backgroundImage.includes(url))return null;
    const image=new Image();image.src=url;await image.decode();
    return [image.naturalWidth,image.naturalHeight];
  },file);
  assert.deepEqual(size,[1672,941],placement+' should show '+file);
  wave4Checks.get(p).scenes[placement]=file;
}

async function banner(p,selector,filename) {
  const relative='assets/banners/'+filename+'.png';
  const result=await p.locator(selector).evaluate(async (card,relative)=>{
    const expected=new URL(relative,document.baseURI).href;
    for(const node of [card,...card.querySelectorAll('*')]) {
      const box=node.getBoundingClientRect(),style=getComputedStyle(node);
      if(box.width<1 || box.height<1 || style.visibility==='hidden' || Number(style.opacity)===0)continue;
      const img=node.matches('img') ? node : null;
      const matches=(img?.currentSrc || img?.src)===expected || [null,'::before','::after'].some(ps=>{
        const css=getComputedStyle(node,ps);
        return (!ps || css.content!=='none') && css.backgroundImage.includes(expected);
      });
      if(!matches)continue;
      const decoded=img || new Image();
      if(!img)decoded.src=expected;
      await decoded.decode();
      return [decoded.naturalWidth,decoded.naturalHeight];
    }
    return null;
  },relative);
  assert.deepEqual(result,[1672,941],selector+' should show '+relative);
  (wave2Checks.get(p).artwork[relative] ||= []).push(selector);
}

// Sample the actual composited art beneath the title and subtitle, including the
// browser's crop and gradient. Removing the ink for one screenshot preserves layout.
async function bannerContrast(p,label,selector,results=wave2Checks.get(p).contrast) {
  const boxes=await p.locator(selector).evaluateAll(nodes=>nodes.flatMap(el=>{
    const text=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
    const boxes=[];
    while(text.nextNode()){
      const node=text.currentNode;
      if(!node.data.trim())continue;
      const range=document.createRange();range.selectNodeContents(node);
      const b=range.getBoundingClientRect();
      boxes.push({text:node.data.trim(),rgb:getComputedStyle(node.parentElement).color.match(/[\d.]+/g).slice(0,3).map(Number),
        x:b.left,y:b.top,right:b.right,bottom:b.bottom});
    }
    return boxes;
  }).filter(x=>x.text && x.right>x.x && x.bottom>x.y));
  assert(boxes.length,'no banner titles inspected at '+label);
  const x=Math.floor(Math.min(...boxes.map(b=>b.x))),y=Math.floor(Math.min(...boxes.map(b=>b.y)));
  const width=Math.ceil(Math.max(...boxes.map(b=>b.right)))-x,height=Math.ceil(Math.max(...boxes.map(b=>b.bottom)))-y;
  const shot=await p.screenshot({scale:'css',clip:{x,y,width,height},
    style:selector+' {-webkit-text-fill-color:transparent !important;text-shadow:none !important}'});
  const values=await p.evaluate(async ({encoded,boxes,x,y})=>{
    const img=new Image();img.src='data:image/png;base64,'+encoded;await img.decode();
    const c=document.createElement('canvas');c.width=img.width;c.height=img.height;
    const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
    const data=ctx.getImageData(0,0,c.width,c.height).data;
    const linear=Array.from({length:256},(_,i)=>i/255<=.04045?i/255/12.92:((i/255+.055)/1.055)**2.4);
    const lum=(r,g,b)=>.2126*linear[r]+.7152*linear[g]+.0722*linear[b];
    return boxes.map(b=>{
      const fg=lum(...b.rgb);
      let minimum=21;
      for(let py=Math.max(0,Math.ceil(b.y-y));py<Math.floor(b.bottom-y);py++) {
        for(let px=Math.max(0,Math.ceil(b.x-x));px<Math.floor(b.right-x);px++) {
          const i=4*(py*c.width+px),bg=lum(data[i],data[i+1],data[i+2]);
          minimum=Math.min(minimum,(Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05));
        }
      }
      return {text:b.text,minimum:+minimum.toFixed(3)};
    });
  },{encoded:shot.toString('base64'),boxes,x,y});
  assert(values.every(v=>v.minimum>=4.5),label+' banner contrast '+JSON.stringify(values));
  results[label]=values;
}

async function modalCoverage(p,spec,selector,content) {
  if(!spec.mobile)return;
  const area=await p.locator(selector).boundingBox(),stage=await p.locator('#stage').boundingBox();
  assert(area && Math.abs(area.x)<1 && Math.abs(area.y)<1 && Math.abs(area.width-spec.width)<1 && Math.abs(area.height-spec.height)<1,
    selector+' must cover the full viewport '+JSON.stringify(area));
  const card=await p.locator(content).boundingBox();
  assert(card && card.x>=stage.x-1 && card.x+card.width<=stage.x+stage.width+1,content+' spills past the safe stage');
  // Sample immediately across both old 16:9 edges, away from the safe-area card.
  const shot=await p.screenshot({scale:'css'});
  const sides=await p.evaluate(async ({encoded,edges})=>{
    const img=new Image();img.src='data:image/png;base64,'+encoded;await img.decode();
    const c=document.createElement('canvas');c.width=img.width;c.height=img.height;
    const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
    return edges.map(x=>{
      const a=ctx.getImageData(x-3,Math.round(c.height*.12),7,Math.round(c.height*.75)).data;
      const jumps=[];
      for(let y=0;y<a.length/28;y++){
        let max=0;
        for(let k=1;k<=5;k++){
          const i=(y*7+k)*4;
          max=Math.max(max,(Math.abs(a[i]-a[i+4])+Math.abs(a[i+1]-a[i+5])+Math.abs(a[i+2]-a[i+6]))/3);
        }
        jumps.push(max);
      }
      jumps.sort((a,b)=>a-b);
      return {x,p90:+jumps[Math.floor(jumps.length*.9)].toFixed(2)};
    });
  },{encoded:shot.toString('base64'),edges:[Math.round(stage.x),Math.round(stage.x+stage.width)]});
  assert(sides.every(v=>v.p90<=8),selector+' hard stage boundary '+JSON.stringify(sides));
  wave2Checks.get(p).masks[selector]={area,sides};
}
async function auditArt(p,screen,scope='#stage',required=[]) {
  const result=await p.locator(scope).first().evaluate(async root=>{
    const shown=el=>!!(el.offsetWidth || el.getClientRects().length) && getComputedStyle(el).visibility!=='hidden';
    const paths=new Set(),badButtons=[],badSVG=[];
    const add=src=>{
      if(!src || !src.includes('/assets/') && !src.startsWith('assets/'))return;
      const url=new URL(src,document.baseURI);
      if(url.pathname.includes('/assets/'))paths.add('assets/'+url.pathname.split('/assets/').pop());
    };
    for(const img of root.querySelectorAll('img')) {
      if(!shown(img))continue;
      await img.decode();
      if(!img.naturalWidth || !img.naturalHeight)throw new Error('Undecoded image '+img.src);
      add(img.currentSrc);
    }
    for(const svg of root.querySelectorAll('svg')) {
      if(shown(svg) && !svg.matches('.pn-trail'))badSVG.push(svg.outerHTML.slice(0,170));
    }
    for(const b of root.querySelectorAll('button')) {
      if(!shown(b))continue;
      for(const pseudo of [null,'::before','::after']) {
        const s=getComputedStyle(b,pseudo);
        if(pseudo && ['none','normal'].includes(s.content))continue;
        for(const property of [s.backgroundImage,s.borderImageSource])for(const match of property.matchAll(/url\(["']?([^"')]+)["']?\)/g))add(match[1]);
      }
      if(b.matches('.gem-btn,.pn-button')) {
        const r=b.getBoundingClientRect(),s=getComputedStyle(b);
        const caps=s.borderImageSource!=='none' || getComputedStyle(b,'::before').borderImageSource!=='none';
        if(!caps && r.width/r.height>3.53)badButtons.push([b.textContent.trim(),+(r.width/r.height).toFixed(2)]);
      }
    }
    return {paths:[...paths],badSVG,badButtons};
  });
  assert.deepEqual(result.badSVG,[],screen+' visible outline SVG');
  assert.deepEqual(result.badButtons,[],screen+' stretched artwork buttons');
  for(const src of required)assert(result.paths.some(p=>p.endsWith('/'+src+'.png')),screen+' missing visible '+src+'; found '+result.paths.join(','));
  const log=visualChecks.get(p);
  if(log)log[screen]=[...new Set([...(log[screen]||[]),...result.paths.filter(src=>wave1Paths.includes(src))])].sort();
}
async function checkBleed(p,spec,screen) {
  if(!spec.mobile)return;
  const r=await p.locator('#stage').boundingBox();
  const y=Math.round(spec.height*.20),h=Math.round(spec.height*.65);
  const sampled=[];
  for(const x of [Math.round(r.x*.4),Math.round((r.x+r.width+spec.width)/2)]) {
    const band=await p.screenshot({clip:{x,y,width:5,height:h},scale:'css'});
    const colors=await p.evaluate(async encoded=>{
      const img=new Image();img.src='data:image/png;base64,'+encoded;await img.decode();
      const c=document.createElement('canvas');c.width=img.width;c.height=img.height;
      const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
      const raw=ctx.getImageData(0,0,img.width,img.height).data,set=new Set();
      let low=765,high=0;
      for(let i=0;i<raw.length;i+=4){const sum=raw[i]+raw[i+1]+raw[i+2];low=Math.min(low,sum);high=Math.max(high,sum);set.add(raw[i]*65536+raw[i+1]*256+raw[i+2]);}
      return {count:set.size,spread:high-low};
    },band.toString('base64'));
    assert(colors.count>24 && colors.spread>24,'flat mobile edge at '+x+' '+JSON.stringify(colors));
    sampled.push({x,...colors});
  }
  mobileEdges.get(p)[screen]=sampled;
}
function serve(siteRoot=root) {
  const server=http.createServer((req,res)=>{
    const uri=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const file=path.resolve(siteRoot,'.'+(uri==='/' ? '/index.html' : uri));
    const stat=file.startsWith(siteRoot+path.sep) && fs.statSync(file,{throwIfNoEntry:false});
    if (!stat || !stat.isFile()) {res.writeHead(404).end();return;}
    const ext=path.extname(file);
    const types={'.html':'text/html; charset=utf-8','.png':'image/png','.css':'text/css','.js':'text/javascript',
      '.svg':'image/svg+xml','.mp4':'video/mp4'};
    const headers={'Content-Type':types[ext]||'application/octet-stream','Content-Length':stat.size};
    let range;
    if(ext==='.mp4'){
      headers['Accept-Ranges']='bytes';
      if(req.headers.range){
        const parts=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        const start=parts?.[1] ? Number(parts[1]) : Math.max(0,stat.size-Number(parts?.[2]));
        const end=parts?.[1] && parts[2] ? Math.min(Number(parts[2]),stat.size-1) : stat.size-1;
        if(!parts || !(parts[1] || parts[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start>end){
          res.writeHead(416,{'Content-Range':'bytes */'+stat.size}).end();return;
        }
        range={start,end};
        headers['Content-Range']='bytes '+start+'-'+end+'/'+stat.size;
        headers['Content-Length']=end-start+1;
      }
    }
    res.writeHead(range?206:200,headers);
    if(req.method==='HEAD'){res.end();return;}
    const stream=fs.createReadStream(file,range);
    res.once('close',()=>stream.destroy());
    stream.on('error',()=>res.destroy());
    stream.pipe(res);
  });
  return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(server));});
}
const action=(p,key)=>p.locator('[data-action="'+key+'"]').first();
const panel=(p,key,value)=>p.locator('[data-panel="'+key+'"]'+(value===undefined?'':'[data-value="'+value+'"]')).first();
const battle=(p,key)=>p.locator('[data-battle="'+key+'"]').first();
const state=p=>p.evaluate(()=>JSON.parse(JSON.stringify(Sky.ui.state)));
const status=p=>p.evaluate(()=>Sky.battlePage.inspect());
async function waitPage(p,key) {
  await p.waitForFunction(key=>document.querySelector('#view')?.dataset.page===key,key);
}
async function screenshot(p,spec,label) {
  if(out) await p.screenshot({path:path.join(out,spec.name+'-'+label+'.png'),timeout:15000});
}
async function screenForReview(p,spec,label) {
  if(!out || spec.name!=='desktop' && !(spec.mobile && ['roster','gacha','campaign','trials'].includes(label)))return;
  await p.locator('#toast').waitFor({state:'hidden'});
  await screenshot(p,spec,label);
}
async function geometry(p,spec) {
  const geom=await p.evaluate(()=>{
    const stage=document.querySelector('#stage'),r=stage.getBoundingClientRect(),d=getComputedStyle(document.body);
    return {x:r.x,y:r.y,width:r.width,height:r.height,dpr:devicePixelRatio,transform:getComputedStyle(stage).transform,
      safeLeft:parseFloat(d.paddingLeft),safeRight:parseFloat(d.paddingRight),vw:innerWidth,vh:innerHeight};
  });
  assert(Math.abs(geom.width/geom.height-16/9)<.002);assert.equal(geom.dpr,spec.dpr);
  assert.equal(geom.transform,'none');
  assert(geom.x>=geom.safeLeft-.6 && geom.x+geom.width<=geom.vw-geom.safeRight+.6);
  assert(geom.y>=-.6 && geom.y+geom.height<=geom.vh+.6);
  if(spec.mobile) assert.deepEqual([geom.safeLeft,geom.safeRight],[44,35]);
  return geom;
}
async function artwork(p,spec) {
  const actual=await p.evaluate(async paths=>Promise.all(paths.map(async src=>{
    const img=new Image();img.src=src;await img.decode();
    return [src,img.naturalWidth,img.naturalHeight];
  })),originalPaths);
  for(const [name,w,h] of actual) {
    const pixels=fs.readFileSync(path.join(root,name));
    assert.equal(w,pixels.readUInt32BE(16));assert.equal(h,pixels.readUInt32BE(20));
    if(!spec.file) {
      const response=await p.request.get(new URL(name,p.url()).href);
      assert.equal(response.status(),200);
      assert.equal(sha(await response.body()),sha(pixels));
    }
  }
  return actual.length;
}
async function checkEmbedded(p) {
    const embedded=await p.evaluate(async()=>{
      const entries=Object.entries(Sky.offlineChibi);
      return Promise.all(entries.map(async([id,url])=>{
        const data=await (await fetch(url)).arrayBuffer();
        const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',data));
        return [id,[...digest].map(byte=>byte.toString(16).padStart(2,'0')).join('')];
      }));
    });
    const base=[...playable,...villains];
    const variants=fs.readdirSync(path.join(root,'assets','chibi')).flatMap(file=>{
      const match=/^chibi_(h\d\d)_(windup|atk|hurt)\.png$/.exec(file);
      return match ? [match[1]+'_'+match[2]] : [];
    });
    assert.deepEqual(embedded.map(([id])=>id).sort(),[...base,...variants].sort());
    for(const [id,hash] of embedded){
      const file=id.includes('_') && !villains.includes(id) ? 'assets/chibi/chibi_'+id+'.png' : artPath(id,'chibi');
      assert.equal(hash,sha(fs.readFileSync(path.join(root,file))),file);
    }
    return Object.fromEntries(embedded);
}
async function runLobby(p,spec) {
  const initial=await state(p);
  assert.equal(initial.formation.length,6);assert.equal(initial.tickets,30);assert.equal(initial.diamonds,4800);
  assert.equal(initial.settings.powerSave,false);
  for(const [selector,name] of [['.route-tile','tile_campaign'],['.trial-tile','banner_tower'],['.idle-tile','tile_idle_box'],['.small-tiles [data-action=shop]','tile_shop']])await banner(p,selector,name);
  const event='assets/banners/tile_event.png';
  assert.deepEqual(originalSize(event),[1672,941]);
  await decoded(p,action(p,'event').locator('.tile-paint'),event);
  wave4Checks.get(p).lobby=['tile_campaign','banner_tower','tile_idle_box','tile_shop','tile_event'];
  await bannerContrast(p,'lobby','.tile-inside small,.tile-inside strong,.tile-inside>span,.trial-tile strong,.idle-tile strong,#idle-count,.small-tiles button>span');
  await auditArt(p,'lobby','#view',['item_gem','item_coin','item_ticket','item_chest','icon_quest','icon_reward','icon_codex','icon_bag','icon_shop','icon_formation','icon_roster','icon_gacha','icon_settings']);
  assert.equal(await p.locator('.main-dock [data-action=trials]').count(),0);
  if(spec.mobile) {
    const touch=await p.locator('.side-tools button,.poster-controls button').evaluateAll(buttons=>buttons.map(b=>b.getBoundingClientRect().height));
    assert(touch.length>=6 && touch.every(h=>h>=24),'mobile action areas too short '+touch);
  }
  await screenshot(p,spec,'lobby');
  await checkBleed(p,spec,'lobby');
  // The capped reward is the longest subtitle, extending farther into the artwork.
  // This browser context owns a fresh save; restore its original clock before play.
  await p.evaluate(()=>{Sky.ui.state.idleAt=Date.now()-8*3600*1000;Sky.ui.go('lobby');});
  try {
    assert.match(await p.locator('#idle-count').innerText(),/11,520/);
    await bannerContrast(p,'full idle chest','#idle-count');
  } finally {
    await p.evaluate(original=>{Sky.ui.state.idleAt=original;Sky.ui.go('lobby');},initial.idleAt);
  }
  for(const id of [...playable.slice(1),playable[0]]) {
    await action(p,'poster').click();
    await p.waitForFunction(id=>Sky.ui.state.settings.poster===id,id);
    await decoded(p,p.locator('.backdrop.current'),artPath(id,'poster'));
    assert.equal(await p.locator('.poster-dots i').count(),playable.length);
    assert(await p.locator('.poster-dots i').nth(playable.indexOf(id)).evaluate(n=>n.classList.contains('selected')));
    assert.equal(await p.locator('.poster-info h1').textContent(),await p.evaluate(id=>Sky.D.hero(id).name,id));
    if(playable.indexOf(id)>=3){
      const lines=await p.locator('.hero-line').evaluate(node=>{
        const real=Math.random,lines=[node.textContent];
        // Advance through the three dialogue options via the ordinary interaction.
        try {Math.random=()=>0;for(let i=0;i<2;i++){node.click();lines.push(node.textContent);}}
        finally{Math.random=real;}
        return lines;
      });
      assert.equal(new Set(lines).size,3,id+' interactive dialogue');
      if(spec.name==='desktop' || spec.mobile && id==='h05' || spec.name==='retina' && id==='h06'){
        await p.waitForFunction(id=>{
          const media=document.querySelector('.backdrop.current[data-poster="'+id+'"]')?.closest('.lobby-media');
          return media && Number(getComputedStyle(media).opacity)>.99;
        },id);
        await screenshot(p,spec,'lobby-'+id);
      }
    }
  }
  const dialogue=p.locator('.hero-line'),line=await dialogue.innerText();
  await dialogue.click();assert.notEqual(await dialogue.innerText(),line);
  await action(p,'clean').click();
  assert(await p.locator('#view.clean').count());
  await p.locator('#stage').click({position:{x:40,y:75}});
  assert.equal(await p.locator('#view.clean').count(),0);
  await action(p,'idle').click();await modalCoverage(p,spec,'#overlay','.sky-dialog');await action(p,'claim-idle').click();
  assert((await state(p)).coins>initial.coins);
  const close=action(p,'close');
  if(await close.isVisible()) await close.click();
}
async function runRoster(p,spec) {
  await action(p,'roster').click();await waitPage(p,'roster');
  await badge(p,p.locator('.pn-resonance'),'badge_resonance','resonance');
  for(const [name,stem] of Object.entries(factionStems)){
    await badge(p,panel(p,'filter',name),'faction_'+stem,'roster filter');
  }
  await auditArt(p,'roster','#view',['item_coin','item_core','item_shard','ui_tab_active','ui_tab_idle']);
  assert(await panel(p,'star').isDisabled(),'new commander has no fragments to spend');
  await checkBleed(p,spec,'roster');
  await screenForReview(p,spec,'roster');
  const initial=await state(p);
  await panel(p,'upgrade').click();assert.equal((await state(p)).level,initial.level+1);
  await panel(p,'art','chibi').click();
  assert((await p.locator('.pn-portrait img').getAttribute('src')).includes('chibi'));
  await panel(p,'roster-tab',1).click();await panel(p,'auto-equip').click();
  const equipped=(await state(p)).equipment.h01;
  assert.equal(equipped.filter(Boolean).length,4);
  const bonuses=await p.locator('.pn-equip-grid .pn-gear-stat').allTextContents();
  const expectedBonuses=await p.evaluate(()=>{
    const {bag,equipment}=Sky.ui.state;
    return equipment.h01.map(uid=>{
      const stat=Sky.Save.gearStats(bag.find(item=>item.uid===uid));
      return (stat.atk?'攻击':'生命')+'+'+Math.round(stat.atk||stat.hp).toLocaleString('zh-CN');
    });
  });
  assert.deepEqual(bonuses,expectedBonuses,'each slot must display its actual equipment bonus');
  await auditArt(p,'gear','#view',['gear_weapon_sr','gear_armor_sr','gear_accessory_sr','gear_relic_sr']);
  await screenForReview(p,spec,'gear');
  await panel(p,'gear-slot',0).click();await panel(p,'enhance',equipped[0]).click();
  assert.equal((await state(p)).bag.find(x=>x.uid===equipped[0]).level,1);
  await panel(p,'dismiss').click();await panel(p,'roster-tab',2).click();
  await p.locator('.pn-weapon-emblem img').waitFor();await panel(p,'roster-tab',3).click();
  for(const [index,[name,label]] of [['basic','普攻'],['ult','必杀'],['passive','被动'],['awaken','觉醒']].entries()){
    const button=panel(p,'skill',index);
    await badge(p,button,'skill_'+name,'skill card');
    assert.equal(await button.locator('img').count(),1,'skill card should only show its own badge');
    await button.click();
    assert((await p.locator('.pn-skill-detail').innerText()).includes(label));
  }
  await panel(p,'skill',1).click();assert((await p.locator('.pn-skill-detail').innerText()).includes('九幽墨莲斩'));
  await screenshot(p,spec,'wave4-skills');
  await panel(p,'filter','圣辉').click();assert.equal(await p.locator('.pn-hero-pick').count(),1);
  await panel(p,'formation').click();assert.equal(await p.locator('.pn-position').count(),6);
  await modalCoverage(p,spec,'.pn-scrim','.pn-dialog');
  await auditArt(p,'formation','.pn-formation-layout');
  for(const [name,stem] of Object.entries(factionStems)){
    await badge(p,p.locator('.pn-bond').filter({hasText:name}),'faction_'+stem,'formation bond');
  }
  const orderText=await p.locator('.pn-form-side').innerText();assert(/[246]/.test(orderText) && ['2','4','6'].every(n=>orderText.includes(n)),'bond thresholds');
  const expectedOrder=await p.evaluate(()=>Sky.ui.state.formation.map((id,slot)=>({
    slot,role:Sky.D.hero(id).role,speed:Sky.Save.stats(Sky.ui.state,id).speed
  })).sort((a,b)=>b.speed-a.speed||a.slot-b.slot));
  for(const [rank,unit] of expectedOrder.entries()){
    const b=panel(p,'position',unit.slot);
    assert.equal(Number(await b.locator('.pn-order').innerText()),rank+1);
    const role=(await b.locator('.pn-profession').innerText()).trim();
    assert(role.length>=2 && unit.role.includes(role),'formation role '+role);
  }
  await panel(p,'position',0).click();await panel(p,'position',1).click();
  assert.deepEqual((await state(p)).formation,[
    initial.formation[1],initial.formation[0],...initial.formation.slice(2)]);
  await p.locator('#toast').waitFor({state:'hidden'});
  await screenshot(p,spec,'formation');await panel(p,'dismiss').click();await action(p,'home').click();
}
async function runGacha(p,spec) {
  await action(p,'gacha').click();await waitPage(p,'gacha');
  for(const n of [1,10])assert(await panel(p,'draw',n).locator('img[src$="item_ticket.png"]').count(),'ticket cost on '+n);
  const featured=p.locator('.pn-featured-list');
  const portraits=await featured.locator('img.portrait').evaluateAll(images=>Promise.all(images.map(async img=>{
    await img.decode();
    return img.currentSrc;
  })));
  const possible=playable.map(id=>new URL(artPath(id,'avatar'),p.url()).href);
  assert.equal(portraits.length,3);
  assert(portraits.every(src=>possible.includes(src)),'featured gacha character portraits');
  const badges=await featured.locator('small').evaluateAll(nodes=>nodes.map(n=>{
    const skin=getComputedStyle(n);
    return {border:parseFloat(skin.borderTopWidth),fill:skin.backgroundColor};
  }));
  assert.equal(badges.length,3);
  assert(badges.every(b=>b.border>0 && !['transparent','rgba(0, 0, 0, 0)'].includes(b.fill)),'featured rarity badge dark fill and rim');
  const ratesText=(await featured.innerText()).replace(/\s/g,'');assert(ratesText.includes('UR2%') && ratesText.includes('SSR98%'));
  assert.match(await p.locator('.pn-pity b').first().innerText(),/0\s*\/\s*60/);
  await auditArt(p,'gacha','#view',['item_gem','item_ticket','ui_btn_gold','ui_btn_cyan']);
  await checkBleed(p,spec,'gacha');
  await screenForReview(p,spec,'gacha');
  const initial=await state(p);
  await panel(p,'rates').click();assert((await p.getByRole('dialog').innerText()).includes('75%'));
  await panel(p,'dismiss').click();await panel(p,'draw',1).click();
  assert.equal(await p.locator('.pn-result-card').count(),1);
  await panel(p,'dismiss').click();await panel(p,'pool','up').click();
  await panel(p,'draw',10).click();assert.equal(await p.locator('.pn-result-card').count(),10);
  const first=await p.locator('.pn-result-card').allTextContents();
  assert(first.some(name=>/幽冥墨姬|冰灵|凌波玉笛/.test(name)),'first ten-pull must include an illustrated launch hero');
  const redraw=p.getByRole('button',{name:/再抽十次/});
  await redraw.waitFor({state:'visible'});
  const redrawSkin=await redraw.evaluate(n=>[null,'::before','::after'].map(ps=>getComputedStyle(n,ps).backgroundImage+' '+getComputedStyle(n,ps).borderImageSource).join(' '));
  assert(/ui_btn_(gold|cyan)\.png/.test(redrawSkin),'redraw must use original gilded button');
  await modalCoverage(p,spec,'.pn-draw-results','.pn-result-grid');
  assert.equal(await panel(p,'skip').isVisible(),false,'skip button still visible after reveal');
  await auditArt(p,'summon','.pn-draw-results');
  await checkBleed(p,spec,'summon');
  const positions=await p.locator('.pn-result-card').evaluateAll(cards=>cards.map(c=>{
    const r=c.getBoundingClientRect();return [Math.round(r.x),Math.round(r.y)];}));
  assert.equal(new Set(positions.map(a=>a[0])).size,5);assert.equal(new Set(positions.map(a=>a[1])).size,2);
  const card=await p.locator('.pn-result-card').first().boundingBox();assert(card.height>card.width,'portrait reveal cards');
  assert((await p.locator('.pn-result-grid').innerText()).includes('碎片'));
  const after=await state(p);assert.equal(after.tickets,initial.tickets-11);
  assert(Object.values(after.shards).reduce((a,b)=>a+b)>Object.values(initial.shards).reduce((a,b)=>a+b));
  await screenshot(p,spec,'summon');await redraw.click();
  await panel(p,'skip').click();await redraw.waitFor({state:'visible'});
  assert.equal((await state(p)).tickets,initial.tickets-21);
  await panel(p,'dismiss').click();
  await panel(p,'exchange-dialog').click();await panel(p,'exchange').click();assert.equal((await state(p)).diamonds,initial.diamonds-160);
  await action(p,'home').click();
}
async function runSaveDialog(p,spec) {
  await action(p,'quests').click();await action(p,'claim-daily').click();
  assert((await state(p)).daily.claimed);
  await action(p,'welfare').click();await action(p,'claim-welfare').click();
  assert((await state(p)).welfare);
  const beforeEvent=await state(p);
  await action(p,'event').click();await action(p,'claim-event').click();
  const event=await state(p);
  assert.deepEqual(event.event.days,[1]);assert.equal(event.tickets,beforeEvent.tickets+1);assert.equal(event.cores,beforeEvent.cores+5);
  await action(p,'event').click();assert((await p.getByRole('dialog').innerText()).includes('今日补给已领取'));
  await action(p,'close').click();await action(p,'shop').click();assert((await p.getByRole('dialog').innerText()).includes('160'));
  await auditArt(p,'shop','[role=dialog]',['item_gem','item_ticket']);
  await action(p,'close').click();
  await action(p,'atlas').click();assert.equal(await p.locator('[data-entry]').count(),playable.length);
  const catalog=await p.evaluate(()=>Sky.D.heroes.map(({id,faction})=>({id,faction})));
  for(const {id,faction} of catalog){
    await badge(p,p.locator('[data-entry="'+id+'"]'),'faction_'+factionStems[faction],'codex list');
  }
  await screenshot(p,spec,'wave4-codex');
  await p.locator('[data-entry="h06"]').click();
  assert((await p.getByRole('dialog').innerText()).includes('猩红月蚀'));
  await badge(p,p.getByRole('dialog'),'faction_miying','codex details');
  await action(p,'close').click();await action(p,'bag').click();
  assert((await p.getByRole('dialog').innerText()).includes('星币'));
  await auditArt(p,'bag-materials','[role=dialog]',['item_gem','item_ticket','item_core','item_coin','item_dust','item_dew','item_stamina','item_shard']);
  const bagColumns=await p.locator('.bag-grid,.bag-guide').evaluateAll(grids=>grids.map(grid=>[...grid.children].slice(0,3).map(cell=>{
    const rect=cell.getBoundingClientRect();return [Math.round(rect.x),Math.round(rect.width)];
  })));
  assert.equal(bagColumns.length,2);assert.deepEqual(bagColumns[0],bagColumns[1],'material guide must align with inventory columns');
  await screenForReview(p,spec,'bag-items');
  await p.locator('[data-bag-tab=gear]').click();
  await auditArt(p,'bag-gear','[role=dialog]',['gear_weapon_sr','gear_armor_sr','gear_relic_sr','gear_accessory_sr']);
  await screenForReview(p,spec,'bag-gear');
  await action(p,'close').click();await action(p,'settings').click();
  const dialogAction=key=>p.getByRole('dialog').locator('[data-action="'+key+'"]');
  const downloadPromise=p.waitForEvent('download');
  await dialogAction('export').click();const download=await downloadPromise;
  assert.equal(download.suggestedFilename(),'sky_odyssey_save_v1.json');
  const stream=await download.createReadStream(), chunks=[];
  for await(const chunk of stream)chunks.push(chunk);
  const json=Buffer.concat(chunks).toString('utf8');
  assert.deepEqual(JSON.parse(json),await state(p));
  await dialogAction('power').click();assert((await state(p)).settings.powerSave);
  await dialogAction('import').click();const beforeInvalid=await state(p);
  await p.locator('#save-json').fill('{"version":1,"tickets":-1}');await dialogAction('confirm-import').click();
  assert.deepEqual(await state(p),beforeInvalid);assert(await p.locator('#save-json').isVisible());
  // Select the exported JSON through the application's actual file input.
  await p.locator('#save-file').setInputFiles({name:'sky_odyssey_save_v1.json',mimeType:'application/json',buffer:Buffer.from(json)});
  await p.waitForFunction(expected=>document.querySelector('#save-json').value===expected,json);
  await dialogAction('confirm-import').click();assert.deepEqual(await state(p),JSON.parse(json));
  assert.deepEqual(await p.evaluate(()=>Object.keys(localStorage)),['sky_odyssey_save_v1']);
}
async function inspectBattle(p,spec) {
  await p.waitForFunction(()=>Sky.battlePage?.inspect()?.ready,null,{timeout:25000});
  const info=await status(p);
  assert.equal(info.renderer,'pixi-webgl');
  assert.equal(info.resolution,spec.dpr);
  assert.deepEqual(info.canvas,info.stage.map(v=>Math.round(v*spec.dpr)));
  const context=await p.locator('.battle-stage canvas').evaluate(canvas=>{
    const gl=canvas.getContext('webgl2')||canvas.getContext('webgl');
    const ext=gl.getExtension('WEBGL_debug_renderer_info');
    return {...gl.getContextAttributes(),gpu:ext&&gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),
      physicallyDrawn:[gl.drawingBufferWidth,gl.drawingBufferHeight]};
  });
  assert(context.antialias);assert.equal(context.powerPreference,'high-performance');
  assert.deepEqual(context.physicallyDrawn,info.canvas);
  assert.equal(info.positions.length,12);assert.equal(await p.locator('[data-cast]').count(),6);
  assert(info.positions.every(n=>n.source==='pixi-texture'),'All bundled units must be real Pixi sprites');
  for(const actor of info.positions) {
    assert(actor.y>=.48 && actor.y<=.86);
    assert.equal(actor.mirror,actor.key[0]==='e' && !villains.includes(actor.heroId));
    assert(actor.key[0]==='e'?actor.x>.5:actor.x<.5);
    assert(Math.abs(actor.depth-[.88,.96,1.04][Number(actor.key.slice(1))%3])<1e-6,'rank perspective '+actor.key);
  }
  const gauges=await p.locator('[data-cast]').evaluateAll(cards=>cards.map(card=>[...card.querySelectorAll('.meter')].map(n=>n.className)));
  assert(gauges.every(([hp,rage])=>hp?.includes('cyan') && rage?.includes('gold')),'battle HP/rage colors');
  const constants=await p.evaluate(()=>[PIXI.MIPMAP_MODES.ON,PIXI.SCALE_MODES.LINEAR]);
  assert(info.textures.length>=3);
  assert(info.textures.every(t=>t.mipmap===constants[0] && t.scaleMode===constants[1]));
  const originals=new Set();
  for(const n of info.positions){
    assert(playable.includes(n.heroId) || villains.includes(n.heroId),n.heroId);
    assert.equal(n.artwork,'original',n.heroId);
    const t=info.textures.find(t=>t.heroId===n.heroId);
    assert(t,n.heroId+' has its own Pixi GPU texture');
    assert.deepEqual([t.width,t.height],originalSize(artPath(n.heroId,'chibi')));
    if(playable.includes(n.heroId))originals.add(n.heroId);
  }
  return {canvas:info.canvas,gpu:context.gpu,textures:info.textures.length,originalHeroes:[...originals].sort(),
    spriteCount:info.positions.filter(n=>n.source==='pixi-texture').length};
}
async function recordMotion(p) {
  // Observe the transient cut-ins, actual media playback, and per-hit totals.
  await p.locator('.battle-page').waitFor();
  await p.evaluate(()=>{
    const root=document.querySelector('.battle-page');
    const log=window.__skyQaMotion={cuts:[],totals:[],segments:[],spots:0,hits:0,drawTimes:[],started:performance.now()};
    let lastDraw=performance.now(),activeSegment=null;
    function sample(now) {
      if(root.querySelector('.battle-result')) {log.elapsed=now-log.started;return;}
      if(now>lastDraw)log.drawTimes.push(now-lastDraw);
      lastDraw=now;requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
    const starts=new Map();
    const observer=new MutationObserver(mutations=>{
      for(const mutation of mutations) {
        if(mutation.type==='attributes' && mutation.target===root) {
          if(root.classList.contains('spotlight')&&!activeSegment) {
            log.spots++;activeSegment=[];log.segments.push(activeSegment);
          } else if(!root.classList.contains('spotlight')) activeSegment=null;
        }
        for(const node of mutation.addedNodes) {
          if(node.nodeType!==1)continue;
          if(node.matches('.battle-cutin')) starts.set(node,{at:performance.now(),media:[]});
          if(node.matches('.battle-float')) log.hits++;
        }
        for(const node of mutation.removedNodes) {
          if(starts.has(node)) {
            const {at,media}=starts.get(node);
            log.cuts.push({hero:node.dataset.hero,duration:performance.now()-at,
              image:node.style.getPropertyValue('--cut-image'),media});starts.delete(node);
          }
        }
        if(mutation.target.parentElement?.closest('.battle-total') || mutation.target.closest?.('.battle-total')) {
          const elm=root.querySelector('.battle-total');
          if(!elm.hidden && elm.querySelector('small').textContent==='总伤害') {
            const value=Number(elm.querySelector('strong').textContent.replaceAll(',',''));
            log.totals.push(value);
            if(activeSegment && value>0 && value!==activeSegment.at(-1))activeSegment.push(value);
          }
        }
      }
    });
    observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
    root.addEventListener('playing',event=>{
      const video=event.target;
      if(!(video instanceof HTMLVideoElement))return;
      starts.get(video.closest('.battle-cutin'))?.media.push({
        source:new URL(video.currentSrc || video.src).pathname.split('/').pop(),
        muted:video.muted,rate:video.playbackRate,length:video.duration
      });
    },true);
  });
}
async function recordUltimateVfx(p) {
  await p.evaluate(()=>{
    window.__skyVfxProbeRestore?.();
    const root=document.querySelector('.battle-page'), numbers=root.querySelector('.battle-numbers');
    const log=window.__skyVfxProbe={hits:[],frames:[],atlases:{},mediaEnded:[],voices:[],cutSkips:[],projectiles:{}};
    const proto=Sky.BattleScene.prototype, originalHit=proto.hit, originalRender=proto.render;
    const pending=[],seen=new Map();
    const watch=new AbortController();
    root.addEventListener('playing',event=>{
      const v=event.target,id=v.closest?.('.battle-cutin')?.dataset.hero;
      if(id)log.voices.push({id,clip:new URL(v.currentSrc).pathname.split('/').pop(),muted:v.muted,
        rate:v.playbackRate,start:performance.now(),duration:v.duration});
    },{capture:true,signal:watch.signal});
    root.addEventListener('ended',event=>{
      const heroId=event.target.closest?.('.battle-cutin')?.dataset.hero;
      if(heroId){
        log.mediaEnded.push(heroId);
        const voice=log.voices.findLast(v=>v.id===heroId);
        if(voice){voice.playedMs=Math.round(performance.now()-voice.start);voice.audioBytes=event.target.webkitAudioDecodedByteCount;}
      }
    },{capture:true,signal:watch.signal});
    root.addEventListener('click',event=>{
      const cut=event.target.closest('.battle-cut-skip')?.closest('.battle-cutin');
      if(cut)log.cutSkips.push(cut.dataset.hero);
    },{capture:true,signal:watch.signal});
    proto.hit=function(actor,hit,element,ultimate,clock){
      if(root.contains(this.host)){
        pending.push({clock,actor,heroId:this.byKey[actor].heroId,target:hit.target,kind:hit.kind,amount:hit.amount,ultimate,
          oldLabels:new Set(numbers.children)});
      }
      return originalHit.apply(this,arguments);
    };
    proto.render=function(clock,effectClock){
      const result=originalRender.apply(this,arguments);
      if(!root.contains(this.host))return result;
      const vfx=this.inspect().vfx;
      const active=vfx?.active || [];
      for(const projectile of vfx?.projectiles || [])
        if(projectile.actor[0]==='a')log.projectiles[projectile.key]=projectile;
      const cutVisible=!!root.querySelector('.battle-cutin');
      for(const [key,atlas] of this.vfx?.atlases || []){
        if(log.atlases[key])continue;
        const pixel=atlas.base.resource.source.getContext('2d').getImageData(0,0,1,1).data;
        log.atlases[key]={frameMs:atlas.layout.frameMs,cornerAlpha:pixel[3],frames:atlas.frames.map(texture=>
          [texture.frame.x,texture.frame.y,texture.frame.width,texture.frame.height])};
      }
      const sprites=new Map([...(this.vfx?.active || [])].map(entry=>[entry.info,entry.sprite]));
      for(const frame of active){
        const id=[frame.key,frame.role,frame.startedAt,frame.actor,frame.target,frame.hitIndex].join('/');
        const stamp=[frame.frame,frame.impactAt,frame.renderedImpactAt].join('/');
        if(seen.get(id)===stamp)continue;
        seen.set(id,stamp);
        const sprite=sprites.get(frame);
        log.frames.push({...frame,frames:[...frame.frames],cutVisible,drawClock:clock,effectClock,
          position:sprite?.visible ? {x:sprite.x,y:sprite.y,scale:Math.abs(sprite.scale.x)} : null});
      }
      const counter=root.querySelector('.battle-total strong');
      for(const {oldLabels,...hit} of pending.splice(0)){
        const labels=[...numbers.children].filter(el=>!oldLabels.has(el) && el.classList.contains(hit.kind));
        const atImpact=active.filter(effect=>effect.actor===hit.actor && effect.impactAt===hit.clock &&
          (effect.target===hit.target || effect.targets?.includes(hit.target)));
        log.hits.push({...hit,drawClock:clock,cutVisible,labels:labels.map(el=>el.textContent),
          counter:counter ? Number(counter.textContent.replaceAll(',','')) : null,
          procedural:this.effects.some(effect=>effect.actor===hit.actor&&effect.target===hit.target&&effect.start===hit.clock),
          effects:atImpact.map(effect=>({...effect,frames:[...effect.frames]})),
          camera:this.inspect().camera,impact:this.inspect().impact,kickPower:this.camera?.kick?.power || 0});
      }
      return result;
    };
    window.__skyVfxProbeRestore=()=>{
      watch.abort();proto.hit=originalHit;proto.render=originalRender;
      window.__skyVfxProbeRestore=null;
    };
  });
}
async function checkUltimateVfx(p,spec,label) {
  await p.waitForFunction(()=>window.__skyVfxProbe.hits.some(hit=>hit.heroId==='h06' && hit.ultimate &&
    hit.kind==='damage' && hit.actor[0]==='a' && hit.target[0]==='e'),null,{timeout:50000});
  if(out)await screenshot(p,spec,label);
  const probe=await p.evaluate(()=>window.__skyVfxProbe);
  const hit=probe.hits.find(hit=>hit.heroId==='h06' && hit.ultimate && hit.kind==='damage' && hit.actor[0]==='a' && hit.target[0]==='e');
  assert(hit.amount>0 && hit.labels.some(label=>Number(label.replace(/\D/g,''))===hit.amount),'real floating damage label');
  assert(!hit.cutVisible && hit.actor[0]==='a' && hit.target[0]==='e','allied impact follows the cut-in');
  const atlas=assertVfxPeak(hit,'h06','single',3,spec);
  assert(!hit.procedural,'the old red arc must not cover the new effect');
  const frames=probe.frames.filter(frame=>frame.startedAt===atlas.startedAt);
  assert(frames.length && frames.every(frame=>!frame.cutVisible),'no frame may appear under the cut-in');
  return {hit,framesAtCapture:frames.map(frame=>frame.frame),mediaEnded:probe.mediaEnded.includes('h06'),
    cutSkips:probe.cutSkips.filter(id=>id==='h06').length};
}
function assertVfxPeak(hit,key,role,frame,spec) {
  const atlas=hit.effects.find(effect=>effect.key===key && effect.role===role);
  assert(atlas?.active,JSON.stringify({key,role,hit}));
  assert.equal(atlas.source,spec.file?'embedded':'png');
  assert.equal(atlas.blendMode,1,'the rendered atlas sprite uses Pixi ADD');
  assert.equal(atlas.frame,frame,'the designated cel is drawn at the hit');
  assert.equal(atlas.frames.at(-1),frame);
  assert.equal(atlas.impactAt,hit.clock);
  assert.equal(atlas.renderedImpactAt,hit.drawClock);
  assert.equal(hit.clock,hit.drawClock,'impact art and flying number must share a draw frame');
  assert(!hit.cutVisible);
  return atlas;
}
async function startVfxFixture(p) {
  const fixture=await p.evaluate(()=>{
    const fresh=Sky.Save.fresh();
    fresh.owned=[...new Set([...fresh.owned,'h06'])];
    fresh.formation=['h04','h05','h06','h01','h02','h03'];
    return fresh;
  });
  await importProgress(p,fixture);
  await action(p,'trials').click();await panel(p,'trial','boss').click();
  // Start with full rage and a health deficit so the targeted check can observe
  // the real cast, target selection, damage, lifesteal, media and settlement.
  await panel(p,'start-trial','boss').evaluate(button=>{
    const original=Sky.Battle.create;
    try {
      Sky.Battle.create=(...args)=>{
        const b=original(...args);
        const lily=b.units.find(unit=>unit.side==='ally' && unit.heroId==='h06');
        lily.rage=100;
        lily.hp=Math.floor(lily.maxHp*.7);
        return b;
      };
      button.click();
    } finally {Sky.Battle.create=original;}
  });
  return fixture.formation.indexOf('h06');
}
async function castAndSkipVfx(p,slot) {
  await recordUltimateVfx(p);
  await battle(p,'auto').click();
  await p.locator('[data-cast="'+slot+'"]:enabled').click();
  await p.waitForFunction(()=>[...document.querySelectorAll('.battle-cutin[data-hero="h06"] video')].some(video=>
    video.src.includes('/ult_h06.mp4') && video.currentTime>0.08 && !video.paused));
  await p.locator('.battle-cutin[data-hero="h06"] .battle-cut-skip').click();
}
async function assertCut(p,cut,id) {
  assert(cut && cut.duration>=800 && cut.image.includes(artPath(id,'poster')),id+' actual theatrical cut-in');
  const dedicated=await p.evaluate(id=>Sky.art.ultVideo(id),id);
  if(dedicated){
    assert(cut.media.some(media=>dedicated.endsWith('/'+media.source)),id+' dedicated clip did not play: '+JSON.stringify(cut));
    assert(cut.duration>=1000 && cut.duration<3700,id+' dedicated clip runtime: '+cut.duration);
  }
}
async function checkSettlement(p,won) {
  const result=p.locator('.battle-result');
  await result.locator('img[src$="emblem_'+(won?'victory':'defeat')+'.png"]').waitFor();
  const stars=result.locator('[data-stars]');
  const count=Number(await stars.getAttribute('data-stars'));
  assert(won ? count>=1&&count<=3 : count===0);
  assert.equal(await result.locator('.battle-report-stars img[src$="emblem_star.png"]').count(),3);
  assert.equal(await result.locator('.battle-report-stars img.earned').count(),count);
  const contributions=await result.locator('.battle-contrib').evaluateAll(rows=>rows.map(row=>({
    amount:Number(row.dataset.damage),mvp:!!row.querySelector('img[src$="emblem_mvp.png"]')
  })));
  assert.equal(contributions.length,6);
  assert(contributions[0].mvp && contributions.filter(c=>c.mvp).length===1 && contributions.every(c=>c.amount<=contributions[0].amount),'actual top damage must receive the single MVP');
  const total=result.locator('.battle-stats .battle-cumulative');
  assert.equal(Number((await total.innerText()).replace(/[^0-9]/g,'')),contributions.reduce((sum,c)=>sum+c.amount,0));
  const tracks=await result.locator('.battle-contrib .meter').evaluateAll(meters=>meters.map(m=>({
    percentage:parseFloat(m.querySelector('i').style.width),caps:getComputedStyle(m,'::after').borderImageSource,
    opacity:Number(getComputedStyle(m,'::after').opacity)
  })));
  assert.equal(tracks.length,12);assert(tracks.every(t=>t.caps.includes('ui_bar_')),'contribution frame uses capped segments');
  const blank=tracks.filter(t=>t.percentage===0),active=tracks.filter(t=>t.percentage>0);
  assert(blank.length&&active.length&&blank.every(t=>t.opacity<.5)&&active.every(t=>t.opacity>.5),'empty contribution tracks are subdued');
}
async function exerciseLateGameArt(p,spec) {
  // Import an isolated late-tower save through the normal settings dialog. It gives
  // four UR gear items and a first-level party, so both the rare artwork and defeat
  // result can be observed without changing the battle engine or overriding RNG.
  const fixture=await state(p);
  fixture.tower=29;fixture.level=1;fixture.shards.h01=12;
  const names=['群星之刃','星冠圣铠','天穹之泪','群星天球'];
  for(const [slot,name] of names.entries())fixture.bag.push({uid:'g900'+slot,name,slot,rarity:'UR',level:0});
  await action(p,'settings').click();await action(p,'import').click();
  await p.locator('#save-json').fill(JSON.stringify(fixture));await action(p,'confirm-import').click();
  await action(p,'roster').click();assert(await panel(p,'star','h01').isEnabled());
  await panel(p,'star','h01').click();assert.equal((await state(p)).stars.h01,fixture.stars.h01+1);
  assert(await panel(p,'star','h01').isDisabled());
  await panel(p,'roster-tab',1).click();await panel(p,'auto-equip').click();
  const gear=names.map((_,i)=>'gear_'+['weapon','armor','accessory','relic'][i]+'_ur');
  await auditArt(p,'equipped-ur','.pn-equip-grid',gear);
  await screenForReview(p,spec,'gear-ur');
  await action(p,'home').click();await action(p,'trials').click();
  await panel(p,'start-trial','tower').click();await inspectBattle(p,spec);
  await battle(p,'skip').click();await p.locator('.battle-result').waitFor();
  assert.equal((await state(p)).tower,29,'a defeat must preserve the last cleared floor');
  await checkSettlement(p,false);await auditArt(p,'defeat','.battle-result',['emblem_defeat','emblem_mvp','emblem_star']);
  const recovery=p.locator('.battle-recovery');
  assert.deepEqual((await recovery.locator('button').allTextContents()).map(t=>t.trim()),['共鸣升级','强化星装','调整编队']);
  await screenForReview(p,spec,'defeat');
  await recovery.getByRole('button',{name:'强化星装'}).click();
  await waitPage(p,'roster');await p.locator('.pn-equip-grid').waitFor();
  await action(p,'home').click();
}
async function runCampaign(p,spec) {
  await action(p,'campaign').click();await waitPage(p,'campaign');
  await sceneBackdrop(p,'worldmap','campaign map');
  await auditArt(p,'route','#view',['item_gem','item_ticket','ui_btn_gold']);
  await checkBleed(p,spec,'campaign');
  await screenForReview(p,spec,'campaign');
  assert.equal(await p.locator('.pn-route-node').count(),5);
  await panel(p,'chapter',2).click();assert.equal(await p.locator('.pn-route-node:disabled').count(),5);
  assert(!(await p.locator('.pn-route-node:disabled i').allTextContents()).some(s=>s.trim()==='锁'),'locked nodes need a lock icon');
  await panel(p,'chapter',1).click();await panel(p,'stage',1).click();assert.equal(await p.locator('.pn-enemies>div').count(),6);
  await bannerContrast(p,'route intel','.pn-intel-title h2,.pn-enemy-title small,.pn-enemies>div>small,.pn-reward>small,.pn-reward>span,.pn-intel [data-panel=start-route]',wave4Checks.get(p).contrast);
  await screenshot(p,spec,'wave4-worldmap');
  const enemies=await p.locator('.pn-enemies>div').evaluateAll(async cells=>Promise.all(cells.map(async cell=>{
    const id=cell.dataset.hero;
    const avatar=cell.querySelector('img.portrait'),frame=cell.querySelector('img.rim');
    if(!avatar||!frame)return null;
    await Promise.all([avatar.decode(),frame.decode()]);
    const inner=avatar.getBoundingClientRect(),outer=frame.getBoundingClientRect();
    const skin=getComputedStyle(avatar);
    const shift=skin.transform==='none'?0:new DOMMatrixReadOnly(skin.transform).m42;
    const centered=Math.abs(inner.x+inner.width/2-outer.x-outer.width/2)<2 &&
      Math.abs(inner.y+inner.height/2-shift-outer.y-outer.height/2)<2;
    const inside=centered && inner.top>=outer.top && inner.bottom<=outer.bottom;
    return {id,img:avatar.currentSrc,frame:frame.currentSrc,inside,visible:inner.width>10 && inner.height>10 && skin.opacity!=='0'};
  })));
  const expected=await p.evaluate(()=>Sky.D.stages[0].enemies.map(id=>({id,src:new URL(Sky.art(id,'avatar'),document.baseURI).href,rarity:Sky.D.hero(id).rarity.toLowerCase()})));
  assert(enemies.every((e,i)=>e&&e.id===expected[i].id && e.img===expected[i].src && e.frame.endsWith('frame_'+expected[i].rarity+'.png') && e.visible && e.inside),'all six portraits must appear inside their own frames');
  await panel(p,'start-route',1).click();await waitPage(p,'battle');
  await recordMotion(p);const renderer=await inspectBattle(p,spec),frameStart=await status(p);
  await sceneBackdrop(p,'battle','chapter 1');
  const openingPositions=await status(p);
  assert.deepEqual(renderer.originalHeroes,[...(await state(p)).formation].sort());
  assert.equal(openingPositions.positions.filter(n=>n.key[0]==='a' && n.artwork==='original').length,6);
  assert(openingPositions.positions.filter(n=>n.key[0]==='e').every(n=>villains.includes(n.heroId)));
  const embedded=spec.file ? await checkEmbedded(p) : null;
  await checkBleed(p,spec,'battle');
  assert.equal(renderer.textures,new Set(openingPositions.positions.map(unit=>unit.heroId)).size);
  await screenshot(p,spec,'battle');
  await battle(p,'auto').click();assert.equal((await status(p)).auto,false);
  await battle(p,'speed').click();assert.equal((await status(p)).speed,2);
  await battle(p,'speed').click();assert.equal((await status(p)).speed,3);
  if(out && spec.name==='desktop'){await battle(p,'speed').click();assert.equal((await status(p)).speed,1);}
  const h01=(await state(p)).formation.indexOf('h01');
  await p.locator('[data-cast="'+h01+'"]:enabled').click({timeout:18000});
  await p.locator('.battle-cutin[data-hero="h01"]').waitFor({timeout:15000});
  if(out && spec.name==='desktop') {await p.waitForTimeout(275);await screenshot(p,spec,'cutin');}
  await p.waitForFunction(()=>window.__skyQaMotion.cuts.some(c=>c.hero==='h01') && window.__skyQaMotion.totals.some(n=>n>0));
  if(out && spec.name==='desktop') {
    await p.waitForFunction(()=>window.__skyQaMotion.segments.some(row=>row.length>=2));
    await p.waitForTimeout(95);
      const combo=await p.locator('.battle-float.combo-hit').evaluateAll(labels=>labels.map(el=>{
        const box=el.getBoundingClientRect();return {left:box.left,right:box.right};
      }).sort((a,b)=>a.left-b.left));
      assert(combo.length>=2 && combo.every((box,i)=>i===0 || box.left>=combo[i-1].right),'multi-hit labels must be distinct');
    assert(await p.locator('.battle-hits').innerText().then(t=>/[23]\s*HITS?/i.test(t)),'multi-hit counter');
    await screenshot(p,spec,'impact');await battle(p,'speed').click();await battle(p,'speed').click();
  }
  const frameMiddle=await status(p);
  await battle(p,'auto').click();assert.equal((await status(p)).auto,true);
  if(spec.full) {
    await p.locator('.battle-result').waitFor({timeout:100000});
  } else await battle(p,'skip').click();
  await p.locator('.battle-result').waitFor();
  await p.waitForFunction(()=>window.__skyQaMotion.elapsed>0);
  const motion=await p.evaluate(()=>window.__skyQaMotion),frameEnd=await status(p);
  const measuredFPS=(from,to)=>Math.round((to.presentedFrames-from.presentedFrames)*10000/(to.renderedMs-from.renderedMs))/10;
  const presentedFPS=[measuredFPS(frameStart,frameMiddle),measuredFPS(frameMiddle,frameEnd)];
  assert(presentedFPS.every(n=>Number.isFinite(n)&&n>0));
  await assertCut(p,motion.cuts.find(c=>c.hero==='h01'),'h01');
  assert(motion.spots>0 && motion.hits>0);
  assert(new Set(motion.totals.filter(v=>v>0)).size>=2);
  const increasing=motion.segments.find(row=>row.length>=2 && row.every((n,i)=>!i||n>row[i-1]));
  assert(increasing,'a single ultimate must visibly increase its own damage total more than once');
  assert.equal((await state(p)).cleared,1);assert.equal(await p.locator('.battle-contrib').count(),6);
  assert(await p.locator('.battle-drops li').count()>=4);
  await checkSettlement(p,true);
  await modalCoverage(p,spec,'.battle-result','.battle-report');
  await auditArt(p,'victory','.battle-result',['emblem_victory','emblem_star','emblem_mvp','item_gem','item_ticket','item_coin','item_core']);
  await screenshot(p,spec,'result');
  if(spec.full) {
    await battle(p,'next').click();await inspectBattle(p,spec);
    await battle(p,'skip').click();await p.locator('.battle-result').waitFor();
  }
  await battle(p,'return').click();await waitPage(p,'campaign');
  await panel(p,'mode','trials').click();assert.equal(await p.locator('.pn-trial-card').count(),3);
  for(const kind of ['tower','boss','arena'])await banner(p,'.pn-trial-card[data-value="'+kind+'"]','banner_'+kind);
  await bannerContrast(p,'trial cards','.pn-trial-card h2,.pn-trial-card .pn-trial-status');
  await auditArt(p,'tower','#view');
  const towerSkin=await panel(p,'start-trial','tower').evaluate(el=>[el,...el.children].map(n=>[null,'::before','::after'].map(ps=>{
    const s=getComputedStyle(n,ps);return s.backgroundImage+' '+s.borderImageSource+' '+(n.currentSrc||'');
  }).join(' ')).join(' '));
  assert(/ui_btn_(crimson|gold)\.png/.test(towerSkin),'missing tower challenge button artwork');
  await checkBleed(p,spec,'trials');
  await screenForReview(p,spec,'trials');
  if(spec.full) {
    for(const kind of ['tower','boss','arena']) {
      const before=await state(p);
      await panel(p,'trial',kind).click();
      await banner(p,'.pn-trial-intel .pn-trial-cover','banner_'+kind);
      await bannerContrast(p,kind+' preview','.pn-trial-cover h3');
      await auditArt(p,kind+' rewards','.pn-trial-intel',kind==='arena'?['item_ticket']:['item_gem','item_core']);
      if(kind!=='tower')await screenForReview(p,spec,'trials-'+kind);
      await panel(p,'start-trial',kind).click();
      await inspectBattle(p,spec);
      await sceneBackdrop(p,kind==='boss'?'battle_boss':'battle',kind);
      if(kind==='boss')await screenshot(p,spec,'wave4-battle-boss');
      await battle(p,'skip').click();
      await p.locator('.battle-result').waitFor();const s=await state(p);
      assert.equal(s.daily.battles,before.daily.battles+1);
      if(kind==='tower') assert.equal(s.tower,1);
      if(kind==='boss') assert(s.bossBest>0);
      if(kind==='arena') assert.equal(s.arenaWins,1);
      await battle(p,'return').click();
      await sceneBackdrop(p,'worldmap','trial return');
    }
  }
  await action(p,'home').click();
  const sorted=[...motion.drawTimes].sort((a,b)=>a-b);
  return {renderer,embedded,manualCutMs:Math.round(motion.cuts.find(c=>c.hero==='h01').duration),
    combatDurationSeconds:Math.round(motion.elapsed)/1000,presentedFPS,observedMedianBrowserFPS:Math.round(1000/sorted[Math.floor(sorted.length/2)]),
    segmentedDamageSample:increasing,distinctPositiveTotals:new Set(motion.totals.filter(v=>v>0)).size,completedNormally:!!spec.full};
}
async function importProgress(p,save) {
  await action(p,'settings').click();await action(p,'import').click();
  await p.locator('#save-json').fill(JSON.stringify(save));await action(p,'confirm-import').click();
  assert.deepEqual(await state(p),save);
}
async function verifyVfxPack(p,bundle='offlineVfx',files=vfxPaths) {
  const packed=await p.evaluate(async bundle=>{
    const pairs=await Promise.all(Object.entries(Sky[bundle]).map(async ([id,source])=>{
      const data=await (await fetch(source)).arrayBuffer();
      const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',data));
      return [id,[...digest].map(byte=>byte.toString(16).padStart(2,'0')).join('')];
    }));
    return Object.fromEntries(pairs);
  },bundle);
  const expected=Object.fromEntries(Object.entries(files).map(([id,file])=>{
    if(bundle==='offlineVfx')assert.deepEqual(originalSize(file),[1254,1254]);
    return [id,sha(fs.readFileSync(path.join(root,file)))];
  }));
  assert.deepEqual(packed,expected,'every offline sequence must preserve its complete source PNG');
  return packed;
}
async function exerciseChapterTwo(p,spec) {
  // Begin just before chapter two, then cross the boundary using normal settlement.
  const fixture=await p.evaluate(()=>Sky.Save.fresh());
  fixture.cleared=4;fixture.level=100;
  await importProgress(p,fixture);
  await action(p,'campaign').click();await panel(p,'start-route',5).click();
  await inspectBattle(p,spec);await sceneBackdrop(p,'battle','chapter 1 finale');
  await battle(p,'skip').click();await p.locator('.battle-result').waitFor();
  assert.equal((await state(p)).cleared,5);
  await battle(p,'next').click();await inspectBattle(p,spec);
  await sceneBackdrop(p,'battle_ch2','next across chapters');
  await screenshot(p,spec,'wave4-battle-ch2');
  await battle(p,'skip').click();await p.locator('.battle-result').waitFor();
  assert.equal((await state(p)).cleared,6);
  await battle(p,'again').click();await inspectBattle(p,spec);
  await sceneBackdrop(p,'battle_ch2','chapter 2 retry');
  await battle(p,'skip').click();await p.locator('.battle-result').waitFor();
  await battle(p,'return').click();await sceneBackdrop(p,'worldmap','chapter 2 return');
  await panel(p,'chapter',2).click();await panel(p,'stage',6).click();await panel(p,'start-route',6).click();
  await inspectBattle(p,spec);await sceneBackdrop(p,'battle_ch2','chapter 2 from map');
  await battle(p,'skip').click();await p.locator('.battle-result').waitFor();
  await battle(p,'return').click();await action(p,'home').click();
}
async function illustratedParty(p,spec) {
  // An isolated, reproducible regular-pool draw. Only the PRNG used during the
  // click is seeded. The game still chooses, reveals, credits and charges all cards.
  const fixture=await p.evaluate(()=>Sky.Save.fresh());
  fixture.owned=[...new Set([...fixture.owned,...leads])];
  await importProgress(p,fixture);
  await action(p,'gacha').click();
  await p.locator('[data-panel="draw"][data-value="10"]').evaluate(button=>{
    let seed=43267;
    const original=Math.random;
    try{Math.random=()=>((seed=(Math.imul(1664525,seed)+1013904223)>>>0)/4294967296);button.click();}
    finally{Math.random=original;}
  });
  await p.locator('.pn-repeat').waitFor({state:'visible'});
  assert.equal((await state(p)).tickets,fixture.tickets-10);
  const cards=p.locator('.pn-result-card'),drawn=await cards.evaluateAll(nodes=>nodes.map(n=>n.dataset.hero));
  assert(drawn.length===10 && drawn.every(id=>playable.includes(id)));
  for(const id of new Set(drawn)) {
    const lead=cards.filter({has:p.locator('.pn-result-front.illustrated')}).and(p.locator('[data-hero="'+id+'"]')).first();
    await decoded(p,lead.locator('.pn-card-scene'),artPath(id,'poster'));
    await decoded(p,lead.locator('.portrait'),artPath(id,'avatar'));
  }
  if(spec.name==='desktop'||spec.mobile)await screenshot(p,spec,'summon-illustrated');
  await panel(p,'dismiss').click();await action(p,'home').click();await action(p,'roster').click();
  await panel(p,'roster-tab',2).click();
  const weapons={}, portraits={roster:{},formation:{},battle:{}};
  for(const id of leads) {
    await panel(p,'hero',id).click();
    const faction=await p.evaluate(id=>Sky.D.hero(id).faction,id);
    await badge(p,p.locator('.pn-faction'),'faction_'+factionStems[faction],'roster hero tag');
    await decoded(p,panel(p,'hero',id).locator('img.portrait'),artPath(id,'avatar'));
    const img=p.locator('.pn-weapon-emblem>img');
    weapons[id]=await decoded(p,img,artPath(id,'weapon'));
    const fits=await img.evaluate(n=>{
      const b=n.getBoundingClientRect(),pad=n.parentElement.getBoundingClientRect();
      return getComputedStyle(n).objectFit==='contain' && b.left>=pad.left-1 && b.right<=pad.right+1 &&
        b.top>=pad.top-1 && b.bottom<=pad.bottom+1 && Math.abs((b.left+b.right)-(pad.left+pad.right))<2 &&
        Math.abs((b.top+b.bottom)-(pad.top+pad.bottom))<2;
    });
    assert(fits,'centered, uncropped weapon for '+id);
    if(spec.name==='desktop'&&['h01','h04','h05','h06'].includes(id) || spec.mobile&&id==='h04')
      await screenshot(p,spec,'weapon-'+id);
  }
  await panel(p,'roster-tab',0).click();
  for(const id of leads.slice(3)) {
    await panel(p,'hero',id).click();
    await panel(p,'art','poster').click();
    const poster=await decoded(p,p.locator('.pn-portrait img'),artPath(id,'poster'));
    if(spec.name==='desktop')await screenshot(p,spec,'roster-poster-'+id);
    await panel(p,'art','chibi').click();
    const chibi=await decoded(p,p.locator('.pn-portrait img'),artPath(id,'chibi'));
    if(spec.name==='desktop' || id==='h05' && (spec.mobile || spec.name==='retina'))
      await screenshot(p,spec,'roster-chibi-'+id);
    portraits.roster[id]={poster,chibi};
  }
  await action(p,'home').click();
  // Use the heroes recruited above in a valid test formation. A boss has enough
  // HP for all three newcomers to earn rage and cast through the normal turn queue.
  const save=await state(p);
  save.formation=['h04','h05','h06','h01','h02','h03'];
  save.level=5;
  await importProgress(p,save);
  await action(p,'roster').click();await panel(p,'formation').click();
  for(const [slot,id] of save.formation.entries()){
    const portrait=panel(p,'position',slot).locator('img.portrait');
    portraits.formation[id]=await decoded(p,portrait,artPath(id,'avatar'));
  }
  if(spec.name==='desktop'||spec.mobile)await screenshot(p,spec,'formation-leads');
  await panel(p,'dismiss').click();await action(p,'home').click();
  await action(p,'trials').click();await panel(p,'trial','boss').click();
  await panel(p,'start-trial','boss').evaluate(button=>{
    let seed=72;
    const original=Math.random;
    try{Math.random=()=>((seed=(Math.imul(1664525,seed)+1013904223)>>>0)/4294967296);button.click();}
    finally{Math.random=original;}
  });
  await recordMotion(p);await recordUltimateVfx(p);const renderer=await inspectBattle(p,spec);
  const party=(await status(p)).positions.filter(n=>n.key[0]==='a');
  assert(party.length===6 && party.every(n=>n.artwork==='original' && n.source==='pixi-texture'));
  for(const [slot,id] of save.formation.entries()){
    const portrait=p.locator('[data-cast="'+slot+'"] img.portrait');
    portraits.battle[id]=await decoded(p,portrait,artPath(id,'avatar'));
  }
  await screenshot(p,spec,'battle-leads');
  await battle(p,'speed').click();await battle(p,'speed').click();
  if((spec.name==='desktop'||spec.file) && out){
    await p.locator('.battle-cutin[data-hero="h06"]').waitFor({timeout:45000});
    await p.waitForTimeout(140);await screenshot(p,spec,'cutin-h06');
  }
  const h06Vfx=await checkUltimateVfx(p,spec,'wave5-impact-h06');
  assert(h06Vfx.mediaEnded && h06Vfx.cutSkips===0,'h06 dedicated media naturally ended before the effect');
  await p.waitForFunction(()=>['h04','h05','h06'].every(id=>window.__skyQaMotion.cuts.some(c=>c.hero===id)),null,{timeout:55000});
  const cuts=await p.evaluate(()=>window.__skyQaMotion.cuts.filter(c=>['h04','h05','h06'].includes(c.hero)));
  for(const id of leads.slice(3))await assertCut(p,cuts.find(c=>c.hero===id),id);
  await p.waitForFunction(()=>['h04','h05'].every(id=>window.__skyVfxProbe.hits.some(hit=>
    hit.ultimate && hit.actor[0]==='a' && hit.heroId===id && hit.effects.some(effect=>effect.key===id))));
  const teammateEffects=await p.evaluate(()=>['h04','h05'].map(id=>
    window.__skyVfxProbe.hits.find(hit=>hit.ultimate && hit.actor[0]==='a' && hit.heroId===id &&
      hit.effects.some(effect=>effect.key===id))));
  assertVfxPeak(teammateEffects[0],'h04','target',3,spec);
  assertVfxPeak(teammateEffects[1],'h05','projectile',3,spec);
  await p.evaluate(()=>window.__skyVfxProbeRestore());
  await battle(p,'skip').click();await p.locator('.battle-result').waitFor();
  await battle(p,'return').click();await action(p,'home').click();
  return {regularPoolSeed:43267,drawn,weapons,bossSeed:72,formation:save.formation,
    allyOriginals:party.map(n=>n.heroId),originalTextures:renderer.originalHeroes,portraits,cutins:cuts,
    h06Vfx,teammateEffects};
}
async function exerciseVfxCutSkip(p,spec) {
  const slot=await startVfxFixture(p);
  await castAndSkipVfx(p,slot);
  const trace=await checkUltimateVfx(p,spec,'wave5-skip-impact-h06');
  assert(!trace.mediaEnded && trace.cutSkips===1,'player skipped the actively playing h06 cut-in');
  await p.waitForFunction(()=>window.__skyVfxProbe.hits.some(hit=>hit.heroId==='h06' && hit.actor[0]==='a' && hit.kind==='heal'));
  const heal=await p.evaluate(()=>window.__skyVfxProbe.hits.find(hit=>hit.heroId==='h06' && hit.actor[0]==='a' && hit.kind==='heal'));
  assert(heal.amount>0 && heal.target===trace.hit.actor && heal.labels.some(label=>Number(label.replace(/\D/g,''))===heal.amount),
    'lifesteal keeps its separate heal label and caster target');
  await p.waitForFunction(()=>!Sky.battlePage.inspect()?.vfx.active.some(effect=>effect.key==='h06' && effect.actor[0]==='a'));
  const frames=await p.evaluate(started=>window.__skyVfxProbe.frames.filter(frame=>
    frame.key==='h06' && frame.role==='single' && frame.startedAt===started).map(frame=>frame.frame),
  trace.hit.effects.find(effect=>effect.key==='h06').startedAt);
  assert(frames.includes(3) && frames.at(-1)>=3 && frames.every((frame,i)=>i===0||frame>=frames[i-1]),
    'the atlas advances in order and retires');
  await p.evaluate(()=>window.__skyVfxProbeRestore());
  await battle(p,'skip').click();await p.locator('.battle-result').waitFor();
  await battle(p,'return').click();await action(p,'home').click();
  return {...trace,heal,frames,settled:true};
}
async function startFullVfxFixture(p,{formation,powerSave=false,shield=false,statuses=false,encounter='boss',enemyRage=false}) {
  const fixture=await p.evaluate(({formation,powerSave,encounter})=>{
    const save=Sky.Save.fresh();
    save.owned=Sky.D.heroes.map(hero=>hero.id);
    save.formation=formation;
    save.settings.powerSave=powerSave;
    if(typeof encounter==='number')save.cleared=encounter-1;
    return save;
  },{formation,powerSave,encounter});
  await importProgress(p,fixture);
  let enter;
  if(typeof encounter==='number'){
    await action(p,'campaign').click();
    if(encounter>5)await panel(p,'chapter',2).click();
    await panel(p,'stage',encounter).click();
    enter=panel(p,'start-route',encounter);
  }else{
    await action(p,'trials').click();await panel(p,'trial',encounter).click();
    enter=panel(p,'start-trial',encounter);
  }
  // Leave numeric resolution and target choice to the engine. Give the team
  // enough turns to exercise every cast in isolation without early settlement.
  await enter.evaluate((button,{shield,statuses,enemyRage})=>{
    const create=Sky.Battle.create;
    try {
      let seed=72;
      const rng=()=>((seed=(Math.imul(1664525,seed)+1013904223)>>>0)/4294967296);
      Sky.Battle.create=(save,spec)=>{
        const fight=create(save,spec,rng);
        for(const unit of fight.units){
          unit.maxHp=Math.max(4500,unit.maxHp);
          unit.hp=unit.side==='ally'?3300:unit.maxHp;
          if(unit.side==='ally')unit.rage=100;
          else if(enemyRage)unit.rage=100;
        }
        if(shield)fight.units.find(unit=>unit.key==='e0').shield=90;
        // Reproduce a mid-round encounter. Real engine hits, turn expiry and cleansing
        // must subsequently update these pre-existing states in the scene.
        if(statuses){
          fight.units.find(unit=>unit.key==='a0').shield=250;
          fight.units.find(unit=>unit.key==='a2').shield=380;
          fight.units.find(unit=>unit.key==='e1').status.freeze=2;
          // Reserve the rightmost rear unit as the real lowest-HP target for h06.
          fight.units.find(unit=>unit.key==='e5').hp-=500;
          fight.units.find(unit=>unit.key==='a5').status.freeze=3;
          fight.units.find(unit=>unit.key==='a5').status.breakArmor=2;
        }
        return fight;
      };
      button.click();
    } finally {Sky.Battle.create=create;}
  },{shield,statuses,enemyRage});
  await battle(p,'auto').click();
  await p.waitForFunction(()=>Sky.battlePage.inspect()?.ready,null,{timeout:45000});
}
async function queueVfxCast(p,slot,id,powerSave,natural=false) {
  await p.locator('[data-cast="'+slot+'"]:enabled').click();
  const cut=p.locator('.battle-cutin[data-hero="'+id+'"]');
  await cut.waitFor({timeout:15000});
  let media=null;
  if(!powerSave && leads.includes(id)){
    await p.waitForFunction(id=>[...document.querySelectorAll('.battle-cutin[data-hero="'+id+'"] video')].some(video=>
      video.src.includes('/ult_'+id+'.mp4') && video.currentTime>0.08 && !video.paused),id);
    media=await cut.locator('video').evaluate(video=>({clip:new URL(video.currentSrc).pathname.split('/').pop(),
      duration:video.duration,muted:video.muted,audioBytes:video.webkitAudioDecodedByteCount}));
    assert.equal(media.clip,'ult_'+id+'.mp4');
    assert(media.duration>=2.8 && media.duration<=3.2 && !media.muted,
      id+' keeps its dedicated voice clip after user interaction with game sound enabled');
  }
  if(natural)await cut.waitFor({state:'detached',timeout:4500});
  else await cut.locator('.battle-cut-skip').click();
  return media;
}
async function settleVfxFixture(p) {
  await p.evaluate(()=>window.__skyVfxProbeRestore());
  await battle(p,'skip').click();await p.locator('.battle-result').waitFor();
  assert.equal((await status(p)).vfx.active.length,0,'settlement clears live atlas sprites');
  assert.deepEqual((await status(p)).vfx.ready,[],'settlement frees all atlas textures');
  await battle(p,'return').click();await action(p,'home').click();
}
async function waitAuthoredHits(p,id,minimum) {
  await p.waitForFunction(({id,minimum})=>window.__skyVfxProbe.hits.filter(hit=>hit.heroId===id &&
    hit.ultimate && hit.actor[0]==='a' && hit.effects.some(effect=>effect.key===id)).length>=minimum,{id,minimum});
}
function confirmPopup(hit) {
  assert(hit.amount===0 ? hit.labels.includes('抵挡') || hit.labels.some(label=>label.endsWith('0')) :
    hit.labels.some(label=>Number(label.replace(/\D/g,''))===hit.amount),
  'the real hit must create its numeric floating label: '+JSON.stringify(hit));
}
async function exerciseFullVfx(p,spec) {
  const formation=['h04','h05','h06','h01','h02','h03'];
  const role={h01:'single',h02:'target',h03:'target',h04:'target',h05:'projectile',h06:'single'};
  const counts={h01:3,h02:6,h03:6,h04:3,h05:4,h06:1};
  const artCounts={...counts};
  const screenshotsAt={h01:1,h02:4,h03:4,h04:3,h05:3,h06:1};
  await startFullVfxFixture(p,{formation,shield:true});
  const ids=Object.keys(vfxPaths);
  await p.waitForFunction(keys=>keys.every(key=>Sky.battlePage.inspect()?.vfx.ready.includes(key)),ids);
  await recordUltimateVfx(p);
  await p.waitForFunction(()=>window.__skyVfxProbe.hits.some(hit=>!hit.ultimate && hit.effects.some(effect=>effect.key==='spark')));
  const spark=await p.evaluate(()=>window.__skyVfxProbe.hits.find(hit=>!hit.ultimate &&
    hit.effects.some(effect=>effect.key==='spark')));
  confirmPopup(spark);
  const firstSpark=assertVfxPeak(spark,'spark','spark',0,spec);
  assert.notEqual(firstSpark.rotation,0,'basic spark has a small runtime rotation');
  assert(Math.abs(firstSpark.rotation)<.35,'basic spark should stay close to its drawn orientation');
  await screenshot(p,spec,'full-vfx-spark');
  const atlases=await p.evaluate(()=>window.__skyVfxProbe.atlases);
  for(const [id,atlas] of Object.entries(atlases)){
    assert.equal(atlas.cornerAlpha,0,id+' black atlas backdrop is transparent');
    assert.deepEqual(atlas.frames,Array.from({length:9},(_,i)=>[i%3*418,Math.floor(i/3)*418,418,418]));
    assert(id==='spark' ? atlas.frameMs>=50&&atlas.frameMs<=56 : atlas.frameMs>=66&&atlas.frameMs<=77);
  }
  assert.deepEqual(Object.keys(atlases).sort(),[...ids].sort());
  const results={spark,atlases};
  for(const id of leads){
    if(id==='h01')await p.evaluate(()=>{
      const cast=Sky.Battle.cast;
      Sky.Battle.cast=(fight,slot)=>{
        const actor=fight.units.find(u=>u.side==='ally' && u.slot===slot);
        if(actor?.heroId==='h01' && actor.hp>0 && actor.rage===100 && !actor.status.freeze){
          Sky.Battle.cast=cast;
          // The opening basic can already have consumed the fixture's first
          // shield. Give the real cast target a live shield immediately here.
          const opponents=fight.units.filter(u=>u.side==='enemy' && u.hp>0);
          const target=Sky.Battle.standardTarget(actor,opponents);
          target.shield=Math.max(target.shield,90);
        }
        return cast(fight,slot);
      };
    });
    const media=await queueVfxCast(p,formation.indexOf(id),id,false);
    await waitAuthoredHits(p,id,screenshotsAt[id]);
    await screenshot(p,spec,'full-vfx-'+id);
    await p.waitForFunction(({id,count})=>{
      const hits=window.__skyVfxProbe.hits.filter(hit=>hit.ultimate && hit.actor[0]==='a' && hit.heroId===id);
      return hits.filter(hit=>id==='h03' ? hit.kind==='heal' : id==='h04' ? hit.kind==='shield' :
        hit.kind==='damage' && hit.target[0]==='e').length>=count &&
        (id!=='h06' || hits.some(hit=>hit.kind==='heal'));
    },{id,count:counts[id]});
    const trace=await p.evaluate(id=>({
      hits:window.__skyVfxProbe.hits.filter(hit=>hit.ultimate && hit.actor[0]==='a' && hit.heroId===id),
      frames:window.__skyVfxProbe.frames.filter(frame=>frame.actor[0]==='a' && frame.key===id),
      skipped:window.__skyVfxProbe.cutSkips.includes(id)
    }),id);
    assert(trace.skipped && trace.frames.length && trace.frames.every(frame=>!frame.cutVisible));
    const primary=trace.hits.filter(hit=>id==='h03' ? hit.kind==='heal' : id==='h04' ? hit.kind==='shield' :
      hit.kind==='damage' && hit.target[0]==='e');
    assert.equal(primary.length,counts[id],id+' actual target count');
    for(const hit of primary)confirmPopup(hit);
    const authored=primary.filter(hit=>hit.effects.some(effect=>effect.key===id && effect.role===role[id]));
    assert.equal(authored.length,artCounts[id],id+' authored impact count');
    const effects=authored.map(hit=>assertVfxPeak(hit,id,role[id],id==='h03'?4:3,spec));
    assert.deepEqual(effects.map(effect=>effect.target),authored.map(hit=>hit.target));
    assert(primary.every(hit=>!hit.procedural),id+' should use its authored art on successful load');
    assert.equal(primary.at(-1).counter,primary.reduce((total,hit)=>total+hit.amount,0),id+' running total');
    if(id==='h01'){
      assert(primary.every(hit=>hit.target===primary[0].target),'all three numbers belong to one opponent');
      const reflection=trace.hits.find(hit=>hit.kind==='damage' && hit.actor===hit.target);
      assert(reflection,'the fixture includes a real reflected hit');
      confirmPopup(reflection);
      assertVfxPeak(reflection,'spark','spark',0,spec);
    }
    if(id==='h02' || id==='h03'){
      assert.equal(new Set(primary.map(hit=>hit.target)).size,6);
      const center=assertVfxPeak(primary[0],id,'group',id==='h03'?4:3,spec);
      assert.equal(center.target,null);
      assert.deepEqual([...center.targets].sort(),primary.map(hit=>hit.target).sort());
    }
    if(id==='h02')assert.deepEqual(effects.slice(1).map((effect,i)=>effect.due-effects[i].due),[80,80,80,80,80]);
    if(id==='h04')assert.deepEqual(primary.map(hit=>hit.target).sort(),['a0','a1','a2']);
    if(id==='h05'){
      assert.deepEqual(primary.map(h=>h.impact.beat),[1,2,3,4]);
      assert(primary.at(-1).impact.finisher && primary.at(-1).impact.hold>=65 && primary.at(-1).impact.sparks===14);
      const building=primary.filter(h=>!h.impact.critical && !h.impact.finisher);
      for(let i=1;i<building.length;i++)assert(building[i].impact.sparks>building[i-1].impact.sparks &&
        building[i].kickPower>building[i-1].kickPower,'successive ordinary beats strengthen the sparks and directional kick');
      assert(effects.every((effect,i)=>!i || effect.due>effects[i-1].due),'projectiles preserve their stagger');
      const first=trace.frames.filter(frame=>frame.hitIndex===effects[0].hitIndex && frame.position);
      const launch=first.find(frame=>frame.frame<3), landing=first.find(frame=>frame.frame===3);
      assert(launch && landing && launch.position.x<landing.position.x,'shot travels from caster to target during pre-impact cels');
    }
    if(id==='h06'){
      assert(Number(primary[0].target[1])>=3 && primary[0].impact?.hold>=65,
        'rear target with strong authored hit shake');
      const heal=trace.hits.find(hit=>hit.kind==='heal');
      assert(heal?.amount>0 && heal.target===primary[0].actor);
      confirmPopup(heal);
    }
    results[id]={media,hits:trace.hits,framesSeen:[...new Set(trace.frames.map(frame=>frame.frame))]};
  }
  await settleVfxFixture(p);
  return results;
}
async function exerciseVfxSpeeds(p,spec) {
  const rates=[];
  for(const expected of [1,2,3]){
    await startFullVfxFixture(p,{formation:leads});
    await p.waitForFunction(()=>Sky.battlePage.inspect()?.vfx.ready.includes('h06'));
    for(let speed=1;speed<expected;speed++)await battle(p,'speed').click();
    assert.equal((await status(p)).speed,expected);
    await recordUltimateVfx(p);
    await queueVfxCast(p,5,'h06',false,true);
    await waitAuthoredHits(p,'h06',1);
    await p.waitForFunction(()=>!Sky.battlePage.inspect()?.vfx.active.some(effect=>effect.key==='h06' && effect.actor==='a5'));
    const trace=await p.evaluate(()=>{
      const log=window.__skyVfxProbe;
      return {hit:log.hits.find(hit=>hit.ultimate&&hit.heroId==='h06'&&hit.actor==='a5'&&hit.kind==='damage'&&hit.target[0]==='e'),
        frames:log.frames.filter(frame=>frame.key==='h06'&&frame.actor==='a5'&&frame.frame!==null),
        voice:log.voices.find(voice=>voice.id==='h06')};
    });
    assertVfxPeak(trace.hit,'h06','single',3,spec);
    const ratios=[];
    let clockInput=0;
    for(let i=1;i<trace.frames.length;i++){
      const next=trace.frames[i],previous=trace.frames[i-1],wall=next.drawClock-previous.drawClock;
      // Mirror the real ticker's cap when checking the game clock. Wall time is
      // still reported below so a delayed browser presentation remains visible.
      clockInput+=Math.min(300,wall);
      if(wall>1 && wall<290)ratios.push((next.effectClock-previous.effectClock)/wall);
    }
    const first=trace.frames[0],last=trace.frames.at(-1),hold=trace.hit.impact.hold;
    const wall=last.drawClock-first.drawClock,played=last.effectClock-first.effectClock;
    // A hit deliberately draws at its exact cue. Any unused fraction of that
    // render tick resumes after hitstop, so individual intervals can exceed 1×.
    const measured=(played+hold)/clockInput;
    assert(ratios.length>=2 && ratios.every(rate=>rate>=0) && Math.abs(measured-expected)<expected*.13,
      JSON.stringify({expected,measured,played,hold,wall,clockInput,ratios}));
    const voice=trace.voice,expectedMs=[3000,1900,1250][expected-1];
    assert(voice?.playedMs>0 && !voice.muted && voice.audioBytes>0 && Math.abs(voice.playedMs-expectedMs)<300,
      'natural end of the voiced cinematic at '+expected+'×: '+JSON.stringify(voice));
    rates.push({selected:expected,measured:+measured.toFixed(3),hold,voice,
      frames:trace.frames.map(frame=>frame.frame),renderMs:Math.round(wall),clockInputMs:Math.round(clockInput)});
    await settleVfxFixture(p);
  }
  return rates;
}
async function runVfxFocus(browser,origin,spec) {
  const issues=[], outcome={name:spec.name};
  for(const powerSave of [false,true]){
    const context=await browser.newContext({viewport:{width:spec.width,height:spec.height},deviceScaleFactor:spec.dpr,
      isMobile:!!spec.mobile,hasTouch:!!spec.mobile});
    try {
      const p=await context.newPage(),requested=[];
      p.on('pageerror',error=>issues.push('page: '+error.message));
      p.on('console',message=>{if(message.type()==='error')issues.push('console: '+message.text());});
      p.on('response',response=>{if(response.status()>=400)issues.push('HTTP '+response.status()+' '+response.url());});
      p.on('requestfailed',request=>{if(request.failure()?.errorText!=='net::ERR_ABORTED')issues.push('resource: '+request.url());});
      p.on('request',request=>{
        const url=request.url();requested.push(url);
        if(/^https?:/.test(url) && (spec.file || new URL(url).origin!==origin))issues.push('external request: '+url);
      });
      if(spec.mobile){
        const cdp=await context.newCDPSession(p);
        await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{left:44,right:35,top:0,bottom:0}});
      }
      await p.goto(spec.file?pathToFileURL(path.join(root,'index.html')).href:origin+'/index.html');
      await p.waitForFunction(()=>window.Sky?.ui?.state);
      const artRequests=()=>requested.filter(url=>url.includes('/assets/vfx/') || /\/offline-(vfx|battle-art)\.js$/.test(url));
      assert.deepEqual(artRequests(),[],'no atlas requests from the lobby');
      if(powerSave){
        await startFullVfxFixture(p,{formation:leads,powerSave:true});
        await recordUltimateVfx(p);
        await p.waitForFunction(()=>window.__skyVfxProbe.hits.some(hit=>!hit.ultimate));
        await queueVfxCast(p,5,'h06',true);
        await p.waitForFunction(()=>window.__skyVfxProbe.hits.some(hit=>hit.ultimate && hit.heroId==='h06' && hit.actor[0]==='a'));
        const hits=await p.evaluate(()=>[window.__skyVfxProbe.hits.find(hit=>!hit.ultimate),
          window.__skyVfxProbe.hits.find(hit=>hit.ultimate && hit.heroId==='h06' && hit.actor[0]==='a')]);
        assert(hits.every(hit=>hit.procedural && hit.effects.length===0));
        assert.deepEqual((await status(p)).vfx.ready,[]);
        assert.deepEqual(artRequests(),[],'power saving uses no VFX atlas resources');
        outcome.powerSave={hits,requests:0};
        if(hudOnly)outcome.powerSave.hud=await checkPowerHud(p);
        await settleVfxFixture(p);
      } else {
        outcome.stage=await geometry(p,spec);
        if(hudOnly)outcome.hud=await exerciseHud(p,spec,{startFullVfxFixture,queueVfxCast,battle,action,screenshot});
        else{
          outcome.normal=await exerciseFullVfx(p,spec);
          outcome.speeds=await exerciseVfxSpeeds(p,spec);
        }
        const packs=artRequests().filter(url=>url.endsWith('/offline-vfx.js'));
        assert.equal(packs.length,spec.file?1:0);
        assert.equal(artRequests().filter(url=>url.endsWith('/offline-battle-art.js')).length,spec.file?1:0);
        if(spec.file){
          outcome.embeddedSha256=await verifyVfxPack(p);
          outcome.battleArtSha256=await verifyVfxPack(p,'offlineBattleArt',battleArtPaths);
        }
        else {
          const files=artRequests().map(url=>new URL(url).pathname.slice(1));
          assert.deepEqual([...new Set(files)].sort(),[...Object.values(vfxPaths),...Object.values(battleArtPaths)].sort());
        }
        outcome.offlinePackRequests=packs.length;
      }
    } finally {await context.close();}
  }
  assert.deepEqual(issues,[]);
  return {...outcome,errors:issues};
}
async function run(browser,origin,spec) {
  const context=await browser.newContext({viewport:{width:spec.width,height:spec.height},deviceScaleFactor:spec.dpr,isMobile:!!spec.mobile,hasTouch:!!spec.mobile});
  const p=await context.newPage();p.setDefaultTimeout(9000);
  visualChecks.set(p,{});
  mobileEdges.set(p,{});
  wave2Checks.set(p,{artwork:{},contrast:{},masks:{}});
  wave4Checks.set(p,{scenes:{},badges:{},contrast:{}});
  const issues=[],failed=[],requested=[];
  p.on('pageerror',e=>issues.push('page: '+e.message));
  p.on('console',m=>{if(m.type()==='error')issues.push('console: '+m.text());});
  p.on('response',r=>{if(r.status()>=400)issues.push('HTTP '+r.status()+' '+r.url());});
  p.on('request',r=>{
    requested.push(r.url());
    if(/^https?:/.test(r.url()) && (spec.file || new URL(r.url()).origin!==origin)) issues.push('unexpected network URL '+r.url());
  });
  p.on('requestfailed',r=>{if(r.failure()?.errorText!=='net::ERR_ABORTED')failed.push(r.failure()?.errorText+' '+r.url());});
  try {
    if(spec.mobile) {
      const cdp=await context.newCDPSession(p);
      await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{left:44,right:35,top:0,bottom:0}});
    }
    await p.goto(spec.file?pathToFileURL(path.join(root,'index.html')).href:origin+'/index.html');
    await p.waitForFunction(()=>window.Sky?.ui?.state);
    await decoded(p,p.locator('.backdrop.current'),artPath('h01','poster'));
    const startupPosters=[...new Set(requested.filter(u=>u.includes('/assets/posters/')).map(u=>u.split('/').pop()))];
    assert.deepEqual(startupPosters,['lobby_cg_c07.png'],'cold load should request just the selected lobby poster');
    const startupVideos=[...new Set(requested.filter(u=>new URL(u).pathname.endsWith('.mp4')).map(u=>u.split('/').pop()))];
    assert(startupVideos.every(video=>video==='lobby_cg_h01.mp4'),'cold lobby must not preload other lobby or battle clips');
    assert(!requested.some(url=>url.endsWith('/offline-textures.js')),'cold lobby should not load the offline battle bundle');
    assert(!requested.some(url=>url.includes('/assets/vfx/')||url.endsWith('/offline-vfx.js')),'cold lobby must not load battle VFX');
    const stage=await geometry(p,spec),images=await artwork(p,spec);
    await runLobby(p,spec);await runRoster(p,spec);await runGacha(p,spec);
    const combat=await runCampaign(p,spec);
    await runSaveDialog(p,spec);
    const before=await state(p);await p.reload();await p.waitForFunction(()=>window.Sky?.ui?.state);
    const after=await state(p);
    assert.deepEqual(after.formation,before.formation);assert.equal(after.cleared,before.cleared);
    assert.deepEqual(after.pity,before.pity);
    await exerciseLateGameArt(p,spec);
    const wave3=await illustratedParty(p,spec);
    const wave5={natural:wave3.h06Vfx,teammateEffects:wave3.teammateEffects,skipped:await exerciseVfxCutSkip(p,spec)};
    delete wave3.h06Vfx;delete wave3.teammateEffects;
    wave5.offlinePackRequests=requested.filter(url=>url.endsWith('/offline-vfx.js')).length;
    // The full campaign exercise also reloads the app once to verify save compatibility.
    assert.equal(wave5.offlinePackRequests,spec.file?2:0);
    if(spec.file)wave5.embeddedSha256=await verifyVfxPack(p);
    await exerciseChapterTwo(p,spec);
    wave3.startupPosters=startupPosters;
    wave3.offlineBundleRequests=requested.filter(url=>url.endsWith('/offline-textures.js')).length;
    assert(spec.file ? wave3.offlineBundleRequests>=1 : wave3.offlineBundleRequests===0);
    wave3.videoRequests=requested.filter(url=>new URL(url).pathname.endsWith('.mp4'));
    const videosEnabled=await p.evaluate(()=>Sky.D.illustrated.some(id=>Sky.art.video(id) || Sky.art.ultVideo(id)));
    if(!videosEnabled)assert.deepEqual(wave3.videoRequests,[],'No video requests with an empty video manifest');
    if(spec.mobile) {
      await p.setViewportSize({width:390,height:844});await p.locator('#orientation:visible').waitFor();
      await p.locator('#portrait-continue').click();await p.locator('#orientation').waitFor({state:'hidden'});
      await action(p,'roster').click();await waitPage(p,'roster');
    }
    if(issues.length||failed.length) throw new Error('Resource or browser errors');
    const screens=visualChecks.get(p);
    const visible=new Set(Object.values(screens).flat());
    assert.deepEqual(wave1Paths.filter(name=>!visible.has(name)),[],'wave 1 assets missing from real UI states');
    const wave2=wave2Checks.get(p);
    const wave4=wave4Checks.get(p);
    assert.equal(Object.keys(wave4.badges).length,9,'every new badge should appear');
    assert.equal(Object.keys(wave2.artwork).length,6,'all six banners should appear');
    wave2.sha256=Object.fromEntries(Object.keys(wave2.artwork).map(src=>[src,sha(fs.readFileSync(path.join(root,src)))]));
    return {name:spec.name,stage,images,...combat,wave1ArtCount:visible.size,screenArt:screens,mobileEdgeSamples:mobileEdges.get(p),wave2,wave3,wave4,wave5,
      lateGameEvidence:'Imported test save, four UR items, level 1 vs tower 30. Real game resolution.',consoleErrorsAndHTTPFailures:issues.length};
  } catch(err) {
    const page=await p.evaluate(()=>({page:document.querySelector('#view')?.dataset.page,toast:document.querySelector('#toast')?.innerText,
      battle:window.Sky?.battlePage?.inspect()?.phase,head:document.body.innerText.slice(0,700)})).catch(()=>null);
    if(out) await screenshot(p,spec,'failure').catch(()=>{});
    throw new Error(spec.name+' '+err.message+'\n'+JSON.stringify({page,issues:[...new Set(issues)],failed:[...new Set(failed)]}));
  } finally {await context.close();}
}
async function inspectWave6Boss(p,spec) {
  await inspectBattle(p,spec);
  const info=await status(p);
  const enemies=info.positions.filter(unit=>unit.key.startsWith('e'));
  assert.equal(enemies.length,6);
  assert(enemies.every(unit=>villains.includes(unit.heroId) && unit.sourceFacing==='left' && !unit.mirror));
  const bosses=enemies.filter(unit=>unit.boss);
  assert.equal(bosses.length,1);
  const boss=bosses[0];
  assert.equal(boss.key,'e1');
  assert.equal(boss.heroId,'enemy_boss_mech');
  assert(boss.magnification>=1.45 && boss.magnification<=1.6);
  assert(enemies.filter(unit=>unit!==boss).every(unit=>unit.magnification===1));
  return {boss,enemies};
}

async function wave6Lobby(p,spec,requested) {
  const gallery=p.locator('.catalog');
  await action(p,'atlas').click();
  assert.equal(await gallery.locator('[data-entry]').count(),playable.length);
  const stage=await p.locator('#stage').boundingBox();
  const catalog={};
  for(const id of playable){
    const tile=gallery.locator('[data-entry="'+id+'"]');
    catalog[id]=await decoded(p,tile.locator('img.portrait'),artPath(id,'avatar'));
    const box=await tile.boundingBox();
    assert(box.x>=stage.x-1 && box.y>=stage.y-1 &&
      box.x+box.width<=stage.x+stage.width+1 && box.y+box.height<=stage.y+stage.height+1,
      id+' codex card stays fully inside the stage');
  }
  assert(!await gallery.getByText(/加百列|诺亚/).count());
  await screenshot(p,spec,'wave6-codex');
  await action(p,'close').click();

  const board={};
  for(const id of [...playable.slice(1),playable[0]]){
    await action(p,'poster').click();
    await p.waitForFunction(id=>Sky.ui.state.settings.poster===id,id);
    await decoded(p,p.locator('.backdrop.current'),artPath(id,'poster'));
    assert.equal(await p.locator('.poster-dots i').count(),playable.length);
    if(!newStars.includes(id))continue;
    const media=p.locator('.lobby-media').filter({has:p.locator('.backdrop.current[data-poster="'+id+'"]')});
    await p.waitForFunction(id=>{
      const current=document.querySelector('.backdrop.current[data-poster="'+id+'"]');
      return current && +getComputedStyle(current.parentElement).opacity>.99;
    },id);
    if(id==='h08'){
      await p.waitForFunction(()=>[...document.querySelectorAll('.lobby-media:has(.backdrop.current) video')].some(video=>
        video.classList.contains('is-playing') && video.currentTime>.12 && video.readyState>=2 && !video.paused));
      const video=await media.locator('video.is-playing').evaluate(video=>({
        path:new URL(video.currentSrc).pathname.split('/').pop(),muted:video.muted,
        width:video.videoWidth,height:video.videoHeight,duration:video.duration
      }));
      assert.equal(video.path,'lobby_cg_h08.mp4');
      assert(video.muted && video.height===1080 && video.duration>=4.8 && video.duration<=5.3);
      board[id]=video;
    }else{
      const still=await media.evaluate(layer=>({animation:getComputedStyle(layer).animationName}));
      assert.equal(await media.locator('video').count(),0);
      assert.equal(still.animation,'poster-breathe');
      board[id]=still;
    }
    if(spec.name==='desktop' || id==='h08')await screenshot(p,spec,'wave6-lobby-'+id);
  }
  const unregistered=newStars.filter(id=>id!=='h08');
  assert(!requested.some(url=>unregistered.some(id=>url.endsWith('lobby_cg_'+id+'.mp4'))));
  return {catalog,board};
}

async function wave6Combat(p,spec) {
  await action(p,'campaign').click();
  await panel(p,'start-route',1).click();
  await inspectBattle(p,spec);
  const route=(await status(p)).positions.filter(unit=>unit.key.startsWith('e'));
  assert(route.every(unit=>villains.includes(unit.heroId) && unit.sourceFacing==='left' && !unit.mirror && !unit.boss));
  assert.deepEqual([...new Set(route.map(unit=>unit.heroId))].sort(),villains.slice(1).sort());
  const embedded=spec.file ? await checkEmbedded(p) : null;
  await screenshot(p,spec,'wave6-route-enemies');
  await battle(p,'skip').click();
  await p.locator('.battle-result').waitFor();
  assert.equal((await state(p)).cleared,1);
  await battle(p,'return').click();
  await action(p,'home').click();

  const fixture=await p.evaluate(()=>{
    const save=Sky.Save.fresh();
    save.cleared=9;save.tower=4;save.level=25;
    return save;
  });
  for(const [kind,id] of [['campaign',5],['campaign',10],['tower',5]]){
    await importProgress(p,fixture);
    if(kind==='campaign'){
      await action(p,'campaign').click();
      await panel(p,'chapter',id===5?1:2).click();
      await panel(p,'stage',id).click();
      await panel(p,'start-route',id).click();
    }else{
      await action(p,'trials').click();
      await panel(p,'start-trial','tower').click();
    }
    await inspectWave6Boss(p,spec);
    if(spec.name==='desktop')await screenshot(p,spec,'wave6-'+kind+'-'+id+'-boss');
    await battle(p,'skip').click();await p.locator('.battle-result').waitFor();
    await battle(p,'return').click();await action(p,'home').click();
  }

  const formation=['h07','h08','h09','h10','h11','h01'];
  await startFullVfxFixture(p,{formation});
  const arena=await inspectWave6Boss(p,spec);
  await recordUltimateVfx(p);
  await p.waitForFunction(keys=>keys.every(id=>Sky.battlePage.inspect().vfx.ready.includes(id)),newStars);
  await screenshot(p,spec,'wave6-boss');
  await p.waitForFunction(keys=>keys.every(id=>window.__skyVfxProbe.projectiles['proj_'+id]),newStars,
    {timeout:35000});
  const effects={};
  for(const id of newStars){
    const slot=formation.indexOf(id);
    const cut=p.locator('.battle-cutin[data-hero="'+id+'"]');
    await p.locator('[data-cast="'+slot+'"]:enabled').click();
    await cut.waitFor({timeout:15000});
    assert((await cut.getAttribute('style')).includes(artPath(id,'poster')));
    if(id==='h08'){
      await p.waitForFunction(()=>{
        const video=document.querySelector('.battle-cutin[data-hero=h08] video'),audio=Sky.audio.inspect();
        return video?.currentTime>.22 && !video.paused && !video.muted && video.webkitAudioDecodedByteCount>0 &&
          audio.ducked && Math.abs(audio.tracks.battle?.volume-Sky.ui.state.settings.musicVolume*.22)<.004;
      });
      await screenshot(p,spec,'wave6-h08-ult');
      await cut.waitFor({state:'detached',timeout:7500});
      await p.waitForFunction(()=>{
        const audio=Sky.audio.inspect();
        return !audio.ducked && Math.abs(audio.tracks.battle?.volume-Sky.ui.state.settings.musicVolume)<.004;
      });
    }else{
      assert.equal(await cut.getAttribute('data-media'),'poster');
      await cut.waitFor({state:'detached',timeout:3600});
    }
    await waitAuthoredHits(p,id,1);
    if((spec.name==='desktop' || id==='h08') && out)await screenshot(p,spec,'wave6-'+id+'-impact');
    await p.waitForFunction(id=>!Sky.battlePage.inspect()?.vfx.active.some(effect=>effect.key===id && effect.actor[0]==='a'),id);
    const trace=await p.evaluate(id=>({
      frames:[...new Set(window.__skyVfxProbe.frames.filter(frame=>frame.key===id && frame.actor[0]==='a')
        .map(frame=>frame.frame).filter(Number.isInteger))].sort((a,b)=>a-b),
      hit:window.__skyVfxProbe.hits.find(hit=>hit.heroId===id && hit.ultimate &&
        hit.actor[0]==='a' && hit.effects.some(effect=>effect.key===id)),
      atlases:window.__skyVfxProbe.atlases,
      voice:window.__skyVfxProbe.voices.find(voice=>voice.id===id) || null,
      projectile:window.__skyVfxProbe.projectiles['proj_'+id]
    }),id);
    assert(trace.frames.length>=5 && !trace.hit.cutVisible);
    assert(trace.projectile && trace.projectile.artKey!==trace.projectile.key);
    const impact=trace.hit.effects.find(effect=>effect.key===id);
    assert.equal(trace.atlases[impact.artKey].frames.length,9);
    assert(impact.artKey!==id && impact.tint!==0xffffff && impact.source===(spec.file?'embedded':'png'));
    if(id==='h08'){
      assert.equal(trace.voice.clip,'ult_h08.mp4');
      assert(trace.voice.audioBytes>0 && !trace.voice.muted && trace.voice.rate===1);
      assert(trace.voice.duration>=4.8 && trace.voice.duration<=5.3);
      assert(trace.voice.playedMs>=4700 && trace.voice.playedMs<=5600);
    }
    effects[id]={frames:trace.frames,impact,projectile:trace.projectile,voice:trace.voice};
  }
  await settleVfxFixture(p);

  await startFullVfxFixture(p,{formation});await recordUltimateVfx(p);
  await p.locator('[data-cast="1"]:enabled').click();
  const repeat=p.locator('.battle-cutin[data-hero=h08]');
  await p.waitForFunction(()=>Sky.audio.inspect().ducked && document.querySelector('.battle-cutin[data-hero=h08] video')?.currentTime>.16);
  await repeat.locator('.battle-cut-skip').click();
  await repeat.waitFor({state:'detached'});
  await waitAuthoredHits(p,'h08',1);
  await p.waitForFunction(()=>!Sky.audio.inspect().ducked);
  const skipped=await p.evaluate(()=>({
    mediaEnded:window.__skyVfxProbe.mediaEnded.includes('h08'),
    cutSkipped:window.__skyVfxProbe.cutSkips.includes('h08'),
    hit:window.__skyVfxProbe.hits.find(hit=>hit.heroId==='h08' && hit.ultimate && hit.actor[0]==='a')
  }));
  assert(skipped.cutSkipped && !skipped.mediaEnded && skipped.hit?.effects.some(effect=>effect.key==='h08'));
  await settleVfxFixture(p);
  return {route,arena,embedded,effects,skipped};
}

async function runWave6Focus(browser,origin,spec) {
  const context=await browser.newContext({viewport:{width:spec.width,height:spec.height},deviceScaleFactor:spec.dpr,
    isMobile:!!spec.mobile,hasTouch:!!spec.mobile});
  const p=await context.newPage();p.setDefaultTimeout(15000);
  const issues=[],requests=[];
  p.on('pageerror',error=>issues.push('page: '+error.message));
  p.on('console',message=>{if(message.type()==='error')issues.push('console: '+message.text());});
  p.on('response',response=>{if(response.status()>=400)issues.push('HTTP '+response.status()+' '+response.url());});
  p.on('requestfailed',request=>{if(request.failure()?.errorText!=='net::ERR_ABORTED')
    issues.push('request: '+request.failure()?.errorText+' '+request.url());});
  p.on('request',request=>{
    const url=request.url();requests.push(url);
    if(/^https?:/.test(url) && (spec.file || new URL(url).origin!==origin))issues.push('external URL '+url);
  });
  try {
    if(spec.mobile){
      const cdp=await context.newCDPSession(p);
      await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{left:44,right:35,top:0,bottom:0}});
    }
    await p.goto(spec.file?pathToFileURL(path.join(root,'index.html')).href:origin+'/index.html');
    await p.waitForFunction(()=>window.Sky?.ui?.state);
    const stage=await geometry(p,spec),images=await artwork(p,spec);
    const lobby=await wave6Lobby(p,spec,requests);
    const combat=await wave6Combat(p,spec);
    assert.deepEqual(issues,[]);
    return {name:spec.name,stage,images,lobby,combat,errors:issues};
  }catch(error){
    if(out)await screenshot(p,spec,'wave6-failure').catch(()=>{});
    throw new Error(spec.name+' '+error.stack+'\n'+JSON.stringify([...new Set(issues)]));
  }finally{await context.close();}
}

async function replacementCheck(browser) {
  const parent=path.resolve(out||os.tmpdir());
  const temp=fs.mkdtempSync(path.join(parent,'sky_odyssey_art_test_'));
  let server;
  try {
    for(const part of ['index.html','js','css','assets','lib']) fs.cpSync(path.join(root,part),path.join(temp,part),{recursive:true});
    const files=[['chibi','chibi_'],['posters','lobby_cg_'],['avatars','avatar_']];
    const replacements=['h04','h08'];
    const sizes={};
    for(const [folder,prefix] of files) {
      const original=fs.readFileSync(path.join(root,'assets',folder,prefix+'protag.png'));
      for(const id of replacements)fs.writeFileSync(path.join(temp,'assets',folder,prefix+id+'.png'),original);
      sizes[folder]=[original.readUInt32BE(16),original.readUInt32BE(20)];
    }
    server=await serve(temp);
    const result=[];
    for(const mode of ['http','file']) {
      const context=await browser.newContext({viewport:{width:1280,height:720}});
      try {
        const p=await context.newPage(),errors=[];
        p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
        p.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});
        p.on('requestfailed',r=>{if(r.failure()?.errorText!=='net::ERR_ABORTED')errors.push(r.url());});
        p.on('request',r=>{if(mode==='file'&&/^https?:/.test(r.url()))errors.push('file made an HTTP request');});
        await p.goto(mode==='file'?pathToFileURL(path.join(temp,'index.html')).href:'http://127.0.0.1:'+server.address().port+'/index.html');
        await action(p,'roster').click();
        const checkPicture=async(selector,dims,ending)=>{
          const a=await p.locator(selector).first().evaluate(async img=>{await img.decode();return [img.naturalWidth,img.naturalHeight,new URL(img.src).pathname];});
          assert.deepEqual(a.slice(0,2),dims);assert(a[2].endsWith(ending));
        };
        for(const id of replacements){
          await panel(p,'hero',id).click();await panel(p,'art','poster').click();
          await checkPicture('.pn-portrait img',sizes.posters,'/lobby_cg_'+id+'.png');
          await checkPicture('[data-panel="hero"][data-value="'+id+'"] img.portrait',sizes.avatars,'/avatar_'+id+'.png');
          await panel(p,'art','chibi').click();await checkPicture('.pn-portrait img',sizes.chibi,'/chibi_'+id+'.png');
        }
        await action(p,'home').click();await action(p,'campaign').click();await panel(p,'start-route',1).click();
        await p.waitForFunction(()=>Sky.battlePage.inspect()?.ready);
        const b=await status(p),sources={};
        for(const id of replacements){
          const units=b.positions.filter(u=>u.heroId===id);
          assert(units.length && units.every(u=>u.source===(mode==='file'?'native-image':'pixi-texture')));
          sources[id]=units[0].source;
          if(mode==='file')await checkPicture('.battle-file-unit img[src$="chibi_'+id+'.png"]',sizes.chibi,'/chibi_'+id+'.png');
          else assert(b.textures.some(t=>t.heroId===id && t.width===sizes.chibi[0] && t.height===sizes.chibi[1]));
        }
        await battle(p,'skip').click();await p.locator('.battle-result').waitFor();
        assert.equal((await state(p)).cleared,1);assert.deepEqual([...new Set(errors)],[]);
        result.push({mode,source:sources.h04,sources,artworkSizes:sizes});
      } finally {await context.close();}
    }
    console.log(JSON.stringify({name:'replacement',results:result}));
    if(out)fs.writeFileSync(path.join(out,'replacement-report.json'),JSON.stringify(result,null,2));
  } finally {
    if(server)await new Promise(resolve=>server.close(resolve));
    // Remove only the private directory this test just allocated, never the game tree.
    if(path.dirname(temp)===parent && path.basename(temp).startsWith('sky_odyssey_art_test_') && temp!==root) fs.rmSync(temp,{recursive:true,force:true});
  }
}
(async()=>{
  if(out)fs.mkdirSync(out,{recursive:true});
  const server=await serve();
  let browser;
  try {
    const config={headless:true,args:['--mute-audio']};
    if(chrome)config.executablePath=chrome;
    browser=await chromium.launch(config);
    const origin='http://127.0.0.1:'+server.address().port;
    const reports=[];
    const chosen=presets.filter(x=>selected ? selected.split(',').includes(x.name) : !x.extra);
    const replacements=!vfxOnly && !hudOnly && !wave6Only && !effectsUpgrade && !actorUpgrade && !domainCinema &&
      (!selected || selected.split(',').includes('replacement'));
    assert(chosen.length||replacements,'unknown --case');
    for(const spec of chosen) {
      if(spec.name==='canvas'){
        await browser.close();
        browser=await chromium.launch({...config,args:[...config.args,'--disable-webgl']});
      }
      const result=domainCinema ? await runDomainCinema(browser,origin,spec,{root,out},
        {action,panel,battle,geometry,startFullVfxFixture,screenshot,importProgress,
          verifyBattleArt:p=>verifyVfxPack(p,'offlineBattleArt',battleArtPaths)}) : actorUpgrade ?
        await runActorUpgrade(browser,origin,spec,{root,out},
        {action,panel,battle,geometry,startFullVfxFixture,screenshot,queueVfxCast,checkEmbedded}) : effectsUpgrade ?
        await runVfxUpgrade(browser,origin,spec,{baseline:upgradeBaseline,root,out},
          {action,panel,battle,geometry,startFullVfxFixture,screenshot,queueVfxCast}) :
        await (wave6Only?runWave6Focus:vfxOnly||hudOnly?runVfxFocus:run)(browser,origin,spec);
      reports.push(result);console.log(JSON.stringify(result));
      if(out)fs.writeFileSync(path.join(out,spec.name+(domainCinema?'-cinema':actorUpgrade?'-actor':effectsUpgrade ?
        upgradeBaseline?'-before':'-after' : wave6Only?'-wave6':hudOnly?'-hud':vfxOnly?'-vfx':'')+'-report.json'),JSON.stringify(result,null,2));
    }
    if(replacements)await replacementCheck(browser);
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
