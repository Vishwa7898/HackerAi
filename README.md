# HackerAI Learning

Cybersecurity concepts, defensive analysis, and authorized lab/CTF learning with an OpenRouter-backed tutor. The app does not scan targets or run security tools.

## Run locally

1. Copy `.env.example` to `.env` or `.env.local`.
2. Put your OpenRouter API key in `AI_API_KEY` in that private file. Never put a real key in `.env.example`; `.env` and `.env.local` are ignored by Git.
3. Configure Firebase as described below, then run `npm run dev` and open <http://localhost:3000>.

## Firebase and Google sign-in

1. Create a Firebase project, add a Web app, and enable **Authentication > Sign-in method > Google**. Add `localhost` to the authorized domains for local development.
2. Create a Firestore database. The app accesses it only through the server using Firebase Admin credentials; do not make your service-account private key available to the browser or commit it.
3. Set the Web app values and project ID in `.env.local`:

	```dotenv
	FIREBASE_API_KEY=your-web-api-key
	FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
	FIREBASE_PROJECT_ID=your-project-id
	FIREBASE_APP_ID=your-web-app-id
	FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
	FIREBASE_MESSAGING_SENDER_ID=your-messaging-sender-id
	FIREBASE_MEASUREMENT_ID=your-analytics-measurement-id
	GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json
	```

	`GOOGLE_APPLICATION_CREDENTIALS` should point to a service-account JSON file with Firestore access. Alternatively, use Application Default Credentials in your environment. Keep the service-account file outside this repository.
4. Restart the server. The Google sign-in button appears when Firebase is configured. Each signed-in account can access only its own chat history; existing browser history is merged into the first account used in that browser. Up to 100 conversations are synced. Message text and text attachments persist in Firestore; image payloads and PDF messages are not stored there.

If Firebase is not configured, the app continues to work with browser-local chat history. Firebase Admin uses privileged server credentials, so keep the server and its environment private.

`AI_MODEL` defaults to `nvidia/nemotron-3-ultra-550b-a55b:free`; set it to another model ID in `.env.local` if needed for API clients that do not choose a model in the UI. Free model availability and rate limits are controlled by OpenRouter and may change. The app's model picker uses the selected model for each message and marks models that support image input. `AI_VISION_MODEL` (default `google/gemini-2.5-flash`) is used only by API clients that send images without selecting a model. Later, an OpenAI-compatible local server can be used by changing `AI_BASE_URL`, `AI_MODEL`, `AI_VISION_MODEL`, and (if required) `AI_API_KEY`.

When using OpenRouter, the model picker lists up to five featured free options verified against OpenRouter's live catalog: Cohere North Mini Code, Poolside Laguna S 2.1, NVIDIA Nemotron 3 Ultra, Google Gemma 4 31B, and NVIDIA Nemotron 3.5 Super VL. The available list can change; Gemma 4 and Nemotron 3.5 Super VL support image input.

The API key stays on the server and is never sent to the browser. Attach up to 20 files per message: common source-code and text files (up to 512 KB each), selectable-text PDFs (up to 5 MB each), and browser-readable images (up to 10 MB before resizing). Code/text attachments in a chat request are limited to 350,000 characters; combined PDF/image data is limited to 10 MB per message, and the selected files may total up to 20 MB before image resizing. Scanned/image-only PDFs require OCR before upload. Images are resized in your browser; PDF text is extracted locally by the app server. Replies follow the language of the latest message, and supported Markdown is rendered safely in the chat. The server refuses some clearly phrased requests for website break-in steps and instructs the model to focus on defense. These safeguards are not a complete security boundary, and model responses can still be inaccurate; use only systems you own or have explicit permission to test.