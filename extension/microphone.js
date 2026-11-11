// Observe track lifecycle only. Never read, copy, store or upload any audio.
(() => {
  const media = navigator.mediaDevices;
  if (!media?.getUserMedia) return;
  const original = media.getUserMedia.bind(media), tracks = new Set();
  const report = () => window.postMessage({source:'tingwu-class-mic', active:[...tracks].some(t => t.readyState === 'live')}, location.origin);
  media.getUserMedia = async (...args) => {
    const stream = await original(...args);
    stream.getAudioTracks().forEach(t => { tracks.add(t); t.addEventListener('ended', () => { tracks.delete(t); report(); }); });
    report(); return stream;
  };
  // Track.stop() does not dispatch ended; periodic checks cover manual stop.
  setInterval(report, 1500);
})();
