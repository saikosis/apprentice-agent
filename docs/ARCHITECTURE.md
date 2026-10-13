# Apprentice — Architecture
Solid = MVP. Dashed = stretch/roadmap.

## 1. System diagram
````mermaid
flowchart LR
  subgraph Browser["Browser (Chrome 116+)"]
    REC[Recorder<br/>getDisplayMedia + mic<br/>MediaRecorder webm]
    PIP[PiP companion<br/>documentPictureInPicture]
    LIVEC[Live client<br/>@google/genai live.connect]
    PUI[Probe answer UI]
    GV[Graph view<br/>Cytoscape]
    EX[Exam report + pilot chart]
    DM[Demo mode /demo]
    GIS[GIS token client<br/>spreadsheets.readonly]
  end

  subgraph CR["Cloud Run: apprentice (FastAPI, asia-south1)"]
    API[REST /api/*]
    TOK[live_token]
    UP[uploads: V4 signed URL]
    PIPE[pipeline: segment / deviations / variants / probes / graph]
    EXAM[exam: scenarios / arms / judge / report]
    MA[moderation client]
    STATIC[static React build]
  end

  FS[(Firestore<br/>workspaces/demo, workspaces/live)]
  GCS[(Cloud Storage<br/>recordings)]
  SM[(Secret Manager<br/>GEMINI_API_KEY)]
  FA[Firebase Auth]
  GLIVE[Gemini Live API<br/>gemini-3.8-live]
  GFILES[Gemini Files API]
  GFLASH[gemini-3.8-flash]
  MARMOR[Model Armor<br/>asia-south1 template]
  SHEETS[Sheets API v4 read-only]

  Browser -- ID token --> API
  FA -. sign-in .- Browser
  TOK -- auth_tokens.create --> GLIVE
  LIVEC == ephemeral token, WSS: frames 1 FPS + PCM16 ==> GLIVE
  GLIVE -- tool call log_deviation + transcripts --> LIVEC
  LIVEC -- POST deviation / answer --> API
  REC -- PUT webm via signed URL --> GCS
  UP --> GCS
  PIPE --> GFILES --> GFLASH
  PIPE --> MA --> MARMOR
  EXAM --> GFLASH
  EXAM --> MA
  API <--> FS
  CR -- secret env --> SM
  GIS -- values.get --> SHEETS
  GIS -- snapshot rows --> API
  STATIC --> Browser
  AR[Agent Runtime]:::road
  AG[Agent Gateway]:::road
  EXAM -.-> AR -.-> AG
  classDef road stroke-dasharray: 5 5,color:#888;
````

## 2. Pipeline flowchart
````mermaid
flowchart TD
  A[Session uploaded to GCS] --> B[Upload to Gemini Files API; poll until ACTIVE]
  B --> C[Segmenter: MM:SS segments, app, action, invoice, decision, transcript]
  C --> MA1{Model Armor<br/>segment text}
  MA1 -- flagged --> Q[Quarantine: mark segment, excluded from graph]
  MA1 -- clean --> D[Deviation detector: SOP + segments + sheet diff + live deviations]
  D --> E[Dedup vs live deviations: same sop_rule and |dt| ≤ 20 s]
  E --> F{≥3 sessions processed?}
  F -- yes --> G[Variant discovery: ONE call over all sessions' segments + deviations]
  F -- no --> H
  G --> H[CDM probe generator: ≤4 probes per new deviation/variant]
  H --> I[Expert answers: voice (Live) or typed]
  I --> MA2{Model Armor<br/>answer text}
  MA2 -- clean --> J[Graph builder: nodes/edges citing clips + SOP §]
  MA2 -- flagged --> Q
  J --> K[(Firestore graph)]
  X[Sheet diff before/after]:::opt -.-> D
  classDef opt stroke-dasharray: 5 5;
````

## 3. Live sequence
````mermaid
sequenceDiagram
  autonumber
  participant U as Expert (PiP)
  participant B as Browser app
  participant API as Cloud Run API
  participant SM as Secret Manager
  participant L as Gemini Live (gemini-3.8-live)
  participant FS as Firestore
  U->>B: Click Start (inside PiP window)
  B->>API: POST /api/live/token {session_id} (Firebase ID token)
  API->>SM: GEMINI_API_KEY (cached at startup)
  API->>L: auth_tokens.create(uses=1, expire 30m, new_session 1m, liveConnectConstraints = full setup incl. SOP + tool)
  L-->>API: token.name
  API-->>B: {token, model, expires_at}
  B->>L: live.connect(apiKey=token) (WSS BidiGenerateContentConstrained)
  loop every 1 s
    B->>L: sendRealtimeInput video JPEG (≤768 px)
  end
  loop every 20–40 ms
    B->>L: sendRealtimeInput audio PCM16 16 kHz (mic)
  end
  L-->>B: toolCall log_deviation{sop_rule, question, invoice_id, timestamp?}
  B->>B: t_client = now - rec_start - 3 s
  B->>API: POST /api/sessions/{id}/deviations (source=live)
  API->>FS: deviations + probes (source=live)
  B->>L: toolResponse {id, name, response{ok, probe_id}, scheduling: SILENT}
  B->>U: PiP pins question text
  L-->>B: audio "Why did you skip the PO match?" (+ outputTranscription)
  alt no audio within 4 s
    B->>L: sendClientContent(user: "Ask the expert now, one sentence: <q>", turnComplete=true)
    alt still silent after 4 s
      B->>U: speechSynthesis.speak(q)
    end
  end
  U->>L: voice answer (mic)
  L-->>B: inputTranscription chunks
  B->>API: POST /api/probes/{pid}/answer {text, source: voice_live}
  API->>FS: probe_answers (after Model Armor)
  L-->>B: sessionResumptionUpdate {newHandle} (stored in memory)
  L-->>B: goAway {timeLeft}
  B->>API: POST /api/live/token (resume)
  B->>L: reconnect with handle
````

## 4. Batch sequence
````mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant API as Cloud Run
  participant GCS as Cloud Storage
  participant F as Gemini Files API
  participant G as gemini-3.8-flash
  participant MA as Model Armor
  participant FS as Firestore
  B->>API: POST /api/sessions/{id}/upload-url
  API-->>B: V4 signed PUT URL (15 min, content-type video/webm)
  B->>GCS: PUT recording.webm
  B->>API: POST /api/sessions/{id}/finalize
  API->>FS: status=uploaded
  B->>API: POST /api/sessions/{id}/process
  API-->>B: 202 Accepted (background task)
  API->>GCS: download blob
  API->>F: files.upload; poll state until ACTIVE
  API->>G: segmenter(video, SOP) → SegmentList
  API->>MA: sanitizeUserPrompt(segment text)
  API->>G: deviation detector(SOP, segments, sheet diff, live deviations) → DeviationList
  API->>G: probe generator → ProbeList
  API->>FS: segments, deviations, probes; status=processed
  B->>API: GET /api/sessions/{id} (poll every 3 s)
````

## 5. Exam flow (no label leakage)
````mermaid
flowchart TD
  S[Scenario generator: 8 cases from graph + SOP + trap spec] --> C[Exam cases]
  H[2 held-out recordings → cases] --> C
  C --> L[Expert labels each case: decision + 1-line rationale]
  L -. stored in exam_cases only .-> LBL[(labels)]
  C --> MA1{Model Armor: case inputs}
  MA1 --> A1[Arm A: SOP only ×3]
  MA1 --> A2[Arm B: SOP + graph ×3]
  A1 --> MA2{Model Armor: outputs}
  A2 --> MA2
  MA2 --> J[Judge gemini-3.8-flash: rubric vs label]
  LBL --> J
  J --> R[Report: per-case table + pilot bar chart]
  R --> M{Graph-arm miss?}
  M -- yes --> P[New probe to expert: asks about the situation, NOT the label]
  P --> ANS[Expert answer] --> GB[Graph rebuild]
  GB -. never reads .-x LBL
````

## 6. Roadmap
````mermaid
flowchart LR
  MVP[MVP: web app + PiP + Live + graph + exam]
  MVP -.-> EXT[Chrome extension: Gmail DOM, side panel]:::r
  MVP -.-> KB[Policy KB from Drive/Confluence]:::r
  MVP -.-> ML[Live interviews in JA/HI]:::r
  MVP -.-> FLEET[Compiled agents on Agent Runtime]:::r
  FLEET -.-> GW[Agent Gateway + Model Armor inline]:::r
  MVP -.-> VTX[Agent Platform / Vertex regional path, CMEK, VPC-SC]:::r
  classDef r stroke-dasharray: 5 5,color:#666;
````

## 7. Component notes
- **One Cloud Run service** in asia-south1: FastAPI serves `/api/*` and the Vite build from `/` (SPA fallback to index.html). `--min-instances=1 --no-cpu-throttling --timeout=900 --concurrency=20 --memory=1Gi`. No WebSockets terminate on Cloud Run (browser → Live is direct).
- **Background processing**: `asyncio.create_task` after returning 202. CPU stays allocated (`--no-cpu-throttling`). Status in Firestore. Move to a Cloud Run Job only if a session takes >15 min.
- **Secrets**: `GEMINI_API_KEY` mounted from Secret Manager (`--set-secrets`). It never reaches the browser. The browser only gets one-use ephemeral tokens, held in memory.
- **Signed URLs on Cloud Run**: V4 signing through IAM `signBlob`. The runtime service account needs `roles/iam.serviceAccountTokenCreator` on itself and `roles/storage.objectAdmin` on the bucket. Bucket CORS allows PUT from the service origin and localhost.
- **Model Armor**: regional endpoint `modelarmor.asia-south1.rep.googleapis.com`, template `apprentice-default`; runtime SA has `roles/modelarmor.user`.
- **Agent Runtime / Agent Gateway**: not used. Rationale: the competition requires Cloud Run or Firebase hosting; the arms are stateless single prompts with no tools; Gateway governs MCP/A2A traffic we don't have, and it's in preview. Revisit when compiled agents take real actions across systems.