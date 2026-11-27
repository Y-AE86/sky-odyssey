(() => {
  'use strict';
  const Sky = window.Sky;

  function preload(id,kind='lobby') {
    const src=kind==='ultimate' ? Sky.art.ultVideo(id) : Sky.art.video(id);
    if(!src)return null;
    const video=document.createElement('video');
    video.className='poster-video';
    video.setAttribute('aria-hidden','true');
    video.defaultMuted=video.muted=video.playsInline=true;
    video.preload='auto';
    video.poster=Sky.art(id,'poster');
    const videoFrames=typeof video.requestVideoFrameCallback==='function';
    let playback, frame, stallTimer, failed=false;

    function cancelFrame() {
      if(frame!==undefined){
        if(videoFrames)video.cancelVideoFrameCallback(frame);
        else cancelAnimationFrame(frame);
        frame=undefined;
      }
    }
    function conceal() {
      cancelFrame();
      clearTimeout(stallTimer);
      video.classList.remove('is-playing');
    }
    function stop() {
      conceal();
      playback=null;
      video.pause();
      video.remove();
    }
    function rewind() {
      stop();
      if(video.currentTime>0 && !video.error)video.currentTime=0;
    }
    function release() {
      stop();
      video.removeAttribute('src');
      video.removeAttribute('poster');
      video.load();
    }
    function fail(session) {
      if(playback!==session)return;
      stop();
      session?.onError?.();
    }
    function updateRate(){
      if(playback?.rate && Number.isFinite(video.duration) && video.duration>0)
        video.playbackRate=playback.rate(video.duration);
    }
    video.addEventListener('waiting',()=>{
      cancelFrame();
      if(!video.classList.contains('is-playing'))return;
      // Keep a buffered frame during a brief decoder or network pause.
      clearTimeout(stallTimer);
      stallTimer=setTimeout(conceal,250);
    });
    video.addEventListener('loadedmetadata',updateRate);
    video.addEventListener('ended',()=>playback?.onEnd?.());
    video.addEventListener('error',()=>{failed=true;fail(playback);});
    video.addEventListener('playing',()=>{
      clearTimeout(stallTimer);
      const session=playback;
      if(!session || video.classList.contains('is-playing'))return;
      cancelFrame();
      const reveal=()=>{
        frame=undefined;
        if(playback===session && session.target.isConnected && !video.paused && video.readyState>=video.HAVE_CURRENT_DATA){
          video.classList.add('is-playing');
          session.onFrame?.(video);
        }
      };
      frame=videoFrames ? video.requestVideoFrameCallback(reveal) : requestAnimationFrame(reveal);
    });
    video.src=src;
    // Start buffering even while the battle clip waits offscreen.
    video.load();

    return {
      get failed(){return failed;},
      get ready(){return !failed && !video.seeking && video.readyState>=video.HAVE_FUTURE_DATA;},
      play(target,options={}){
        if(failed){options.onError?.();return;}
        const session=playback={...options,target};
        video.muted=!options.audible;
        video.volume=options.volume ?? 1;
        updateRate();
        target.append(video);
        video.play().catch(error=>{
          if(playback!==session)return;
          if(!video.muted && error.name==='NotAllowedError'){
            video.muted=true;
            video.play().catch(()=>fail(session));
          }else fail(session);
        });
      },
      rewind,release
    };
  }
  Sky.posterVideo={preload};
})();
