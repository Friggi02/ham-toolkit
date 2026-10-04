/* Registra il service worker (sw.js nella radice del sito) da qualsiasi pagina. */
if ('serviceWorker' in navigator) {
  const sw = new URL('sw.js', document.currentScript.src);
  window.addEventListener('load', () => navigator.serviceWorker.register(sw).catch(() => {}));
}
