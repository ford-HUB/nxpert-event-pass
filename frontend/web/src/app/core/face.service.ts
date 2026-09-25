import { Injectable } from '@angular/core';

// A detected face with everything needed to judge capture quality.
export interface FaceSample {
  descriptor: Float32Array;
  score: number;
  box: { x: number; y: number; width: number; height: number };
  // face-api FaceLandmarks68 (has getLeftEye/getRightEye/getNose/... helpers).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  landmarks: any;
  imageWidth: number;
  imageHeight: number;
}

/**
 * Face detection + 128-d descriptor computation, entirely in the browser via
 * @vladmandic/face-api (lazy-loaded so it never weighs down the main bundle).
 * Models are fetched from a CDN on first use.
 */
@Injectable({ providedIn: 'root' })
export class FaceService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private faceapi: any = null;
  private loading?: Promise<void>;
  // Served from the app's own assets so face recognition works offline (cached by the SW).
  private readonly MODEL_URL = 'face-models';

  /** Loads the library + models once (idempotent). */
  async ensureLoaded(): Promise<void> {
    if (this.faceapi) return;
    if (!this.loading) {
      this.loading = (async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const faceapi: any = await import('@vladmandic/face-api');
        try {
          await faceapi.tf?.setBackend?.('webgl');
        } catch {
          /* fall back to whatever backend is available */
        }
        await faceapi.tf?.ready?.();
        await faceapi.nets.tinyFaceDetector.loadFromUri(this.MODEL_URL);
        await faceapi.nets.faceLandmark68Net.loadFromUri(this.MODEL_URL);
        await faceapi.nets.faceRecognitionNet.loadFromUri(this.MODEL_URL);
        this.faceapi = faceapi;
      })();
    }
    return this.loading;
  }

  /** Detects a single face and returns its 128-d descriptor, or null if no face was found. */
  async describe(
    input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  ): Promise<Float32Array | null> {
    await this.ensureLoaded();
    const f = this.faceapi;
    const det = await f
      .detectSingleFace(input, new f.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.4 }))
      .withFaceLandmarks()
      .withFaceDescriptor();
    return det?.descriptor ?? null;
  }

  /**
   * Detects a single face and returns its descriptor plus geometry (box, landmarks, score),
   * used to judge whether the face is centered, close enough, and facing the camera for
   * auto-capture. Returns null when no face is found.
   */
  async detect(
    input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  ): Promise<FaceSample | null> {
    await this.ensureLoaded();
    const f = this.faceapi;
    const det = await f
      .detectSingleFace(input, new f.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.4 }))
      .withFaceLandmarks()
      .withFaceDescriptor();
    if (!det) return null;
    const d = det.detection;
    return {
      descriptor: det.descriptor,
      score: d.score,
      box: { x: d.box.x, y: d.box.y, width: d.box.width, height: d.box.height },
      landmarks: det.landmarks,
      imageWidth: d.imageDims.width,
      imageHeight: d.imageDims.height,
    };
  }

  /** Euclidean distance between two descriptors (lower = more similar; ~0.5 is a good match). */
  distance(a: ArrayLike<number>, b: ArrayLike<number>): number {
    let s = 0;
    for (let i = 0; i < a.length; i++) {
      const d = a[i] - b[i];
      s += d * d;
    }
    return Math.sqrt(s);
  }
}
