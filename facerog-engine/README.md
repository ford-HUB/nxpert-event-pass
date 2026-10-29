# Face Recognition Engine (prototype)

Continuously identifies registered people in a live video feed and returns their
**name and registered picture**. Faces are detected with SCRFD, followed across frames
with ByteTrack, and recognized with ArcFace, so each person is recognized once per
track rather than on every frame.

| Component        | Technology        | Where                              | Optimization |
|------------------|-------------------|------------------------------------|--------------|
| Face detection   | SCRFD (ONNX)      | `app/ml/detector.py`               | One letterboxed pass per frame, NumPy decode + NMS |
| Face tracking    | ByteTrack         | `app/ml/tracker.py`, `kalman_filter.py` | Keeps identities across frames, so ArcFace runs only on new or unverified tracks |
| Face alignment   | 5-point similarity transform | `app/ml/aligner.py`     | Removes head tilt before embedding |
| Face recognition | ArcFace (ONNX)    | `app/ml/embedder.py`               | Batched embeddings, L2-normalized once |
| Inference        | ONNX Runtime      | `app/ml/onnx_session.py`           | CUDA → DirectML → CPU, whichever is available |
| Face matching    | NumPy             | `app/ml/matcher.py`, `app/repositories/vector_index.py` | In-memory cosine similarity (one matrix product) |
| Video processing | OpenCV            | `app/utils/video_stream.py`        | Capture thread keeps only the newest frame; frames resized before inference |
| API + dashboard  | FastAPI           | `app/api/`, `app/web/`             | MJPEG stream, JSON track snapshots |

## How it works

```
camera ─► resize ─► SCRFD ─► ByteTrack ──► track already identified? ── yes ─► reuse name
                                                │ no / due for re-check
                                                ▼
                         align (5 landmarks) ─► ArcFace ─► average over the track's frames
                                                ▼
                         NumPy cosine vs. datasets/faces gallery ─► name + photo
```

**One photo per person, recognized at a slight angle**
- Each enrollment photo becomes four templates: as taken, mirrored, darkened (dim or backlit
  webcam) and low resolution (face far from the camera).
- Live faces are embedded as the average of the face and its mirror, so slight left and
  right turns land closer to the frontal photo.
- Faces are aligned on their landmarks before embedding, which cancels in-plane tilt.
- Each track keeps its last 10 embeddings. They are averaged with weights based on how
  frontal each frame is (estimated yaw/pitch), so a few angled frames add up to a stable identity.
- Once a track is matched, it keeps the name while the person turns away. ByteTrack
  guarantees it is the same face, and the name only changes if another enrolled person matches.
- Every tracked face gets a **zoom view**: an upscaled crop with the eye–nose–mouth
  structure drawn on and the estimated yaw/pitch. Faces turned more than 15° are flagged
  *angled* and also get a picture-in-picture zoom in the video.

## Setup

```bash
python -m venv .venv
.venv\Scripts\activate            # Windows   (Linux/macOS: source .venv/bin/activate)
pip install -r requirements-dev.txt
python scripts/download_weights.py   # SCRFD det_10g + ArcFace w600k_r50 → app/ml/weights/
copy .env.example .env               # Windows   (Linux/macOS: cp .env.example .env)
```

`.env`, `.env.local` and the weights are git-ignored, so a fresh clone needs these steps. Put
`FRE_BACKEND_API_KEY` in `.env.local`; it must match `FaceEngine:ApiKey` in the API config.

GPU: replace `onnxruntime` with `onnxruntime-directml` (Windows, no CUDA install needed)
or `onnxruntime-gpu` (CUDA 12 + cuDNN 9). For a lightweight CPU setup, use
`python scripts/download_weights.py --pack buffalo_s`.

## Register people

Put photos in `datasets/faces/<person_id>/`, then click **Reload dataset** on the dashboard.
Full dataset rules are in the Claude Code skill `.claude/skills/datasets/SKILL.md`.

```
datasets/faces/juan_dela_cruz/{info.json, profile.jpg}    # one frontal photo is enough
```

## Run

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Open http://localhost:8000. The dashboard shows:

- **Live recognition**: the annotated stream, with boxes, names, similarity scores and zoom insets for angled faces.
- **Faces in view**: for each track, the registered photo beside the live zoom, with the similarity bar against the match threshold and the head pose.
- **Enrolled people**: enroll from an upload, reload the dataset, or remove someone. **Reset check-ins** clears the TV check-ins (everyone stays enrolled) so people can be scanned in again while testing.
- **Recognition log**: who was identified, when, and how confidently.

### TV mode (`/tv`)

A check-in screen for a TV or projector. Press **F** or click **Fullscreen**.

- Check-ins happen **only while TV mode is open**. The dashboard still recognizes faces but checks
  no one in. Each TV poll is a heartbeat; once no TV has polled for `FRE_TV_HEARTBEAT_SECONDS` (5),
  the camera stops checking people in.
