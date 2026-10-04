// sdr.js — Innesto "Ascolto con RTL-SDR + SDR++"
// Modulo autonomo: espone window.SDR.renderBlock(band) -> stringa HTML (o '' se non pertinente).
// Le frequenze delle bande arrivano in Hz (b.from, b.to).

(function () {
  'use strict';

  // ---- Portata tipica di un RTL-SDR (Blog v3/v4) ----
  const RX_MIN_HZ = 500e3;      // con Direct Sampling (Q branch)
  const RX_MAX_HZ = 1.766e9;    // limite superiore del tuner R820T/R828D
  const DIRECT_SAMPLING_HZ = 24e6; // sotto ~24 MHz serve Direct Sampling

  // ---- Kit dipolo RTL-SDR Blog (cm) ----
  const LONG_MIN = 23, LONG_MAX = 100;   // elemento lungo
  const SHORT_MIN = 5, SHORT_MAX = 13;   // elemento corto

  const MODE_DESC = {
    WFM: 'WFM (FM larga)', AM: 'AM', NFM: 'NFM (FM stretta)',
    USB: 'USB', LSB: 'LSB', CW: 'CW (Morse)', DIGITAL: '— (digitale)'
  };

  // ---- Modo di demodulazione + bandwidth in base a frequenza (MHz) e categoria ----
  function receiveSettings(mhz, b) {
    const cat = b.category || '';
    const R = (mode, bw, extra) => Object.assign({ mode, bw }, extra || {});

    // Digitale: cellulare, DAB/DVB, ADS-B, satelliti dati
    if (Math.abs(mhz - 1090) < 0.6) return R('DIGITAL', null, { decoder: 'ADS-B (dump1090 / tar1090)' });
    if (mhz >= 174 && mhz <= 240) return R('DIGITAL', null, { decoder: 'DAB+ / DVB-T (welle.io, non audio)' });
    if (cat === 'mobile' && mhz >= 700) return R('DIGITAL', null, { decoder: 'cellulare (cifrato, solo spettro)' });

    // Onde lunghe / medie broadcast
    if (mhz < 1.8) return R('AM', 9);

    // HF 1.8–30 MHz
    if (mhz < 30) {
      if (cat === 'amateur') return R(mhz < 10 ? 'LSB' : 'USB', 2.7, { hint: 'parti CW/dati in CW ~500 Hz' });
      return R('AM', 9); // onde corte broadcast, CB, utility
    }

    // VHF/UHF
    if (mhz >= 87.5 && mhz <= 108) return R('WFM', 200);                 // FM commerciale
    if (mhz >= 108 && mhz < 137) return R('AM', 12);                     // aeronautico (nav + voce)
    if (mhz >= 137 && mhz < 138) return R('WFM', 40, { decoder: 'satelliti NOAA APT (SatDump)' });
    if (mhz >= 144 && mhz < 144.4) return R('USB', 2.7);                 // 2m SSB
    if (mhz >= 156 && mhz <= 162.05) return R('NFM', 12.5);             // nautica VHF
    if (cat === 'amateur' && mhz >= 50 && mhz < 54) return R('USB', 2.7); // 6m

    // Default VHF/UHF: fonia FM a banda stretta
    return R('NFM', 12.5);
  }

  // ---- Regolazione del dipolo ----
  function antenna(mhz) {
    const lambda = 300 / mhz;      // metri
    const legCm = 7500 / mhz;      // quarto d'onda per braccio (cm)
    let element, extend, note = null, level = 'ok';

    if (legCm > LONG_MAX) {
      element = 'Elemento LUNGO (comunque corto per la banda)';
      extend = 'Estendi al massimo (~100 cm)';
      if (mhz < 30) {
        level = 'danger';
        note = 'Sotto i ~30 MHz il dipolo del kit è troppo corto: per le HF conviene un filo lungo (long wire) o un’antenna dedicata.';
      } else {
        level = 'warn';
        note = 'Frequenza bassa per il kit: efficienza ridotta, ma la ricezione resta possibile.';
      }
    } else if (legCm >= LONG_MIN) {
      element = 'Elemento LUNGO';
      const pct = Math.round((legCm - LONG_MIN) / (LONG_MAX - LONG_MIN) * 100);
      extend = `Estendi a ${legCm.toFixed(1)} cm (~${pct}% della corsa)`;
    } else if (legCm > SHORT_MAX) {
      element = 'Elemento CORTO, tutto esteso';
      extend = `Ideale ${legCm.toFixed(1)} cm → usa il corto a ${SHORT_MAX} cm (va bene lo stesso)`;
      level = 'warn';
      note = 'Zona di passaggio fra i due elementi: nessuno è perfetto, il corto tutto esteso è la scelta migliore.';
    } else if (legCm >= SHORT_MIN) {
      element = 'Elemento CORTO';
      const pct = Math.round((legCm - SHORT_MIN) / (SHORT_MAX - SHORT_MIN) * 100);
      extend = `Estendi a ${legCm.toFixed(1)} cm (~${pct}% della corsa)`;
    } else {
      element = 'Elemento CORTO, quasi chiuso';
      extend = `Ideale ${legCm.toFixed(1)} cm → chiudi quasi del tutto (min ${SHORT_MIN} cm)`;
      level = 'warn';
      note = 'Frequenza molto alta: il braccio ideale è più corto del minimo del kit; per il massimo serve un’antenna dedicata.';
    }
    return { lambda, legCm, element, extend, note, level };
  }

  function orientationFor(mhz) {
    if (mhz >= 137 && mhz < 138) return 'A «V» / orizzontale (satelliti NOAA, segnale dall’alto)';
    return 'Verticale (bracci in linea, cavo che scende dritto)';
  }

  function fmtBw(kHz) {
    if (kHz == null) return '—';
    if (kHz >= 1000) return (kHz / 1000).toFixed(2).replace(/\.?0+$/, '') + ' MHz';
    if (kHz >= 1) return kHz + ' kHz';
    return (kHz * 1000) + ' Hz';
  }
  function fmtLen(m) { return m >= 1 ? m.toFixed(2) + ' m' : (m * 100).toFixed(1) + ' cm'; }
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  // ---- Blocco HTML per il pannello ----
  function renderBlock(b) {
    // pertinente solo se la banda si sovrappone alla portata dell'RTL-SDR
    if (!(b.from <= RX_MAX_HZ && b.to >= RX_MIN_HZ)) return '';

    const centerHz = Math.sqrt(b.from * b.to);      // centro logaritmico
    const mhz = centerHz / 1e6;
    const wide = (b.to / b.from) > 3;               // banda molto ampia → valori al centro

    const rx = receiveSettings(mhz, b);
    const ant = antenna(mhz);
    const needsDS = centerHz < DIRECT_SAMPLING_HZ;

    const notes = [];
    if (rx.decoder) notes.push({ lvl: 'warn', icon: '⚙️', txt: `Serve un decoder dedicato: ${esc(rx.decoder)}.` });
    if (needsDS) notes.push({ lvl: 'warn', icon: '🔌', txt: 'HF: imposta <b>Source → Direct Sampling = Q branch</b>; il dipolo del kit è troppo corto, meglio un filo lungo.' });
    if (ant.note) notes.push({ lvl: ant.level === 'danger' ? 'danger' : 'warn', icon: '📏', txt: esc(ant.note) });
    if (wide) notes.push({ lvl: 'info', icon: 'ℹ️', txt: 'Banda ampia: i valori sono calcolati al centro banda. Seleziona una sotto-banda per più precisione.' });

    const notesHtml = notes.map(n =>
      `<div class="sdr-note ${n.lvl}">${n.icon} ${n.txt}</div>`).join('');

    const legTxt = ant.legCm > 200 ? '&gt;200 cm' : `${ant.legCm.toFixed(1)} cm × 2`;

    return `
    <div class="sdr">
      <div class="sdr-head">📻 Ascolto con RTL-SDR + SDR++</div>
      <div class="sdr-cols">
        <div class="sdr-group">
          <div class="sdr-gtitle">🎛️ Impostazioni SDR++</div>
          <dl class="sdr-dl">
            <dt>Radio → Modo</dt><dd>${MODE_DESC[rx.mode] || rx.mode}</dd>
            <dt>Bandwidth</dt><dd>${rx.mode === 'DIGITAL' ? '—' : fmtBw(rx.bw)}</dd>
            <dt>Direct Sampling</dt><dd>${needsDS ? 'Q branch' : 'Disabled'}</dd>
            <dt>Bias-T</dt><dd>OFF</dd>
            <dt>Offset</dt><dd>0 Hz</dd>
            <dt>Sample rate</dt><dd>2.4 MHz</dd>
          </dl>
        </div>
        <div class="sdr-group">
          <div class="sdr-gtitle">📡 Antenna (dipolo)</div>
          <dl class="sdr-dl">
            <dt>Braccio ¼λ</dt><dd><b>${legTxt}</b></dd>
            <dt>Elemento</dt><dd>${esc(ant.element)}</dd>
            <dt>Estensione</dt><dd>${esc(ant.extend)}</dd>
            <dt>Orientamento</dt><dd>${esc(orientationFor(mhz))}</dd>
            <dt>λ</dt><dd>${fmtLen(ant.lambda)}</dd>
          </dl>
        </div>
      </div>
      ${notesHtml}
    </div>`;
  }

  window.SDR = { renderBlock, receiveSettings, antenna };
})();
