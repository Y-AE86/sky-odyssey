(() => {
  'use strict';
  const Sky=window.Sky;
  let rendererLoad, activeScript, rendererPriority;
  function loadScript(src){
    return new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.fetchPriority=rendererPriority;
      script.src=src;
      script.onload=resolve;
      script.onerror=()=>{
        script.remove();
        reject(new Error('战台资源暂未载入'));
      };
      activeScript=script;
      document.head.append(script);
    });
  }
  Sky.battleRenderer={load(priority='high'){
    if(Sky.BattleScene)return Promise.resolve();
    if(rendererLoad){
      if(priority==='high'){
        rendererPriority=priority;
        if(activeScript)activeScript.fetchPriority=priority;
      }
      return rendererLoad;
    }
    rendererPriority=priority;
    rendererLoad=(async()=>{
      // Both classic scripts read PIXI during evaluation. Canvas2D is still
      // available if the library cannot initialize.
      if(!window.PIXI)await loadScript('lib/pixi.min.js').catch(()=>{});
      if(!Sky.BattleVfx)await loadScript('js/battle-vfx.js');
      await loadScript('js/battle-pixi.js');
      if(!Sky.BattleScene)throw new Error('战台资源暂未载入');
    })().catch(error=>{
      rendererLoad=null;
      throw error;
    }).finally(()=>{activeScript=null;});
    return rendererLoad;
  }};

  let warmTimer, warmIdle;
  function canWarm(){
    const connection=navigator.connection;
    return !document.hidden && !Sky.BattleScene && !rendererLoad && Sky.ui.root.dataset.page==='lobby' &&
      document.getElementById('overlay').hidden &&
      !Sky.ui.state?.settings.powerSave && !connection?.saveData && !/2g|3g/.test(connection?.effectiveType || '');
  }
  function scheduleWarm(event){
    if(!event.isTrusted || !canWarm())return;
    clearTimeout(warmTimer);
    if(warmIdle!==undefined)window.cancelIdleCallback(warmIdle);
    warmTimer=setTimeout(()=>{
      if(!canWarm())return;
      const load=()=>{
        warmIdle=undefined;
        if(canWarm())Sky.battleRenderer.load('low').catch(()=>{});
      };
      if(window.requestIdleCallback)warmIdle=window.requestIdleCallback(load);
      else load();
    },2000);
  }
  for(const type of ['pointerup','keydown'])document.addEventListener(type,scheduleWarm,{capture:true,passive:true});

  const prompt=document.getElementById('orientation');
  let bypass=false;
  const update=()=>{
    const portrait=innerHeight>innerWidth && (navigator.maxTouchPoints>0||matchMedia('(pointer:coarse)').matches);
    if(!portrait)bypass=false;
    prompt.hidden=!(portrait&&!bypass);
  };
  document.getElementById('portrait-continue').addEventListener('click',()=>{bypass=true;update();});
  const stage=document.getElementById('stage');
  const alignBackdrop=()=>{
    const rect=stage.getBoundingClientRect();
    // Insets include both the safe area and any space around the fitted 16:9 stage.
    const style=document.body.style;
    style.setProperty('--stage-left',rect.left+'px');
    style.setProperty('--stage-right',(innerWidth-rect.right)+'px');
    style.setProperty('--stage-top',rect.top+'px');
    style.setProperty('--stage-bottom',(innerHeight-rect.bottom)+'px');
  };
  // The inline status can paint while small external style sheets arrive.
  // Keep the underlying scene hidden until its own styles have settled.
  const styles=[...document.querySelectorAll('link[data-stage-css]')];
  function boot(){
    alignBackdrop();
    new ResizeObserver(alignBackdrop).observe(stage);
    window.addEventListener('resize',alignBackdrop);
    window.addEventListener('resize',update);update();
    Sky.ui.boot();
    document.getElementById('boot-loading').remove();
  }
  const waiting=styles.filter(link=>link.media==='print');
  if(!waiting.length)boot();
  else Promise.all(waiting.map(link=>new Promise(resolve=>{
    link.addEventListener('load',resolve,{once:true});
    link.addEventListener('error',resolve,{once:true});
  }))).then(boot);
})();
