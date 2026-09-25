import { Component, ElementRef, OnDestroy, OnInit, ViewChild, inject, signal } from '@angular/core';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { FaceSample, FaceService } from '../core/face.service';

export interface FaceCaptureResult {
  descriptor: number[]; // 128-d face descriptor
  image: string; // captured face photo (jpeg data URL)
}

type Point = { x: number; y: number };
// Guide ring state: 'idle' (no face yet), 'adjust' (reposition), 'good' (holding for capture).
type GuideState = 'idle' | 'adjust' | 'good';

// How many consecutive good frames (at DETECT_INTERVAL) before auto-capturing.
const STABLE_TARGET = 5;
const DETECT_INTERVAL = 300;

function centroid(points: Point[]): Point {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

/**
 * Camera modal that detects a face and returns its descriptor + a still photo. It shows an oval
 * guide and live positioning hints, and auto-captures once the face is centered, close enough,
 * and facing the camera for a short, stable moment. A manual Capture button remains as a fallback.
 */
@Component({
  selector: 'app-face-capture-dialog',
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatProgressBarModule,
  ],
  templateUrl: './face-capture-dialog.html',
  styleUrl: './face-capture-dialog.scss',
})
export class FaceCaptureDialogComponent implements OnInit, OnDestroy {
  private face = inject(FaceService);
  private ref = inject(MatDialogRef<FaceCaptureDialogComponent>);

  @ViewChild('video', { static: true }) private videoRef!: ElementRef<HTMLVideoElement>;

  private stream: MediaStream | null = null;
  private loop: ReturnType<typeof setInterval> | null = null;
  private detecting = false;
  private stableFrames = 0;

  loadingModels = signal(true);
  cameraError = signal<string | null>(null);
  busy = signal(false);
  error = signal<string | null>(null);
  captured = signal<FaceCaptureResult | null>(null);

  // Auto-capture guidance.
  guideState = signal<GuideState>('idle');
  hint = signal<string>('Position your face inside the oval');
  holdProgress = signal(0); // 0..1 while holding a good pose

  async ngOnInit(): Promise<void> {
    // Load the face models and open the camera in parallel.
    this.face.ensureLoaded().then(
      () => this.loadingModels.set(false),
      () => {
        this.loadingModels.set(false);
        this.error.set('Could not load the face-recognition models. Check your connection.');
      },
    );
    await this.startCamera();
  }

  ngOnDestroy(): void {
    this.stopAutoCapture();
    this.stopCamera();
  }

