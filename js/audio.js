(() => {
  'use strict';
  const Sky=window.Sky;
  const manifest=Sky.audioManifest || {};
  const effects=Sky.createEffects(manifest);
  const crossfadeMs=650;
  const tracks=new Map();
  const duck={value:1,to:1};
  let settings={}, scene='lobby', unlocked=false, ducked=false, frame=0;
  let mixClock=0, lastMixFrame=0;
  const level=value=>Math.max(0,Math.min(1,value));
  const musicVolume=()=>settings.musicVolume ?? .46;
  const voiceVolume=()=>settings.sound!==false && !settings.muted ? settings.soundVolume ?? .82 : 0;
  const canPlay=()=>unlocked && !document.hidden && !settings.muted && settings.music!==false && musicVolume()>0;

  // Separate the two track fades from the voice fade so either can be reversed
  // from its current gain without interrupting the other envelope.
  function sample(fade,now) {
    if(fade.value===fade.to)return fade.value;
    const t=level((now-fade.start)/fade.ms);
    fade.value=t===1 ? fade.to : fade.from+(fade.to-fade.from)*t;
    return fade.value;
  }
  function ramp(fade,to,ms,now) {
    if(fade.to===to)return;
    fade.from=sample(fade,now);
    fade.to=to; fade.start=now; fade.ms=ms;
  }
  function silence(track) {
    track.pending=null;
    track.media.pause();
    track.media.volume=0;
    track.mix.value=track.mix.to=0;
  }
  function draw(now) {
    frame=0;
    if(!canPlay())return;
    // Native audio still plays when map and texture decoding briefly blocks the
    // main thread. Limit each scene-mix step so the next frame cannot jump in volume.
    mixClock+=Math.min(48,Math.max(0,now-lastMixFrame));
    lastMixFrame=Math.max(now,lastMixFrame);
    const speech=sample(duck,now);
    let moving=speech!==duck.to;
    for(const track of tracks.values()){
      const mix=sample(track.mix,mixClock);
      track.media.volume=level(musicVolume()*mix*(track.id==='battle'?speech:1));
      if(mix!==track.mix.to)moving=true;
      else if(!mix && !track.pending && !track.media.paused)track.media.pause();
    }
    if(moving)frame=requestAnimationFrame(draw);
  }
  function refresh() {
    if(frame)cancelAnimationFrame(frame);
    draw(performance.now());
  }
  function crossfade(id,ms) {
    lastMixFrame=performance.now();
    for(const track of tracks.values())ramp(track.mix,Number(track.id===id),ms,mixClock);
    refresh();
  }
  function trackFor(id) {
    const src=manifest['bgm_'+id];
    if(!src)return null;
    if(!tracks.has(id)){
      const media=new Audio();
      media.loop=true; media.preload='none'; media.volume=0;
      const track={id,media,mix:{value:0,to:0},pending:null,failed:false};
      tracks.set(id,track);
      media.addEventListener('error',()=>{
        track.failed=true;
        silence(track);
        if(scene===id && canPlay())crossfade(null,crossfadeMs);
      });
      media.src=src;
    }
    return tracks.get(id);
  }
  function updateMusic(ms=crossfadeMs) {
    if(!canPlay()){
      if(frame)cancelAnimationFrame(frame);
      frame=0;
      for(const track of tracks.values())silence(track);
      return;
    }
    const track=trackFor(scene);
    if(!track || track.failed){crossfade(null,ms);return;}
    if(track.pending)return;
    if(!track.media.paused){crossfade(track.id,ms);return;}
    const request={};
    track.pending=request;
    // Call play in this stack so the first gesture grants playback immediately.
    track.media.play().then(()=>{
      if(track.pending!==request)return;
      track.pending=null;
      if(canPlay() && scene===track.id)crossfade(track.id,ms);
      else silence(track);
    },()=>{
      if(track.pending!==request)return;
      track.pending=null;
      refresh();
    });
  }
  function configure(next) {
    const wasSilent=voiceVolume()===0;
    settings={...next};
    const voice=voiceVolume();
    effects.configure({enabled:!document.hidden && voice>0,volume:voice});
    if(voice===0)setDucking(false);
    else if(unlocked && wasSilent)effects.unlock();
    updateMusic();
  }
  function setScene(page) {
    const next=page==='battle'?'battle':'lobby';
    if(scene===next)return;
    scene=next;
    if(next!=='battle')setDucking(false);
    updateMusic();
  }
  function setDucking(on) {
    const target=!!on && scene==='battle' && voiceVolume()>0;
    if(ducked===target)return;
    ducked=target;
    ramp(duck,target?.22:1,target?200:400,performance.now());
    refresh();
  }
  function unlock(event) {
    if(!event.isTrusted || document.hidden || (event.type==='pointerdown' && event.pointerType==='touch'))return;
    // Pointerup and click cover WebKit's touch activation, so assigning the media
    // source and calling play still happen in a trusted input stack.
    if(navigator.userActivation && !navigator.userActivation.hasBeenActive)return;
    if(!unlocked && Sky.ui?.state?.settings)configure(Sky.ui.state.settings);
    unlocked=true;
    effects.unlock();
    updateMusic();
  }
  for(const type of ['pointerdown','pointerup','click','keydown'])document.addEventListener(type,unlock,{capture:true,passive:true});
  document.addEventListener('visibilitychange',()=>{
    effects.configure({enabled:!document.hidden && voiceVolume()>0,volume:voiceVolume()});
    if(unlocked && !document.hidden)effects.unlock();
    updateMusic(240);
  });

  Sky.sound=(key='tap')=>{if(unlocked && !document.hidden)effects.play(key);};
  Sky.audio={configure,scene:setScene,duck:setDucking,voiceVolume,inspect(){
    return {scene,unlocked,ducked,tracks:Object.fromEntries([...tracks].map(([id,{media}])=>[id,{
      volume:media.volume,paused:media.paused,currentTime:media.currentTime,readyState:media.readyState,
      decodedBytes:media.webkitAudioDecodedByteCount,loop:media.loop,src:media.currentSrc || media.src
    }])),effects:effects.inspect()};
  }};
})();
