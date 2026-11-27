(() => {
  'use strict';
  const Sky = window.Sky ||= {};
  let context;
  const notes = {tap:[622], collect:[523,659,784], summon:[330,494,659,988], hit:[164,110], ultimate:[220,330,554], win:[523,659,784,1046]};
  Sky.sound = (key = 'tap') => {
    if (!Sky.ui?.state.settings.sound || !window.AudioContext || !navigator.userActivation?.hasBeenActive) return;
    try {
      context ||= new AudioContext();
      if (context.state === 'suspended') context.resume().catch(() => {});
      const start = context.currentTime;
      (notes[key] || notes.tap).forEach((frequency, i) => {
        const t = start + i * .065;
        const oscillator = context.createOscillator(), gain = context.createGain();
        oscillator.type = key === 'hit' ? 'triangle' : 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(.0001,t);
        gain.gain.exponentialRampToValueAtTime(.047,t + .012);
        gain.gain.exponentialRampToValueAtTime(.0001,t + .24);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(t);
        oscillator.stop(t + .25);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      });
    } catch { /* Audio devices can disappear while a save is open. */ }
  };
})();
