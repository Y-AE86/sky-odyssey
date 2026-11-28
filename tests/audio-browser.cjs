'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');

const root=path.resolve(__dirname,'..');
const args=process.argv.slice(2);
const option=(key,fallback)=>args.includes('--'+key)?args[args.indexOf('--'+key)+1]:fallback;
const out=path.resolve(option('out',path.join(root,'验收','音频系统接入')));
const chrome=option('chrome',process.env.CHROME_PATH);
const cases=option('case','http,file').split(',');
const key='sky_odyssey_save_v1';
const nav=(page,action)=>page.locator('[data-action="'+action+'"]').first();
const panel=(page,action,value)=>page.locator('[data-panel="'+action+'"]'+(value===undefined?'':'[data-value="'+value+'"]')).first();
const battle=(page,action)=>page.locator('[data-battle="'+action+'"]').first();
const approx=(actual,expected,delta,message)=>assert(Math.abs(actual-expected)<=delta,message+': '+actual+' vs '+expected);

function serve(){
  const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css',
    '.png':'image/png','.svg':'image/svg+xml','.mp4':'video/mp4','.mp3':'audio/mpeg','.ogg':'audio/ogg','.wav':'audio/wav'};
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)));
    const stat=file.startsWith(root+path.sep) && fs.statSync(file,{throwIfNoEntry:false});
    if(!stat || !stat.isFile()){res.writeHead(404).end();return;}
    const type=mime[path.extname(file)] || 'application/octet-stream';
    const headers={'Content-Type':type,'Content-Length':stat.size,'Accept-Ranges':'bytes'};
    const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    const start=match?Number(match[1]):0;
    const end=match && match[2]?Math.min(Number(match[2]),stat.size-1):stat.size-1;
    if(start>end){res.writeHead(416,{'Content-Range':'bytes */'+stat.size}).end();return;}
    if(match)Object.assign(headers,{'Content-Length':end-start+1,'Content-Range':'bytes '+start+'-'+end+'/'+stat.size});
    res.writeHead(match?206:200,headers);
    if(req.method==='HEAD'){res.end();return;}
    const stream=fs.createReadStream(file,{start,end});
    res.once('close',()=>stream.destroy());
    stream.pipe(res);
  });
  return new Promise((resolve,reject)=>{server.on('error',reject);server.listen(0,'127.0.0.1',()=>resolve(server));});
}

