// Ненавязчивый звуковой отклик (мягкий «клик») через Web Audio API.
// Никаких внешних файлов не требуется; звук короткий и тихий.

let audioCtx: AudioContext | null = null;

export function playClick(): void {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') void audioCtx.resume();

    const ctx = audioCtx;
    const t0 = ctx.currentTime;

    // Очень короткий шумовой всплеск — имитация мягкого клика
    const dur = 0.03;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const env = Math.pow(1 - i / data.length, 2); // экспоненциальное затухание
      data[i] = (Math.random() * 2 - 1) * env;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2200;
    filter.Q.value = 0.9;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.06, t0); // тихо, ненавязчиво
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    noise.connect(filter).connect(gain).connect(ctx.destination);
    noise.start(t0);
    noise.stop(t0 + dur);

    // Мягкая тоновая поддержка для «округлости» звука
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, t0);
    osc.frequency.exponentialRampToValueAtTime(660, t0 + 0.05);
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.04, t0);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06);
    osc.connect(oscGain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.07);
  } catch {
    // Звук — второстепенная функция, ошибки игнорируем
  }
}
