(() => {
  'use strict';
  const Sky=window.Sky;
  const blendMs=600;
  const stallMs=1500;
  const posterLeadMs=1000;

  function mount(layer,id){
    const src=Sky.art.video(id);
    if(!src)return null;
    const poster=layer.querySelector('.backdrop');
    const lifecycle=new AbortController();
    const signal=lifecycle.signal;
    const listen={signal};
    const decks=[document.createElement('video'),document.createElement('video')];
    let [active,standby]=decks;
    let monitorFrame,posterFrame,startTimer,cancelPresentation,stallTimer,fade;
    let presentation=0,overlapping=false,singleDeck=false;

    function unload(video){
      video.pause();
      if(video.hasAttribute('src')){
        video.removeAttribute('src');
        video.load();
      }
    }
    function release(){
      if(signal.aborted)return;
      lifecycle.abort();
      cancelAnimationFrame(monitorFrame);
      cancelAnimationFrame(posterFrame);
      cancelPresentation?.();
      clearTimeout(startTimer);
      clearTimeout(stallTimer);
      fade?.cancel();
      for(const video of decks){
        unload(video);
        video.remove();
      }
    }

    async function present(video,onFrame,onFailure){
      const token=++presentation;
      try{await video.play();}
      catch{
        if(!signal.aborted && presentation===token)onFailure();
        return;
      }
      if(signal.aborted || presentation!==token)return;
      const ready=()=>{
        cancelPresentation=null;
        if(!signal.aborted && presentation===token)onFrame();
      };
      if(typeof video.requestVideoFrameCallback==='function'){
        const frame=video.requestVideoFrameCallback(ready);
        cancelPresentation=()=>video.cancelVideoFrameCallback(frame);
      }else{
        const frame=requestAnimationFrame(ready);
        cancelPresentation=()=>cancelAnimationFrame(frame);
      }
    }

    function useSingleDeck(){
      if(singleDeck || signal.aborted)return;
      singleDeck=true;
      overlapping=false;
      presentation++;
      cancelPresentation?.();
      cancelPresentation=null;
      clearTimeout(stallTimer);
      fade?.cancel();
      fade=null;
      standby.classList.remove('is-loop-incoming');
      unload(standby);
      active.loop=true;
      if(active.ended){
        active.currentTime=0;
        active.play().catch(release);
      }
    }

    function overlap(){
      if(singleDeck || overlapping || signal.aborted || !active.classList.contains('is-playing'))return;
      if(!standby.hasAttribute('src')){useSingleDeck();return;}
      overlapping=true;
      clearTimeout(stallTimer);
      stallTimer=setTimeout(useSingleDeck,stallMs);
      const incoming=standby;
      incoming.classList.add('is-loop-incoming');
      present(incoming,()=>{
        clearTimeout(stallTimer);
        // The opaque outgoing frame underneath gives a full cross-dissolve without showing the PNG.
        fade=incoming.animate([{opacity:0},{opacity:1}],{duration:blendMs,fill:'forwards'});
        fade.finished.then(()=>{
          if(signal.aborted || singleDeck)return;
          const outgoing=active;
          active=incoming;
          standby=outgoing;
          active.classList.add('is-playing');
          outgoing.classList.remove('is-playing','is-opening');
          active.classList.remove('is-loop-incoming');
          fade.cancel();
          fade=null;
          outgoing.pause();
          outgoing.currentTime=0;
          overlapping=false;
        },()=>{});
      },useSingleDeck);
    }

    function bufferedAhead(){
      const time=active.currentTime;
      if(time<.8 || active.readyState<active.HAVE_FUTURE_DATA || !Number.isFinite(active.duration))return false;
      const target=Math.min(active.duration-.08,time+1.25);
      for(let i=0;i<active.buffered.length;i++)
        if(active.buffered.start(i)<=time && active.buffered.end(i)>=target)return true;
      return false;
    }
    function monitor(){
      if(signal.aborted || singleDeck)return;
      if(!standby.hasAttribute('src') && !document.hidden && !active.paused && bufferedAhead()){
        // iOS can request its own byte ranges for each element. Give the first
        // decoder a head start, then request only metadata for the spare deck.
        standby.preload='metadata';
        standby.src=src;
      }
      const left=active.duration-active.currentTime;
      if(!active.paused && left<=Math.min((blendMs+50)/1000,active.duration/2))overlap();
      monitorFrame=requestAnimationFrame(monitor);
    }

    for(const video of decks){
      video.className='poster-video lobby-video';
      video.setAttribute('aria-hidden','true');
      video.defaultMuted=video.muted=video.playsInline=true;
      video.preload='none';
      video.addEventListener('error',()=>{if(video===active)release();else useSingleDeck();},listen);
      video.addEventListener('ended',()=>{if(video===active)overlap();},listen);
      video.addEventListener('waiting',()=>{
        if(video!==active || overlapping || !video.classList.contains('is-playing'))return;
        clearTimeout(stallTimer);
        stallTimer=setTimeout(release,stallMs);
      },listen);
      video.addEventListener('playing',()=>{if(video===active && !overlapping)clearTimeout(stallTimer);},listen);
    }
    function open(){
      if(signal.aborted || !layer.isConnected)return;
      if(document.hidden){
        const whenVisible=()=>{
          if(document.hidden)return;
          document.removeEventListener('visibilitychange',whenVisible);
          open();
        };
        document.addEventListener('visibilitychange',whenVisible,listen);
        return;
      }
      layer.append(...decks);
      active.preload='auto';
      active.src=src;
      present(active,()=>{
        active.classList.add('is-playing','is-opening');
        monitorFrame=requestAnimationFrame(monitor);
      },release);
    }
    function afterPosterPaint(){
      if(signal.aborted)return;
      // Give the decoded still a paint opportunity before starting media I/O.
      posterFrame=requestAnimationFrame(()=>{
        posterFrame=requestAnimationFrame(()=>{startTimer=setTimeout(open,posterLeadMs);});
      });
    }
    function waitForImage(){
      if(signal.aborted)return;
      if(poster.complete){
        if(poster.naturalWidth)afterPosterPaint();
      }else poster.addEventListener('load',afterPosterPaint,{once:true,signal});
    }
    if(typeof poster.decode==='function')poster.decode().then(afterPosterPaint,waitForImage);
    else waitForImage();
    return {release};
  }

  Sky.lobbyVideo={mount};
})();
