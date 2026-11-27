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
  window.addEventListener('resize',update);update();
  window.Sky.art.ready.then(()=>window.Sky.ui.boot());
})();