- Every matched face is **checked in**: unknown faces never appear. Several people matched in the
  same frame are checked in together.
- There is no photo upload: a person's registered photo and name appear on their own as soon as the
  camera recognizes them and they are checked in.
- Check-ins are shown one at a time, full screen, with the person's registered photo and name for
  `FRE_TV_DISPLAY_SECONDS` (3 s).
- When the camera recognizes several people at once, a small queue appears in the bottom-right corner.
  It lists the next three people (photo, name and a **✓ Checked in** status, since people in line are
  already checked in) and *+N more* beyond that. It disappears when no one is waiting, so a single
  person gets the whole screen with no queue.
- Nobody is hidden: a person (or QR pass) who comes back is shown again, and the backend's answer
  makes the TV say **✓ Already checked in**. Someone who stays in view is shown once; they're shown
  again after being out of view for `FRE_CHECK_IN_REPEAT_SECONDS` (10). **New session** (top right,
  hidden in fullscreen) clears the queue.
- **Detection mode** (TV buttons *Steady* / *Continuous*, `FRE_DETECTION_MODE`, or
  `POST /api/v1/stream/detection` with `{"mode": "steady"|"continuous"}`):
  - `steady` (default): a face is identified only once the person stands or moves a little, not while
    walking past. Steady = moving at most `FRE_STEADY_MAX_SPEED` (0.75) face widths per second over
    `FRE_STEADY_FRAMES` (3) frames; the video shows *hold still...* until then.
  - `continuous`: every face is identified right away, even someone walking quickly.

Use another source with `FRE_VIDEO_SOURCE` in `.env` (webcam index, video file or `rtsp://` URL),
or switch at runtime with `POST /api/v1/stream/start` and `{"source": "..."}`.

The live video is encoded from every camera frame on its own thread, so it plays at the camera's
rate however slow recognition is; the boxes update as each frame finishes inference. A webcam is
asked for `FRE_VIDEO_CAPTURE_WIDTH` x `FRE_VIDEO_CAPTURE_HEIGHT` (1280x720) at
`FRE_VIDEO_CAPTURE_FPS` (60) in MJPG (`FRE_VIDEO_CAPTURE_MJPG`); it picks its nearest mode, which
is logged as `Webcam mode: ...` at start. `FRE_STREAM_MAX_FPS` (60) caps what is sent to viewers.
The video is shown mirrored like a selfie camera (`FRE_STREAM_MIRROR`, default `true`); this is
display only, recognition and QR reading use the camera's real image.

## API (`/docs` for the interactive version)

| Method | Path | Purpose |
|--------|------|---------|
| GET    | `/api/v1/health` | Status, execution provider, enrolled count |
| GET    | `/api/v1/faces` | Enrolled people |
| POST   | `/api/v1/faces` | Enroll (`name`, `image` form fields) |
| POST   | `/api/v1/faces/reload` | Re-scan `datasets/faces` |
| GET    | `/api/v1/faces/{person_id}/photo` | Registered picture |
| DELETE | `/api/v1/faces/{person_id}` | Remove the person and their dataset folder |
| POST   | `/api/v1/recognize` | Identify all faces in an uploaded image: name, photo URL, similarity |
| POST   | `/api/v1/verify` | 1:1 compare `first_image` and `second_image` |
| GET    | `/api/v1/stream/video` | Annotated MJPEG stream |
| GET    | `/api/v1/stream/tracks` | Live tracks: identity, similarity, pose, trajectory |
| GET    | `/api/v1/stream/tracks/{track_id}/zoom` | Zoomed face-structure image |
| GET    | `/api/v1/stream/events` | Recent identifications |
| POST   | `/api/v1/stream/start` / `stop` | Control capture (optional `{"source": "..."}`) |
| GET    | `/api/v1/check-ins?after_sequence=N` | Checked-in participants after N, all names together |
| POST   | `/api/v1/check-ins` | Check in every registered face in an uploaded photo (`image` form field) |
| DELETE | `/api/v1/check-ins` | Start a new check-in session |

```bash
curl -F image=@group.jpg localhost:8000/api/v1/recognize
```

## Tuning

- `FRE_MATCH_THRESHOLD` (default 0.40): ArcFace cosine similarity. Raise it (0.45–0.5) if strangers get matched; lower it if registered people show up as Unknown.
- `FRE_RECOGNITION_INTERVAL_FRAMES` / `FRE_REVERIFY_INTERVAL_FRAMES`: how often unidentified tracks retry and identified tracks get re-checked.
- All settings are listed in `.env.example` (every one is optional; defaults live in `app/core/config.py`).

## Tests

```bash
pytest
```

The tests use a fake detector and embedder, so they run without model weights.

## Notes

- InsightFace's pretrained SCRFD/ArcFace weights are licensed for non-commercial research use only.
- Face photos are biometric data. `datasets/faces/` and `datasets/samples/` are git-ignored.
- The head pose comes from the 5 landmarks, so it is approximate. It is good enough to flag angled faces, but it is not a precise measurement.
