'use strict';
// Run with Node and Playwright installed. Optional --root, --chrome, --out, --baseline and --case values.
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
const chrome=option('chrome',process.env.CHROME_PATH);
const presets=[
  {name:'desktop',width:1280,height:720,dpr:1,full:true},
  {name:'retina',width:1440,height:900,dpr:2,full:true},
  {name:'mobile',width:844,height:390,dpr:3,mobile:true,full:true},
  {name:'file',width:1280,height:720,dpr:1,file:true,full:true},
  {name:'1080p',width:1920,height:1080,dpr:1,full:true,extra:true},
  {name:'qhd',width:2560,height:1440,dpr:1,full:true,extra:true},
  {name:'4k',width:3840,height:2160,dpr:1,full:true,extra:true}
];
const sha=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
const wave1Paths=[
  ...['gem','coin','ticket','core','shard','chest','dew','dust','stamina'].map(n=>'items/item_'+n),
  ...['weapon','armor','accessory','relic'].flatMap(n=>['sr','ur'].map(r=>'items/gear_'+n+'_'+r)),
  ...['quest','reward','codex','bag','shop','formation','roster','gacha','settings'].map(n=>'icons/icon_'+n),
  ...['victory','defeat','mvp','star'].map(n=>'ui/emblem_'+n),
  ...['btn_gold','btn_cyan','btn_crimson','tab_active','tab_idle'].map(n=>'ui/ui_'+n)
].map(name=>'assets/'+name+'.png');
const baseline=option('baseline',null);
const assetsDir=path.join(root,'assets');
const originalPaths=fs.readdirSync(assetsDir,{recursive:true}).filter(n=>n.endsWith('.png')).map(n=>'assets/'+n.split(path.sep).join('/')).sort();
if(baseline) {
  const expected=JSON.parse(fs.readFileSync(baseline,'utf8').replace(/^\uFEFF/,''));
  assert.deepEqual(expected.map(entry=>entry.path).sort(),originalPaths,'PNG list changed since the supplied baseline');
  for(const entry of expected)assert.equal(sha(fs.readFileSync(path.join(root,entry.path))),entry.sha256.toLowerCase(),entry.path);
}
const visualChecks=new WeakMap();
const mobileEdges=new WeakMap();
const wave2Checks=new WeakMap();

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
async function bannerContrast(p,label,selector) {
  const boxes=await p.locator(selector).evaluateAll(nodes=>nodes.map(el=>{
    const range=document.createRange();range.selectNodeContents(el);
    const b=range.getBoundingClientRect();
    return {text:el.textContent.trim(),rgb:getComputedStyle(el).color.match(/[\d.]+/g).slice(0,3).map(Number),
      x:b.left,y:b.top,right:b.right,bottom:b.bottom};
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
  wave2Checks.get(p).contrast[label]=values;
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
    if (!file.startsWith(siteRoot+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()) {res.writeHead(404).end();return;}
    const types={'.html':'text/html; charset=utf-8','.png':'image/png','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml'};
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});
    fs.createReadStream(file).pipe(res);
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
  if(spec.file) {
    const embedded=await p.evaluate(async()=>{
      const entries=Object.entries(Sky.offlineChibi);
      return Promise.all(entries.map(async([id,url])=>{
        const data=await (await fetch(url)).arrayBuffer();
        const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',data));
        return [id,[...digest].map(byte=>byte.toString(16).padStart(2,'0')).join('')];
      }));
    });
    const stems={h01:'c07',h02:'protag',h03:'c15'};
    assert(Object.keys(stems).every(id=>embedded.some(([key])=>key===id)));
    for(const [id,hash] of embedded) assert.equal(hash,sha(fs.readFileSync(path.join(root,'assets/chibi/chibi_'+(stems[id]||id)+'.png'))));
  }
  return actual.length;
}
async function runLobby(p,spec) {
  const initial=await state(p);
  assert.equal(initial.formation.length,6);assert.equal(initial.tickets,30);assert.equal(initial.diamonds,4800);
  assert.equal(initial.settings.powerSave,false);
  for(const [selector,name] of [['.route-tile','tile_campaign'],['.trial-tile','banner_tower'],['.idle-tile','tile_idle_box'],['.small-tiles [data-action=shop]','tile_shop']])await banner(p,selector,name);
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
  const seen=new Set([initial.settings.poster]);
  for(let n=0;n<3;n++) {await action(p,'poster').click();seen.add((await state(p)).settings.poster);}
  assert.equal(seen.size,3);
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
      return (stat.atk?'攻击':'生命')+'+'+(stat.atk||stat.hp).toLocaleString('zh-CN');
    });
  });
  assert.deepEqual(bonuses,expectedBonuses,'each slot must display its actual equipment bonus');
  await auditArt(p,'gear','#view',['gear_weapon_sr','gear_armor_sr','gear_accessory_sr','gear_relic_sr']);
  await screenForReview(p,spec,'gear');
  await panel(p,'gear-slot',0).click();await panel(p,'enhance',equipped[0]).click();
  assert.equal((await state(p)).bag.find(x=>x.uid===equipped[0]).level,1);
  await panel(p,'dismiss').click();await panel(p,'roster-tab',2).click();
  await p.locator('.pn-weapon-emblem img').waitFor();await panel(p,'roster-tab',3).click();
  await panel(p,'skill',1).click();assert((await p.locator('.pn-skill-detail').innerText()).includes('九幽墨莲斩'));
  await panel(p,'filter','圣辉').click();assert.equal(await p.locator('.pn-hero-pick').count(),1);
  await panel(p,'formation').click();assert.equal(await p.locator('.pn-position').count(),6);
  await modalCoverage(p,spec,'.pn-scrim','.pn-dialog');
  await auditArt(p,'formation','.pn-formation-layout');
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
  const expected=await p.evaluate(()=>['h01','h02','h03'].map(id=>new URL(Sky.art(id,'avatar'),document.baseURI).href));
  assert.deepEqual(portraits,expected,'featured gacha character portraits');
  const badges=await featured.locator('small').evaluateAll(nodes=>nodes.map(n=>{
    const skin=getComputedStyle(n);
    return {border:parseFloat(skin.borderTopWidth),fill:skin.backgroundColor};
  }));
  assert.equal(badges.length,3);
  assert(badges.every(b=>b.border>0 && !['transparent','rgba(0, 0, 0, 0)'].includes(b.fill)),'featured rarity badge dark fill and rim');
  const ratesText=(await featured.innerText()).replace(/\s/g,'');assert(ratesText.includes('UR2%') && ratesText.includes('SSR13%'));
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
  await action(p,'atlas').click();assert.equal(await p.locator('[data-entry]').count(),8);
  await p.locator('[data-entry="h06"]').click();
  assert((await p.getByRole('dialog').innerText()).includes('猩红月蚀'));
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
    assert.equal(actor.mirror,actor.key[0]==='e');
    assert(actor.key[0]==='e'?actor.x>.5:actor.x<.5);
    assert(Math.abs(actor.depth-[.88,.96,1.04][Number(actor.key.slice(1))%3])<1e-6,'rank perspective '+actor.key);
  }
  const gauges=await p.locator('[data-cast]').evaluateAll(cards=>cards.map(card=>[...card.querySelectorAll('.meter')].map(n=>n.className)));
  assert(gauges.every(([hp,rage])=>hp?.includes('cyan') && rage?.includes('gold')),'battle HP/rage colors');
  const constants=await p.evaluate(()=>[PIXI.MIPMAP_MODES.ON,PIXI.SCALE_MODES.LINEAR]);
  assert(info.textures.length>=3);
  assert(info.textures.every(t=>t.mipmap===constants[0] && t.scaleMode===constants[1]));
  const existingAssets=['c07','c15','protag'].map(stem=>{
    const png=fs.readFileSync(path.join(root,'assets/chibi/chibi_'+stem+'.png'));
    return [png.readUInt32BE(16),png.readUInt32BE(20)];
  });
  for(const [w,h] of existingAssets) assert(info.textures.some(t=>t.width===w&&t.height===h));
  return {canvas:info.canvas,gpu:context.gpu,textures:info.textures.length,
    spriteCount:info.positions.filter(n=>n.source==='pixi-texture').length};
}
async function recordMotion(p) {
  // Observe the real DOM throughout a fight, including transient 850 ms cut-ins and per-hit totals.
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
          if(node.matches('.battle-cutin')) starts.set(node,performance.now());
          if(node.matches('.battle-float')) log.hits++;
        }
        for(const node of mutation.removedNodes) {
          if(starts.has(node)) {
            log.cuts.push({hero:node.dataset.hero,duration:performance.now()-starts.get(node),
              image:node.style.getPropertyValue('--cut-image')});starts.delete(node);
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
  });
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
  await auditArt(p,'route','#view',['item_gem','item_ticket','ui_btn_gold']);
  await checkBleed(p,spec,'campaign');
  await screenForReview(p,spec,'campaign');
  assert.equal(await p.locator('.pn-route-node').count(),5);
  await panel(p,'chapter',2).click();assert.equal(await p.locator('.pn-route-node:disabled').count(),5);
  assert(!(await p.locator('.pn-route-node:disabled i').allTextContents()).some(s=>s.trim()==='锁'),'locked nodes need a lock icon');
  await panel(p,'chapter',1).click();await panel(p,'stage',1).click();assert.equal(await p.locator('.pn-enemies>div').count(),6);
  const enemies=await p.locator('.pn-enemies>div').evaluateAll(async cells=>Promise.all(cells.map(async cell=>{
    const id=cell.dataset.hero;
    const avatar=cell.querySelector('img.portrait'),frame=cell.querySelector('img.rim');
    if(!avatar||!frame)return null;
    await Promise.all([avatar.decode(),frame.decode()]);
    const inner=avatar.getBoundingClientRect(),outer=frame.getBoundingClientRect();
    return {id,img:avatar.currentSrc,frame:frame.currentSrc,visible:inner.width>10 && inner.height>10 && getComputedStyle(avatar).opacity!=='0',
      centered:Math.abs(inner.x+inner.width/2-outer.x-outer.width/2)<2 && Math.abs(inner.y+inner.height/2-outer.y-outer.height/2)<2};
  })));
  const expected=await p.evaluate(()=>Sky.D.stages[0].enemies.map(id=>({id,src:new URL(Sky.art(id,'avatar'),document.baseURI).href,rarity:Sky.D.hero(id).rarity.toLowerCase()})));
  assert(enemies.every((e,i)=>e&&e.id===expected[i].id && e.img===expected[i].src && e.frame.endsWith('frame_'+expected[i].rarity+'.png') && e.visible && e.centered),'all six portraits must appear inside their own frames');
  await panel(p,'start-route',1).click();await waitPage(p,'battle');
  await recordMotion(p);const renderer=await inspectBattle(p,spec),frameStart=await status(p);
  await checkBleed(p,spec,'battle');
  assert.equal(renderer.textures,8);
  if(out && (spec.name==='desktop' || spec.mobile))await screenshot(p,spec,'battle');
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
  assert(motion.cuts.some(c=>c.hero==='h01' && c.duration>=800 && c.image.includes('lobby_cg_c07.png')));
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
      await inspectBattle(p,spec);await battle(p,'skip').click();
      await p.locator('.battle-result').waitFor();const s=await state(p);
      assert.equal(s.daily.battles,before.daily.battles+1);
      if(kind==='tower') assert.equal(s.tower,1);
      if(kind==='boss') assert(s.bossBest>0);
      if(kind==='arena') assert.equal(s.arenaWins,1);
      await battle(p,'return').click();
    }
  }
  await action(p,'home').click();
  const sorted=[...motion.drawTimes].sort((a,b)=>a-b);
  return {renderer,manualCutMs:Math.round(motion.cuts.find(c=>c.hero==='h01').duration),
    combatDurationSeconds:Math.round(motion.elapsed)/1000,presentedFPS,observedMedianBrowserFPS:Math.round(1000/sorted[Math.floor(sorted.length/2)]),
    segmentedDamageSample:increasing,distinctPositiveTotals:new Set(motion.totals.filter(v=>v>0)).size,completedNormally:!!spec.full};
}
async function run(browser,origin,spec) {
  const context=await browser.newContext({viewport:{width:spec.width,height:spec.height},deviceScaleFactor:spec.dpr,isMobile:!!spec.mobile,hasTouch:!!spec.mobile});
  const p=await context.newPage();p.setDefaultTimeout(9000);
  visualChecks.set(p,{});
  mobileEdges.set(p,{});
  wave2Checks.set(p,{artwork:{},contrast:{},masks:{}});
  const issues=[],failed=[];
  p.on('pageerror',e=>issues.push('page: '+e.message));
  p.on('console',m=>{if(m.type()==='error')issues.push('console: '+m.text());});
  p.on('response',r=>{if(r.status()>=400)issues.push('HTTP '+r.status()+' '+r.url());});
  p.on('request',r=>{
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
    const stage=await geometry(p,spec),images=await artwork(p,spec);
    await runLobby(p,spec);await runRoster(p,spec);await runGacha(p,spec);
    const combat=await runCampaign(p,spec);
    await runSaveDialog(p,spec);
    const before=await state(p);await p.reload();await p.waitForFunction(()=>window.Sky?.ui?.state);
    const after=await state(p);
    assert.deepEqual(after.formation,before.formation);assert.equal(after.cleared,before.cleared);
    assert.deepEqual(after.pity,before.pity);
    await exerciseLateGameArt(p,spec);
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
    assert.equal(Object.keys(wave2.artwork).length,6,'all six banners should appear');
    wave2.sha256=Object.fromEntries(Object.keys(wave2.artwork).map(src=>[src,sha(fs.readFileSync(path.join(root,src)))]));
    return {name:spec.name,stage,images,...combat,wave1ArtCount:visible.size,screenArt:screens,mobileEdgeSamples:mobileEdges.get(p),wave2,
      lateGameEvidence:'Imported test save, four UR items, level 1 vs tower 30. Real game resolution.',consoleErrorsAndHTTPFailures:issues.length};
  } catch(err) {
    const page=await p.evaluate(()=>({page:document.querySelector('#view')?.dataset.page,toast:document.querySelector('#toast')?.innerText,
      battle:window.Sky?.battlePage?.inspect()?.phase,head:document.body.innerText.slice(0,700)})).catch(()=>null);
    if(out) await screenshot(p,spec,'failure').catch(()=>{});
    throw new Error(spec.name+' '+err.message+'\n'+JSON.stringify({page,issues:[...new Set(issues)],failed:[...new Set(failed)]}));
  } finally {await context.close();}
}
async function replacementCheck(browser) {
  const parent=path.resolve(out||os.tmpdir());
  const temp=fs.mkdtempSync(path.join(parent,'sky_odyssey_art_test_'));
  let server;
  try {
    for(const part of ['index.html','js','css','assets','lib']) fs.cpSync(path.join(root,part),path.join(temp,part),{recursive:true});
    const files=[['chibi','chibi_'],['posters','lobby_cg_'],['avatars','avatar_']];
    const sizes={};
    for(const [folder,prefix] of files) {
      const original=fs.readFileSync(path.join(root,'assets',folder,prefix+'protag.png'));
      const destination=path.join(temp,'assets',folder,prefix+'h04.png');
      fs.writeFileSync(destination,original);
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
        await action(p,'roster').click();await panel(p,'hero','h04').click();
        const checkPicture=async(selector,dims,ending)=>{
          const a=await p.locator(selector).first().evaluate(async img=>{await img.decode();return [img.naturalWidth,img.naturalHeight,new URL(img.src).pathname];});
          assert.deepEqual(a.slice(0,2),dims);assert(a[2].endsWith(ending));
        };
        await checkPicture('.pn-portrait img',sizes.posters,'/lobby_cg_h04.png');
        await checkPicture('[data-panel="hero"][data-value="h04"] img.portrait',sizes.avatars,'/avatar_h04.png');
        await panel(p,'art','chibi').click();await checkPicture('.pn-portrait img',sizes.chibi,'/chibi_h04.png');
        await action(p,'home').click();await action(p,'campaign').click();await panel(p,'start-route',1).click();
        await p.waitForFunction(()=>Sky.battlePage.inspect()?.ready);
        const b=await status(p),source=b.positions.find(u=>u.key==='a0').source;
        if(mode==='file') {
          assert.equal(source,'native-image');
          await checkPicture('.battle-file-unit img[src$="chibi_h04.png"]',sizes.chibi,'/chibi_h04.png');
        } else {
          assert.equal(source,'pixi-texture');
          assert(b.textures.filter(t=>t.width===sizes.chibi[0]&&t.height===sizes.chibi[1]).length>=2);
        }
        await battle(p,'skip').click();await p.locator('.battle-result').waitFor();
        assert.equal((await state(p)).cleared,1);assert.deepEqual([...new Set(errors)],[]);
        result.push({mode,source,artworkSizes:sizes});
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
    const replacements=!selected || selected.split(',').includes('replacement');
    assert(chosen.length||replacements,'unknown --case');
    for(const spec of chosen) {
      const result=await run(browser,origin,spec);
      reports.push(result);console.log(JSON.stringify(result));
      if(out)fs.writeFileSync(path.join(out,spec.name+'-report.json'),JSON.stringify(result,null,2));
    }
    if(replacements)await replacementCheck(browser);
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
