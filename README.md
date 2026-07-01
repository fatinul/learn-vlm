# Process Checklist

A small, modular web app that watches an RTSP camera feed and uses a local
[Ollama](https://ollama.com) vision model to continuously verify a checklist
of natural-language conditions (e.g. *"there should be 1 person wearing a
black shirt"*) against the live footage.

Tickboxes are **read-only** — they reflect what the AI last decided for each
condition and cannot be checked/unchecked manually. A statistics panel shows
CPU/memory usage and pipeline timing so you can see whether your hardware can
keep up with the checklist size and evaluation interval you've configured.

## How it works

```
RTSP camera --(ffmpeg)--> JPEG frame --(Ollama vision model)--> true/false per condition
```

On a timer (`EVAL_INTERVAL_MS`), the server:
1. Grabs a single frame from the RTSP stream via `ffmpeg`.
2. Sends that frame + each checklist prompt to Ollama, asking for a
   `{result, confidence, reason}` JSON verdict.
3. Stores the verdict on the checklist item (this is the only thing that
   updates a tickbox — there is no manual-edit API).
4. Records timing so the stats panel can estimate whether the pipeline is
   keeping up with the configured interval.

The front end polls `/api/state` every 2 seconds and re-renders the frame,
checklist, and stats — no page reloads needed.

## Requirements

- Node.js 18+ (uses the built-in `fetch`)
- [ffmpeg](https://ffmpeg.org/) installed and available on `PATH` (or point
  `FFMPEG_PATH` at the binary)
- [Ollama](https://ollama.com) running locally (or reachable over the
  network) with a **vision-capable** model pulled, e.g.:
  ```
  ollama pull qwen3.5:2b
  ```

## Setup

```bash
cd image_checklist
npm install
cp .env.example .env   # then edit RTSP_URL / OLLAMA_MODEL / etc.
npm start
```

Open http://localhost:3000.

## Configuration (`.env`)

| Variable                   | Description                                                            |
|-----------------------------|--------------------------------------------------------------------------|
| `PORT`                      | Web server port (default `3000`)                                       |
| `RTSP_URL`                  | Full RTSP URL including credentials                                    |
| `RTSP_TRANSPORT`            | `tcp` or `udp` (default `tcp`, more reliable through NAT/firewalls)     |
| `OLLAMA_HOST`               | Base URL of the Ollama server (default `http://localhost:11434`)       |
| `OLLAMA_MODEL`              | Vision-capable model tag to use                                        |
| `OLLAMA_TIMEOUT_MS`         | Per-condition inference timeout                                        |
| `EVAL_INTERVAL_MS`          | How often to capture a frame and re-check all conditions               |
| `FRAME_CAPTURE_TIMEOUT_MS`  | Max time to wait for ffmpeg to return a frame                          |
| `FFMPEG_PATH`               | Path to the ffmpeg binary                                              |

## Understanding the statistics panel

- **Avg AI evaluation** — average time for one condition to be judged by the
  model. This is the main cost driver.
- **Estimated cycle time** — `avg frame capture + (avg AI evaluation × number
  of checklist items)`. This is roughly how long one full pass over the
  checklist takes.
- If **estimated cycle time > eval interval**, the system can't keep up and a
  warning is shown. Fix this by using a smaller/faster vision model, reducing
  the number of checklist items, or increasing `EVAL_INTERVAL_MS`.
- CPU load and memory usage come straight from the OS and the Node process,
  and are shown so you can correlate slow inference with system load
  (especially useful since Ollama inference is CPU/GPU-bound and will compete
  with everything else on the machine).

## Project structure

```
image_checklist/
  server.js                 entry point
  src/
    app.js                  express app wiring
    config.js                env-driven configuration
    routes/
      pages.js               renders the EJS page
      api.js                  JSON API (state, checklist CRUD, controls)
    services/
      rtspCapture.js          ffmpeg-based single-frame capture
      ollamaClient.js         calls Ollama's /api/generate with the image
      checklistStore.js       in-memory checklist (AI-only writes to status)
      evaluator.js            the capture -> evaluate loop + start/stop/now
      systemStats.js          OS + pipeline timing metrics
  views/
    index.ejs                 page layout
  public/
    css/style.css
    js/main.js                polling UI logic (fetch, no framework)
```

Each service has a single responsibility, so swapping pieces later is easy:
e.g. replace `rtspCapture.js` with a different camera source, or
`ollamaClient.js` with another vision model API, without touching the rest of
the app. The checklist store is in-memory by design (simple + fast); swap it
for a database/file if you need persistence across restarts.
