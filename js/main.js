(() => {
  'use strict';
  const prompt=document.getElementById('orientation');
  let bypass=false;
  const update=()=>{
    const portrait=innerHeight>innerWidth && (navigator.maxTouchPoints>0||matchMedia('(pointer:coarse)').matches);
    if(!portrait)bypass=false;
    prompt.hidden=!(portrait&&!bypass);
  };
  document.getElementById('portrait-continue').addEventListener('click',()=>{bypass=true;update();});
  const stage=document.getElementById('stage'), bleed=document.getElementById('bleed');
  const alignBackdrop=()=>{
    const rect=stage.getBoundingClientRect();
    bleed.style.setProperty('--play-left',rect.left+'px');
    bleed.style.setProperty('--play-right',rect.right+'px');
  };
  new ResizeObserver(alignBackdrop).observe(stage);
  window.addEventListener('resize',alignBackdrop);
  window.addEventListener('resize',update);update();
  window.Sky.art.ready.then(()=>window.Sky.ui.boot());
})();
