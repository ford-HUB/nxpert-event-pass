import { Injectable, signal } from '@angular/core';

const MUTE_KEY = 'scanner_beep_muted';

/**
 * Short scanner "beep" synthesized with the Web Audio API (no audio file to ship or cache).
 * Browsers only allow sound after a user gesture, so the audio context is created/resumed on
 * the first tap or key press on the page; beeps before that are silently skipped.
 */
@Injectable({ providedIn: 'root' })
export class BeepService {
  readonly muted = signal(this.loadMuted());

  private ctx: AudioContext | null = null;

  constructor() {
    const unlock = () => this.ensureContext();
    document.addEventListener('pointerdown', unlock, { capture: true });
    document.addEventListener('keydown', unlock, { capture: true });
  }

  /** Play the "read" beep: a crisp ~120 ms tone, like a handheld barcode scanner. */
  beep(): void {
    if (this.muted()) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (ctx.state === 'running') this.play(ctx);
    // Still waking up (or waiting for a gesture): play once it's allowed, otherwise skip.
    else void ctx.resume().then(() => ctx.state === 'running' && this.play(ctx), () => {});
  }

  /** Create the audio context early (e.g. when the scanner opens) so the first beep isn't late. */
  warmUp(): void {
    this.ensureContext();
  }

  private play(ctx: AudioContext): void {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1760, t);
    // Quick attack and decay so it clicks cleanly instead of popping.
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.13);
  }

  toggleMute(): void {
    const m = !this.muted();
    this.muted.set(m);
    try {
      localStorage.setItem(MUTE_KEY, m ? '1' : '0');
    } catch {
      /* storage unavailable — keep the in-memory setting */
    }
    if (!m) this.beep(); // audible confirmation that sound is back on
  }

  private ensureContext(): AudioContext | null {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
        if (!Ctor) return null;
        this.ctx = new Ctor();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    } catch {
      return null;
    }
  }

  private loadMuted(): boolean {
    try {
      return localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      return false;
    }
  }
}