function installAudioProbe(){
  const audioProbe=window.audioProbe={cues:[],marks:{},curve:[],gains:[],compressors:0,starts:0,fetches:[],audios:[]};
  const nativeAudio=window.Audio;
  window.Audio=new Proxy(nativeAudio,{construct(target,args){
    const audio=Reflect.construct(target,args);
    audioProbe.audios.push(audio);
    return audio;
  }});
  const audioClass=window.AudioContext || window.webkitAudioContext;
  const makeCompressor=audioClass.prototype.createDynamicsCompressor;
  audioClass.prototype.createDynamicsCompressor=function(...args){
    audioProbe.compressors++;
    return makeCompressor.apply(this,args);
  };
  const makeOsc=audioClass.prototype.createOscillator;
  audioClass.prototype.createOscillator=function(...args){
    const oscillator=makeOsc.apply(this,args),start=oscillator.start;
    oscillator.start=function(...args){
      audioProbe.starts++;
      return start.apply(this,args);
    };
    return oscillator;
  };
  const fetchOriginal=window.fetch;
  window.fetch=function(input,...args){
    audioProbe.fetches.push(typeof input==='string'?input:input.url);
    return fetchOriginal.call(this,input,...args);
  };
  const nativeVolume=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'volume');
  Object.defineProperty(HTMLMediaElement.prototype,'volume',{...nativeVolume,set(value){
    nativeVolume.set.call(this,value);
    const id=/\/bgm_(battle|lobby)\.mp3$/.exec(this.src)?.[1];
    if(id)audioProbe.gains.push({t:performance.now(),id,value});
  }});
  const onLifecycle=()=>{
    if(document.visibilityState==='hidden')audioProbe.nativeHidden=true;
  };
  document.addEventListener('visibilitychange',onLifecycle);
  audioProbe.snapshot=()=>{
    const state=Sky.audio.inspect(),here=new URL(document.baseURI);
    const nativeTrack=id=>{
      const element=audioProbe.audios.find(el=>el.src.endsWith('/bgm_'+id+'.mp3'));
      return element?{volume:element.volume,paused:element.paused,position:element.currentTime,ready:element.readyState,
        bytes:element.webkitAudioDecodedByteCount,loop:element.loop,src:new URL(element.src,here).pathname.split('/').pop()}:null;
    };
    return {time:performance.now(),scene:state.scene,ducked:state.ducked,unlocked:state.unlocked,lobby:nativeTrack('lobby'),battle:nativeTrack('battle')};
  };
  function recordVolume(state){
    audioProbe.curve.push({t:state.time,l:state.lobby?.volume,b:state.battle?.volume,d:!!state.ducked});
  }
  audioProbe.mark=name=>{
    const state=audioProbe.snapshot();
    audioProbe.marks[name]=state.time;
    // Include the exact observed boundary even if the next draw arrives later.
    recordVolume(state);
  };
  function sample(){
    if(window.Sky?.audio?.inspect)recordVolume(audioProbe.snapshot());
    requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);
}
async function snapshot(page){return page.evaluate(()=>audioProbe.snapshot());}
async function mark(page,name){await page.evaluate(name=>audioProbe.mark(name),name);}
async function waitTrack(page,id){
  await page.waitForFunction(id=>{
    const t=audioProbe.snapshot()[id];
    return t && !t.paused && t.ready>=2 && t.position>.15 && t.bytes>0 && t.loop;
  },id,{timeout:9000});
  const track=(await snapshot(page))[id];
  assert.equal(track.src,'bgm_'+id+'.mp3');
  return track;
}
async function waitVolume(page,id,target){
  await page.waitForFunction(({id,target})=>Math.abs(audioProbe.snapshot()[id]?.volume-target)<.004,{id,target},{timeout:4000});
}
async function exerciseVisibility(page){
  const cdp=await page.context().newCDPSession(page);
  let native=false;
  try{
    await cdp.send('Page.setWebLifecycleState',{state:'frozen'});
    await cdp.send('Page.setWebLifecycleState',{state:'active'});
    native=await page.evaluate(()=>audioProbe.nativeHidden || false);
  }finally{await cdp.detach();}
  // The headless browser can expose a frozen page without a visibility transition.
  // Make both events observable with real media pause/resume and explicitly record that fallback.
  await page.evaluate(()=>{
    Object.defineProperty(document,'hidden',{configurable:true,value:true});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(()=>audioProbe.snapshot().lobby.paused);
  const paused=(await snapshot(page)).lobby.position;
  await page.waitForTimeout(175);
  approx((await snapshot(page)).lobby.position,paused,.035,'background position should stop advancing');
  await page.evaluate(()=>{
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(position=>{const track=audioProbe.snapshot().lobby;return !track.paused && track.position>position+.04;},paused);
  const resumed=(await snapshot(page)).lobby.position;
  return {nativeLifecycleVisibility:native,eventDriven:true,paused,resumed};
}

async function exerciseInterface(page,name){
  await nav(page,'settings').click();
  const dialog=page.getByRole('dialog',{name:'航行设置'});
  await dialog.waitFor();
  const credit=dialog.getByRole('link',{name:/PeriTune/i});
  assert.equal(new URL(await credit.getAttribute('href')).hostname.replace(/^www\./,''),'peritune.com');
  const settings=await dialog.innerText();
  assert(/部分战斗配乐来源：PeriTune/.test(settings));
  await page.screenshot({path:path.join(out,name+'-settings.png')});
  await nav(page,'music').click();
  await page.waitForFunction(()=>audioProbe.snapshot().lobby.paused);
  assert.equal(await page.evaluate(()=>Sky.ui.state.settings.sound),true);
  await nav(page,'music').click();
  await waitTrack(page,'lobby');
  const music=dialog.locator('[data-audio-volume="musicVolume"]');
  const sound=dialog.locator('[data-audio-volume="soundVolume"]');
  await music.focus();
  await page.keyboard.press('End');
  await sound.focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  const volumes=await page.evaluate(()=>({music:Sky.ui.state.settings.musicVolume,sound:Sky.ui.state.settings.soundVolume}));
  assert.equal(volumes.music,1);
  assert(volumes.sound>0 && volumes.sound<.82);
  await music.focus();
  await page.keyboard.press('Home');
  await sound.focus();
  await page.keyboard.press('End');
  await music.evaluate(el=>{
    const max=Number(el.max || 100),min=Number(el.min || 0);
    el.value=String(min+(max-min)*.46);
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await nav(page,'close').click();
  await nav(page,'idle').click();
  await nav(page,'claim-idle').click();
  if(await dialog.isVisible())await nav(page,'close').click();
  await nav(page,'roster').click();
  await panel(page,'upgrade').click();
  await panel(page,'roster-tab',1).click();
  await nav(page,'home').click();
  await nav(page,'gacha').click();
  await panel(page,'draw',10).click();
  await page.getByRole('dialog',{name:'召唤结果'}).waitFor();
  await page.keyboard.press('Escape');
  await nav(page,'home').click();
  return volumes;
}

async function arrangeBattle(page,trace=true){
  await page.evaluate(()=>{
    const create=Sky.Battle.create;
    const testParty=['h01','h02','h03','h04','h05','h06'];
    Sky.ui.state.owned=Sky.D.heroes.map(hero=>hero.id);
    Sky.ui.state.formation=testParty;
    Sky.Battle.create=(save,spec)=>{
      Sky.Battle.create=create;
      let seed=72;
      const rng=()=>((seed=(Math.imul(1664525,seed)+1013904223)>>>0)/4294967296);
      const fight=create(save,spec,rng);
      for(const unit of fight.units){
        unit.maxHp=Math.max(4500,unit.maxHp);
        unit.hp=unit.side==='ally'?3300:unit.maxHp;
        if(unit.side==='ally')unit.rage=100;
      }
      return fight;
    };
  });
  await nav(page,'trials').click();
  await panel(page,'trial','boss').click();
  if(trace)await mark(page,'outbound');
  await panel(page,'start-trial','boss').click();
  await battle(page,'auto').click();
  await page.waitForFunction(()=>Sky.battlePage.inspect().ready);
}
async function cut(page,slot,id,mode,musicVolume){
  const muted=mode==='muted';
  const clip=page.locator('.battle-cutin[data-hero="'+id+'"]');
  await mark(page,mode+'-start');
  await page.locator('[data-cast="'+slot+'"]:enabled').click();
  await clip.waitFor({timeout:15000});
  const video=clip.locator('video');
  await page.waitForFunction(({id,muted})=>{
    const el=document.querySelector('.battle-cutin[data-hero="'+id+'"] video');
    return el && el.currentTime>.13 && !el.paused && el.muted===muted && (muted || el.webkitAudioDecodedByteCount>0);
  },{id,muted},{timeout:10000});
  const decoded=await video.evaluate(el=>({file:el.src.split('/').pop(),bytes:el.webkitAudioDecodedByteCount,muted:el.muted,duration:el.duration}));
  assert.equal(decoded.file,'ult_'+id+'.mp4');
  assert(decoded.duration>2.8 && decoded.duration<3.3);
  if(muted){
    assert.equal((await snapshot(page)).ducked,false);
    approx((await snapshot(page)).battle.volume,musicVolume,.02,'silent cut keeps the original BGM gain');
  }else{
    await page.waitForFunction(()=>audioProbe.snapshot().ducked);
    await waitVolume(page,'battle',musicVolume*.22);
    const reduced=(await snapshot(page)).battle.volume/musicVolume;
    assert(reduced>.20 && reduced<.24);
    assert(decoded.bytes>0);
  }
  await mark(page,mode+'-exit');
  if(mode!=='natural')await clip.locator('.battle-cut-skip').click();
  await clip.waitFor({state:'detached',timeout:4500});
  await waitVolume(page,'battle',musicVolume);
  assert.equal((await snapshot(page)).ducked,false);
  await mark(page,mode+'-done');
  return decoded;
}
function analyzeCurves({curve,marks,gains},base){
  const window=(a,b)=>curve.filter(row=>row.t>=marks[a] && row.t<=marks[b]);
  function fade(a,b,from,to){
    const frames=window(a,b);
    const dual=frames.filter(row=>row[from]>.02 && row[to]>.02);
    assert(dual.length>=5,'crossfade should contain multiple simultaneous native gain samples');
    assert(dual[0][from]>dual.at(-1)[from] && dual[0][to]<dual.at(-1)[to],'gains move in opposite directions');
    const ms=dual.at(-1).t-dual[0].t;
    assert(ms>=440 && ms<=1200,'crossfade should progress over about 0.65 seconds: '+ms);
    const writes=gains.filter(row=>row.id===(to==='l'?'lobby':'battle') && row.t>=marks[a] && row.t<=marks[b]);
    const peakStep=Math.max(...writes.map((row,i)=>i?Math.abs(row.value-writes[i-1].value):0));
    assert(writes.length>=5 && peakStep<=base*.085,'no audible abrupt jump from a delayed paint: '+peakStep);
    const changes=writes.filter((row,i)=>i && row.value>writes[i-1].value);
    const actualRampMs=Math.round(changes.at(-1).t-changes[0].t);
    return {overlapMs:ms,actualRampMs,maxAbsoluteStep:peakStep,first:dual[0],last:dual.at(-1),samples:dual.length};
  }
  function duck(mode){
    const frames=window(mode+'-start',mode+'-done');
    const start=frames.findIndex(row=>row.d);
    const end=frames.findLastIndex(row=>row.d)+1;
    assert(start>=0 && end<frames.length);
    const low=frames.findIndex((row,i)=>i>=start && row.b/base<.24);
    const recovered=frames.findIndex((row,i)=>i>=end && row.b/base>.98);
    assert(low>start && recovered>end);
    // The threshold can be crossed any time before the first frame that observes it.
    const sampleDelay=at=>Math.max(0,frames[at].t-frames[at-1].t-50);
    const down=frames[low].t-frames[start].t, up=frames[recovered].t-frames[end].t;
    const samplingGap={down:sampleDelay(low),up:sampleDelay(recovered)};
    assert(down>=90 && down<=320+samplingGap.down,'duck ramp should approximate 0.2s: '+down);
    assert(up>=225 && up<=560+samplingGap.up,'recovery ramp should approximate 0.4s: '+up);
    approx(Math.min(...frames.map(row=>row.b/base)),.22,.02,'the lowest BGM gain should be 22%');
    return {downMs:down,upMs:up,samplingGap,minGain:Math.min(...frames.map(row=>row.b/base))};
  }
  const muted=window('muted-start','muted-done');
  assert(muted.length && muted.every(row=>!row.d && Math.abs(row.b-base)<.015),'muted cut never ducks music');
  return {outbound:fade('outbound','battle-stable','l','b'),inbound:fade('inbound','lobby-stable','b','l'),
    natural:duck('natural'),skipped:duck('skipped'),mutedFrames:muted.length};
}

async function run(browser,url,name){
  const context=await browser.newContext({viewport:{width:1280,height:720}});
  const page=await context.newPage();
  const errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  page.on('response',response=>{if(response.status()>=400)errors.push(response.status()+' '+response.url());});
  page.on('requestfailed',request=>{if(!request.failure()?.errorText.endsWith('ERR_ABORTED'))errors.push(request.failure()?.errorText+' '+request.url());});
  page.on('request',request=>requests.push(request.url()));
  try{
    await page.addInitScript(installAudioProbe);
    await page.goto(url);
    const mute=nav(page,'audio-mute');
    await mute.waitFor();
    await page.evaluate(()=>{
      const sound=Sky.sound;
      Sky.sound=(name,...args)=>{audioProbe.cues.push({name,t:performance.now()});return sound(name,...args);};
    });
    const initial=await snapshot(page);
    assert.equal(initial.unlocked,false);
    assert(!initial.lobby || initial.lobby.paused);
    if(name==='file')await page.keyboard.press('Space');
    else await page.mouse.click(390,365);
    const lobby=await waitTrack(page,'lobby');
    await waitVolume(page,'lobby',await page.evaluate(()=>Sky.ui.state.settings.musicVolume));
    await page.waitForFunction(()=>[...document.querySelectorAll('.lobby-media video')].some(v=>v.muted && !v.paused && v.currentTime>.05));
    const visibility=await exerciseVisibility(page);
    const volumeKeyboard=await exerciseInterface(page,name);
    const gain=await page.evaluate(()=>Sky.ui.state.settings.musicVolume);
    await waitVolume(page,'lobby',gain);
    await arrangeBattle(page);
    const battleTrack=await waitTrack(page,'battle');
    await waitVolume(page,'battle',gain);
    await page.waitForFunction(()=>audioProbe.snapshot().lobby.paused);
    await mark(page,'battle-stable');
    await page.screenshot({path:path.join(out,name+'-battle-control.png')});
    const natural=await cut(page,0,'h01','natural',gain);
    const skipped=await cut(page,2,'h03','skipped',gain);
    await cut(page,3,'h04','shield',gain);
    const expectedBattle=['slash','cast','hit','crit','heal','shield','ult_start'];
    await page.waitForFunction(expected=>expected.every(cue=>audioProbe.cues.some(entry=>entry.name===cue)),expectedBattle,{timeout:14000});
    await battle(page,'skip').click();
    await page.locator('.battle-result').waitFor();
    await mark(page,'inbound');
    await battle(page,'return').click();
    await waitTrack(page,'lobby');
    await waitVolume(page,'lobby',gain);
    await page.waitForFunction(()=>audioProbe.snapshot().battle.paused);
    await mark(page,'lobby-stable');
    await nav(page,'home').click();
    await nav(page,'settings').click();
    await nav(page,'sound').click();
    assert.equal(await page.evaluate(()=>Sky.ui.state.settings.sound),false);
    await nav(page,'close').click();
    await arrangeBattle(page,false);
    await waitVolume(page,'battle',gain);
    const muted=await cut(page,0,'h01','muted',gain);
    await mute.click();
    assert.equal(await mute.getAttribute('aria-pressed'),'false');
    await waitVolume(page,'battle',0);
    await page.waitForFunction(()=>audioProbe.snapshot().battle.paused);
    await battle(page,'skip').click();
    await page.locator('.battle-result').waitFor();
    await battle(page,'return').click();
    const beforeReload=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).settings,key);
    assert.equal(beforeReload.sound,false);
    assert.equal(beforeReload.muted,true);
    assert.equal(beforeReload.music,true);
    approx(beforeReload.musicVolume,.46,.011,'music volume is durable');
    assert.equal(beforeReload.soundVolume,1);
    const probe=await page.evaluate(()=>({cues:audioProbe.cues,marks:audioProbe.marks,curve:audioProbe.curve,gains:audioProbe.gains,
      compressors:audioProbe.compressors,starts:audioProbe.starts,recent:Sky.audio.inspect().effects.recent,fetches:audioProbe.fetches}));
    assert.equal(probe.compressors,1);
    assert(probe.starts>25);
    const uniqueCues=[...new Set(probe.cues.map(entry=>entry.name))].sort();
    for(const name of ['tap','tab','back','collect','upgrade','summon',...expectedBattle])assert(uniqueCues.includes(name),'missing cue '+name);
    assert(!probe.fetches.some(src=>/\.mp3(?:$|\?)/i.test(src || '')),'native music does not fetch/decode MP3 through Web Audio');
    assert(probe.recent.every(sfx=>sfx.pitch>=.95 && sfx.pitch<=1.05));
    assert(new Set(probe.recent.map(sfx=>sfx.pitch)).size>10);
    fs.writeFileSync(path.join(out,name+'-timeline.json'),JSON.stringify({marks:probe.marks,curve:probe.curve,volume:probe.gains,cues:probe.cues},null,2));
    const curves=analyzeCurves(probe,gain);
    await page.reload();
    await mute.waitFor();
    const afterReload=await page.evaluate(()=>Sky.ui.state.settings);
    assert.deepEqual(afterReload,beforeReload);
    assert.equal(await mute.getAttribute('aria-pressed'),'false');
    await mute.click();
    await waitTrack(page,'lobby');
    await waitVolume(page,'lobby',gain);
    assert.equal(await mute.getAttribute('aria-pressed'),'true');
    assert.equal(await page.evaluate(()=>Sky.ui.state.settings.sound),false);
    assert.equal(requests.filter(url=>name==='file' && /^https?:/i.test(url)).length,0,'offline page should not request HTTP resources');
    assert.deepEqual(errors,[]);
    const summary={name,activation:name==='file'?'trusted keydown':'trusted pointer',lobby,battle:battleTrack,visibility,volumeKeyboard,
      videos:{natural,skipped,muted},curves,compressors:probe.compressors,oscillatorStarts:probe.starts,cues:uniqueCues,beforeReload,errors};
    fs.writeFileSync(path.join(out,name+'-report.json'),JSON.stringify(summary,null,2));
    console.log(name+' '+JSON.stringify({curves,cues:uniqueCues,oscillatorStarts:probe.starts,errors}));
  }catch(error){
    console.error(name+' failed',await page.evaluate(()=>({probe:window.audioProbe?.snapshot?.(),cues:window.audioProbe?.cues?.slice(-20)})).catch(()=>null),errors);
    throw error;
  }finally{await context.close();}
}

(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const server=await serve();
  let browser;
  try{
    browser=await chromium.launch({headless:true,executablePath:chrome,args:['--mute-audio','--autoplay-policy=user-gesture-required']});
    for(const entry of cases){
      assert(['http','file'].includes(entry),'unknown case '+entry);
      const url=entry==='file'?pathToFileURL(path.join(root,'index.html')).href:'http://127.0.0.1:'+server.address().port+'/';
      await run(browser,url,entry);
    }
  }finally{
    await browser?.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
