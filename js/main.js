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
  alignBackdrop();
  new ResizeObserver(alignBackdrop).observe(stage);
  window.addEventListener('resize',alignBackdrop);
  window.addEventListener('resize',update);update();
  window.Sky.ui.boot();
})();
