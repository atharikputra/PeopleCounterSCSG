// Server lokal: menyajikan halaman web + proxy WebRTC ke Roboflow (API key tetap di server).
import http from "node:http";
import { readFile } from "node:fs/promises";
import { InferenceHTTPClient, WorkflowError } from "@roboflow/inference-sdk";

const PORT = Number(process.env.PORT) || 3001;
const API_KEY = process.env.ROBOFLOW_API_KEY;
const SERVER_URL = "https://serverless.roboflow.com";

// Workflow dikunci di server supaya proxy tidak bisa dipakai untuk workflow lain.
const WORKSPACE_NAME = process.env.ROBOFLOW_WORKSPACE || "first-project-keylu";
const WORKFLOW_ID = process.env.ROBOFLOW_WORKFLOW || "people_counting-t5rly";

if (!API_KEY) {
    console.error("ROBOFLOW_API_KEY belum diisi. Salin .env.example menjadi .env lalu isi API key Anda.");
    process.exit(1);
}

const client = InferenceHTTPClient.init({ apiKey: API_KEY, serverUrl: SERVER_URL });

const STATIC_FILES = {
    "/": { path: "public/index.html", type: "text/html; charset=utf-8" },
    "/sdk.js": {
        path: "node_modules/@roboflow/inference-sdk/dist/index.es.js",
        type: "text/javascript; charset=utf-8",
    },
};

function sendJson(res, status, body) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function handleInitWebrtc(req, res) {
    const { offer, wrtcParams = {} } = await readJsonBody(req);
    const startedAt = Date.now();
    console.log(`[init-webrtc] meminta worker (${wrtcParams.requestedPlan}, ${wrtcParams.requestedRegion})...`);
    const answer = await client.initializeWebrtcWorker({
        offer,
        workspaceName: WORKSPACE_NAME,
        workflowId: WORKFLOW_ID,
        config: {
            imageInputName: wrtcParams.imageInputName,
            streamOutputNames: wrtcParams.streamOutputNames,
            dataOutputNames: wrtcParams.dataOutputNames,
            workflowsParameters: wrtcParams.workflowsParameters,
            iceServers: wrtcParams.iceServers,
            processingTimeout: wrtcParams.processingTimeout,
            requestedPlan: wrtcParams.requestedPlan,
            requestedRegion: wrtcParams.requestedRegion,
            realtimeProcessing: wrtcParams.realtimeProcessing,
        },
    });
    console.log(`[init-webrtc] worker siap dalam ${((Date.now() - startedAt) / 1000).toFixed(1)} dtk, pipeline ${answer.context?.pipeline_id ?? "-"}`);
    sendJson(res, 200, answer);
}

async function handleTurnConfig(res) {
    const iceServers = await client.fetchTurnConfig();
    sendJson(res, 200, { iceServers });
}

const server = http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, `http://${req.headers.host}`);
    try {
        if (req.method === "POST" && pathname === "/api/init-webrtc") return await handleInitWebrtc(req, res);
        if (req.method === "GET" && pathname === "/api/turn-config") return await handleTurnConfig(res);

        const file = req.method === "GET" && STATIC_FILES[pathname];
        if (file) {
            res.writeHead(200, { "Content-Type": file.type });
            return res.end(await readFile(new URL(file.path, import.meta.url)));
        }
        sendJson(res, 404, { message: "Not found" });
    } catch (err) {
        console.error(err);
        if (err instanceof WorkflowError) return sendJson(res, err.statusCode, err.errorData);
        sendJson(res, 500, { message: err.message ?? "Unknown error" });
    }
});

server.listen(PORT, () => {
    console.log(`Buka http://localhost:${PORT}`);
    console.log(`Workflow: ${WORKSPACE_NAME}/${WORKFLOW_ID}`);
});
