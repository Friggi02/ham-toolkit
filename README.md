# 📡 Ham Toolkit

Strumenti web per radioamatori e ascoltatori. Funzionano anche **offline** e si installano sul telefono come app (PWA).

🔗 **Live:** https://friggi02.github.io/ham-toolkit/

| Strumento | Cosa fa |
|---|---|
| [Spettro radio](spettro/) | Lo spettro elettromagnetico da 1 Hz a 10²⁴ Hz su scala logaritmica, con le bande ITU, CEPT, PNRF e IARU e la fonte ufficiale di ogni banda. Dettagli in [`spettro/README.md`](spettro/README.md). |
| [Codici Q](codici-q/) | Codici Q e abbreviazioni CW con ricerca, flashcard nei due sensi e alfabeto fonetico con esercizio di spelling. |
| [Calcolatore dipolo](dipolo/) | Lunghezza dei bracci di un dipolo a mezz'onda, con preset per le bande radioamatoriali e per gli ascolti con l'RTL-SDR. |
| [Ruota sul ponte](ruota/) | Tiene l'ordine dei turni nella ruota sul ripetitore, con i nomi proposti da QRZ (XML API, serve un account). |

## Come è fatto

- HTML, CSS e JavaScript puro, nessun framework, nessuna build e nessuna dipendenza.
- Ogni strumento è una cartella con il suo `index.html`. La home (`index.html`) è solo l'indice.
- `sw.js` è il service worker: mette in cache tutto il sito alla prima visita e risponde dalla cache (stale-while-revalidate), quindi un aggiornamento si vede dalla visita successiva. Un nuovo strumento va aggiunto alla lista `FILES` in `sw.js`, alle `shortcuts` di `manifest.webmanifest` e alla home.
- `pwa.js` registra il service worker ed è incluso da tutte le pagine.
- Le impostazioni restano nel `localStorage` del browser. Nessun dato va a server, tranne le ricerche su QRZ se le attivi nella ruota.

## In locale

```bash
python -m http.server 8000
# poi apri http://localhost:8000
```

Pubblicato con GitHub Pages dal branch `main`, cartella radice.

> ⚠️ I dati sono a scopo divulgativo: per frequenze, potenze e modi ammessi fa fede la normativa citata nelle fonti.
