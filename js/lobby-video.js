(() => {
  'use strict';
  const Sky=window.Sky;
  const blendMs=600;
  const stallMs=1500;

  function mount(layer,id){
    const src=Sky.art.video(id);
    if(!src)return null;
    const poster=Sky.art(id,'poster');
    const lifecycle=new AbortController();
    const signal=lifecycle.signal;
    const listen={signal};
    const decks=[document.createElement('video'),document.createElement('video')];
    let [active,standby]=decks;
    let monitorFrame,cancelPresentation,stallTimer,fade,overlapping=false;

    function release(){
      if(signal.aborted)return;
      lifecycle.abort();
      cancelAnimationFrame(monitorFrame);
      cancelPresentation?.();
      clearTimeout(stallTimer);
      fade?.cancel();
      for(const video of decks){
        video.pause();
        video.removeAttribute('src');
        video.removeAttribute('poster');
        video.load();
        video.remove();
      }
    }

    async function present(video,onFrame){
      try{await video.play();}
      catch{release();return;}
      if(signal.aborted)return;
      const ready=()=>{
        cancelPresentation=null;
        if(!signal.aborted)onFrame();
      };
      if(typeof video.requestVideoFrameCallback==='function'){
        const frame=video.requestVideoFrameCallback(ready);
        cancelPresentation=()=>video.cancelVideoFrameCallback(frame);
      }else{
        const frame=requestAnimationFrame(ready);
        cancelPresentation=()=>cancelAnimationFrame(frame);
      }
    }

    function overlap(){
      if(overlapping || signal.aborted || !active.classList.contains('is-playing'))return;
      overlapping=true;
      clearTimeout(stallTimer);
      stallTimer=setTimeout(release,stallMs);
      const incoming=standby;
      incoming.classList.add('is-loop-incoming');
      present(incoming,()=>{
        clearTimeout(stallTimer);
        // The opaque outgoing frame underneath gives a full cross-dissolve without showing the PNG.
        fade=incoming.animate([{opacity:0},{opacity:1}],{duration:blendMs,fill:'forwards'});
        fade.finished.then(()=>{
          if(signal.aborted)return;
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
      });
    }

    function monitor(){
      const left=active.duration-active.currentTime;
      if(!active.paused && left<=Math.min((blendMs+50)/1000,active.duration/2))overlap();
      monitorFrame=requestAnimationFrame(monitor);
    }

    for(const video of decks){
      video.className='poster-video lobby-video';
      video.setAttribute('aria-hidden','true');
      video.defaultMuted=video.muted=video.playsInline=true;
      video.preload='auto';
      video.poster=poster;
      video.addEventListener('error',release,listen);
      video.addEventListener('ended',()=>{if(video===active)overlap();},listen);
      video.addEventListener('waiting',()=>{
        if(video!==active || overlapping || !video.classList.contains('is-playing'))return;
        clearTimeout(stallTimer);
        stallTimer=setTimeout(release,stallMs);
      },listen);
      video.addEventListener('playing',()=>{if(video===active && !overlapping)clearTimeout(stallTimer);},listen);
    }
    layer.append(...decks);
    active.src=src;
    present(active,()=>{
      active.classList.add('is-playing','is-opening');
      standby.src=src;
      monitorFrame=requestAnimationFrame(monitor);
    });
    return {release};
  }

  Sky.lobbyVideo={mount};
})();