  private async startCamera(): Promise<void> {
    this.cameraError.set(null);
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      const v = this.videoRef.nativeElement;
      v.srcObject = this.stream;
      await v.play();
      this.startAutoCapture();
    } catch {
      this.cameraError.set(
        'Could not open the camera. Grant camera permission and use HTTPS (or localhost).',
      );
    }
  }

  private stopCamera(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  // ---- Auto-capture loop ----
  private startAutoCapture(): void {
    if (this.loop) return;
    this.stableFrames = 0;
    this.holdProgress.set(0);
    this.loop = setInterval(() => void this.tick(), DETECT_INTERVAL);
  }

  private stopAutoCapture(): void {
    if (this.loop) {
      clearInterval(this.loop);
      this.loop = null;
    }
    this.stableFrames = 0;
  }

  private async tick(): Promise<void> {
    if (
      this.detecting ||
      this.busy() ||
      this.captured() ||
      this.loadingModels() ||
      this.cameraError()
    ) {
      return;
    }
    const v = this.videoRef.nativeElement;
    if (!v.videoWidth) return;

    this.detecting = true;
    try {
      const sample = await this.face.detect(v);
      if (!sample) {
        this.resetHold('idle', 'Position your face inside the oval');
        return;
      }
      const check = this.evaluate(sample);
      this.hint.set(check.hint);
      if (!check.ok) {
        this.resetHold('adjust', check.hint);
        return;
      }
      // Good pose — hold steady, then auto-capture.
      this.guideState.set('good');
      this.stableFrames++;
      this.holdProgress.set(Math.min(1, this.stableFrames / STABLE_TARGET));
      if (this.stableFrames >= STABLE_TARGET) {
        this.stopAutoCapture();
        await this.finalize(sample);
      }
    } catch {
      /* transient detection error — try again next tick */
    } finally {
      this.detecting = false;
    }
  }

  private resetHold(state: GuideState, hint: string): void {
    this.guideState.set(state);
    this.hint.set(hint);
    this.stableFrames = 0;
    this.holdProgress.set(0);
  }

  // Judge whether the face is well-positioned for capture, with a hint when it isn't.
  private evaluate(s: FaceSample): { ok: boolean; hint: string } {
    const cx = (s.box.x + s.box.width / 2) / s.imageWidth;
    const cy = (s.box.y + s.box.height / 2) / s.imageHeight;
    const sizeRatio = s.box.width / s.imageWidth;

    if (s.score < 0.5) return { ok: false, hint: 'Move into better lighting' };
    if (sizeRatio < 0.28) return { ok: false, hint: 'Move a little closer' };
    if (sizeRatio > 0.82) return { ok: false, hint: 'Move back a bit' };
    if (Math.abs(cx - 0.5) > 0.16) return { ok: false, hint: 'Center your face in the oval' };
    if (cy < 0.32) return { ok: false, hint: 'Lower your face a little' };
    if (cy > 0.68) return { ok: false, hint: 'Raise your face a little' };

    // Facing the camera: nose should sit between the eyes (yaw) and the eye line be level (roll).
    try {
      const le = centroid(s.landmarks.getLeftEye());
      const re = centroid(s.landmarks.getRightEye());
      const nose = centroid(s.landmarks.getNose());
      const eyeMidX = (le.x + re.x) / 2;
      const eyeDist = Math.hypot(re.x - le.x, re.y - le.y) || 1;
      const yaw = (nose.x - eyeMidX) / eyeDist;
      if (Math.abs(yaw) > 0.35) return { ok: false, hint: 'Look straight at the camera' };
      const roll = Math.abs((Math.atan2(re.y - le.y, re.x - le.x) * 180) / Math.PI);
      if (roll > 16) return { ok: false, hint: 'Keep your head upright' };
    } catch {
      /* landmarks unavailable — fall through as acceptable */
    }
    return { ok: true, hint: 'Hold still…' };
  }

  // Grab a still as a square headshot centered on the detected face, so the saved photo is
  // framed the same way the user lined it up in the oval — not the raw (often off-center,
  // letterboxed) full sensor frame.
  private grabStill(v: HTMLVideoElement, box?: { x: number; y: number; width: number; height: number }): string {
    const vw = v.videoWidth || 640;
    const vh = v.videoHeight || 480;
    const out = 480;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    if (box) {
      // Square crop centered on the face (with margin for head/shoulders), clamped to the frame.
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      const size = Math.min(Math.max(box.width, box.height) * 1.9, vw, vh);
      const sx = Math.max(0, Math.min(cx - size / 2, vw - size));
      const sy = Math.max(0, Math.min(cy - size / 2, vh - size));
      canvas.width = out;
      canvas.height = out;
      ctx.drawImage(v, sx, sy, size, size, 0, 0, out, out);
    } else {
      const scale = Math.min(1, out / vw);
      canvas.width = Math.round(vw * scale);
      canvas.height = Math.round(vh * scale);
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    }
    return canvas.toDataURL('image/jpeg', 0.9);
  }

  // Finalize from a detected face (auto- or manual capture): keep the centered still + close camera.
  private async finalize(sample: FaceSample): Promise<void> {
    const image = this.grabStill(this.videoRef.nativeElement, sample.box);
    this.captured.set({ descriptor: Array.from(sample.descriptor), image });
    this.stopAutoCapture();
    this.stopCamera();
  }

  // Manual capture fallback (the button).
  async capture(): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      const sample = await this.face.detect(this.videoRef.nativeElement);
      if (!sample) {
        this.error.set('No face detected — center the face in the oval and try again.');
        return;
      }
      await this.finalize(sample);
    } catch {
      this.error.set('Face capture failed. Please try again.');
    } finally {
      this.busy.set(false);
    }
  }

  async retake(): Promise<void> {
    this.captured.set(null);
    this.error.set(null);
    this.resetHold('idle', 'Position your face inside the oval');
    await this.startCamera();
  }

  use(): void {
    if (this.captured()) this.ref.close(this.captured());
  }

  close(): void {
    this.ref.close();
  }
}
