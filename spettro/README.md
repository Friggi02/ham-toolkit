# 📡 Radio Spectrum Explorer

Visualizzatore interattivo dello **spettro elettromagnetico** su scala logaritmica, dalle frequenze radio (1 Hz) ai raggi gamma (10²⁴ Hz). Esplora le bande scorrendo e zoomando, con doppio righello **frequenza (Hz)** e **lunghezza d'onda (λ)**, e ogni banda cita la sua **fonte ufficiale**.

🔗 **Live:** https://friggi02.github.io/ham-toolkit/spettro/ (parte di [Ham Toolkit](../README.md))

## Caratteristiche

- **Scala logaritmica** 1 Hz → 10²⁴ Hz (24 ordini di grandezza su un'unica linea).
- **Doppio righello**: frequenza in alto, lunghezza d'onda in basso, entrambi aggiornati in tempo reale.
- **Navigazione**: rotella per scorrere in verticale, `Ctrl`+rotella per zoomare (centrato sul cursore), `Shift`+rotella o scroll orizzontale per scorrere le frequenze, trascinamento per spostarsi; più scrollbar trascinabili.
- **Touch**: un dito sposta frequenze e corsie, due dita fanno lo zoom a pizzico, un tocco apre i dettagli. Su schermi stretti la barra va su più righe e il pannello sale dal basso.
- **Frequenze singole**: le frequenze puntuali (chiamate, FT8, ISS, ADS-B, soccorso…) sono marcatori ● con linea verticale, visibili quando la banda che le contiene è abbastanza larga.
- **Filtri** per ente e per categoria, e per mostrare o nascondere le frequenze singole.
- **Link condivisibile**: la vista (zoom, banda selezionata, filtri) è sempre nell'URL (`#v=…&sel=…`), con un pulsante "Copia link" nel pannello.
- **Righello preciso**: allo zoom forte le tacche diventano lineari e il cursore mostra le cifre significative che servono.
- **Organizzazione per ente**: le bande sono raggruppate in **Fisica**, **Mondo (ITU)**, **Europa (CEPT/ECC)** e **Italia (PNRF)**, impacchettate in corsie automatiche senza sovrapposizioni.
- **Livelli di dettaglio**: le bande compaiono man mano che zoomi; la luce visibile è resa col suo gradiente reale.
- **Pannello dettagli**: cliccando una banda vedi intervallo, λ, categoria, scope, modo (CW/fonia/digitale per i radioamatori), note e **link alla fonte** (con indicazione se primaria o secondaria).

## Dati

Tutte le bande sono in [`bands.json`](bands.json), una lista piatta con gerarchia via campo `parent`. Ogni banda ha:

```json
{
  "id": "ham-40m-cw",
  "name": "40 m — CW",
  "from": 7000000, "to": 7040000,
  "category": "amateur",
  "scope": "europe",
  "mode": "cw",
  "parent": "ham-40m",
  "notes": "...",
  "source": { "url": "...", "title": "...", "authority": "IARU R1" },
  "sourceTier": "primary"
}
```

Le frequenze singole usano `freq` (Hz) al posto di `from`/`to`, e un `parent` che le contiene (da lì dipende quando compaiono):

```json
{ "id": "mk-iss-downlink", "name": "ISS fonia/SSTV", "freq": 145800000, "category": "amateur",
  "scope": "europe", "parent": "...", "notes": "...", "source": { ... }, "sourceTier": "primary" }
```

Le ~550 bande sono state raccolte da fonti ufficiali: **ITU Radio Regulations / ITU-R**, **CEPT/ECC**, **PNRF italiano (MIMIT)**, **band plan IARU Region 1**, oltre a fonti su GNSS, satelliti e fisica dello spettro. Dove non è stato possibile reperire il documento primario, la fonte è marcata `sourceTier: "secondary"`.

> ⚠️ I confini delle bande sono a scopo divulgativo: per usi operativi fare sempre riferimento ai documenti ufficiali citati.

## Come usarlo in locale

I browser bloccano `fetch` dei file via `file://`, quindi serve un piccolo server statico, lanciato dalla radice di Ham Toolkit:

```bash
python -m http.server 8000
# poi apri http://localhost:8000/spettro/
```

## Stack

HTML + CSS + JavaScript puro (nessun framework). Rendering su `<canvas>` 2D con hit-testing, packing a corsie e level-of-detail custom. Configurazione interamente da `bands.json`.

## Struttura

```
index.html    # markup e contenitori
style.css     # tema dark
app.js        # motore: scala log, zoom/pan, righelli, packing, pannello
bands.json    # dataset delle bande con fonti
```
