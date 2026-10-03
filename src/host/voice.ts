import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * Voice input. VS Code webviews cannot open the microphone, so the extension
 * host records a 16 kHz mono WAV with a platform recorder and sends it to an
 * OpenAI-style `/audio/transcriptions` endpoint (Azure AI Foundry / Azure
 * OpenAI Whisper or gpt-4o-transcribe deployments, OpenAI, Groq, local servers).
 */

export interface VoiceConfig {
    /** Full transcription URL, e.g. https://<res>.openai.azure.com/openai/deployments/<dep>/audio/transcriptions?api-version=2024-06-01 */
    url: string;
    apiKey: string;
    /** Sent as the `model` form field when set (OpenAI, Azure v1 endpoints). */
    model?: string;
    /** ISO-639-1 hint such as "en"; empty lets the model detect it. */
    language?: string;
}

/** Longest recording before it is stopped automatically. */
export const MAX_RECORDING_MS = 120_000;

// Windows has no recorder CLI, but winmm's MCI can record from PowerShell with no installs.
// The script records until a line arrives on stdin, then saves to $env:KOMIND_REC_FILE.
const WINDOWS_RECORDER = `
$ErrorActionPreference = 'Stop'
Add-Type -Namespace KoMind -Name Mci -MemberDefinition '[DllImport("winmm.dll", CharSet = CharSet.Unicode)] public static extern int mciSendString(string command, System.Text.StringBuilder returnValue, int returnLength, System.IntPtr hwndCallback);'
function Mci([string]$c, [bool]$must = $true) { $r = [KoMind.Mci]::mciSendString($c, $null, 0, [System.IntPtr]::Zero); if ($must -and $r -ne 0) { throw "MCI error $r on: $c" } }
Mci 'open new type waveaudio alias komindrec'
Mci 'set komindrec alignment 2 bitspersample 16 samplespersec 16000 channels 1 bytespersec 32000' $false
Mci 'record komindrec'
[Console]::Out.WriteLine('ready')
[void][Console]::In.ReadLine()
Mci ('save komindrec "' + $env:KOMIND_REC_FILE + '"')
Mci 'close komindrec'
`;

/**
 * Recorder process for this platform. Every variant stops cleanly when "q\n" is
 * written to stdin. `signalsReady` recorders print "ready" once audio is flowing.
 */
export function recorderCommand(file: string, platform: NodeJS.Platform = process.platform): { cmd: string; args: string[]; env?: Record<string, string>; signalsReady: boolean } {
    if (platform === "win32") {
        const encoded = Buffer.from(WINDOWS_RECORDER, "utf16le").toString("base64");
        return { cmd: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], env: { KOMIND_REC_FILE: file }, signalsReady: true };
    }
    // ponytail: macOS/Linux need ffmpeg on PATH; add sox/arecord fallbacks if users lack it
    const input = platform === "darwin" ? ["-f", "avfoundation", "-i", ":0"] : ["-f", "pulse", "-i", "default"];
    return { cmd: "ffmpeg", args: ["-hide_banner", "-loglevel", "error", ...input, "-ac", "1", "-ar", "16000", "-y", file], signalsReady: false };
}

export class Recorder {
    private proc?: cp.ChildProcess;
    private file = "";
    private stderr = "";
    private exited?: Promise<number>;

    get active(): boolean { return Boolean(this.proc); }

    /** Start recording; resolves once the microphone is live. */
    async start(): Promise<void> {
        if (this.proc) throw new Error("Already recording.");
        this.file = path.join(os.tmpdir(), `komind-voice-${Date.now()}.wav`);
        this.stderr = "";
        const { cmd, args, env, signalsReady } = recorderCommand(this.file);
        const proc = cp.spawn(cmd, args, { env: { ...process.env, ...env }, windowsHide: true });
        this.proc = proc;
        proc.stderr?.on("data", (d) => { this.stderr += d.toString(); });
        this.exited = new Promise((resolve) => {
            proc.on("error", (e) => {
                this.stderr += (e as NodeJS.ErrnoException).code === "ENOENT"
                    ? `${cmd} was not found.${cmd === "ffmpeg" ? " Install ffmpeg and make sure it is on PATH." : ""}`
                    : e.message;
                resolve(-1);
            });
            proc.on("exit", (code) => resolve(code ?? -1));
        });
        const ready = signalsReady
            ? new Promise<void>((resolve) => proc.stdout?.on("data", (d) => { if (d.toString().includes("ready")) resolve(); }))
            : new Promise<void>((resolve) => proc.on("spawn", () => resolve()));
        const failed = this.exited.then((code) => {
            if (this.proc !== proc) return; // stopped or cancelled meanwhile
            this.proc = undefined;
            throw new Error(`Could not start the microphone${this.stderr.trim() ? `: ${this.stderr.trim().slice(0, 400)}` : ` (exit code ${code}).`}`);
        });
        await Promise.race([ready, failed]);
    }

    /** Stop recording and return the WAV bytes. */
    async stop(): Promise<Buffer> {
        const proc = this.proc;
        if (!proc || !this.exited) throw new Error("Not recording.");
        proc.stdin?.end("q\n");
        const timeout = new Promise<number>((resolve) => setTimeout(() => { proc.kill(); resolve(-1); }, 10_000));
        const code = await Promise.race([this.exited, timeout]);
        this.proc = undefined;
        try {
            if (code !== 0 || !fs.existsSync(this.file)) {
                throw new Error(`Recording failed${this.stderr.trim() ? `: ${this.stderr.trim().slice(0, 400)}` : ` (exit code ${code}). Check that a microphone is connected and allowed.`}`);
            }
            return await fs.promises.readFile(this.file);
        } finally {
            fs.promises.rm(this.file, { force: true }).catch(() => { });
        }
    }

    /** Discard the recording. */
    cancel(): void {
        this.proc?.kill();
        this.proc = undefined;
        const file = this.file;
        // the recorder may still be flushing; remove the file once it has exited
        void this.exited?.then(() => fs.promises.rm(file, { force: true }).catch(() => { }));
    }
}

/** Azure endpoints authenticate with an `api-key` header; OpenAI-style ones with a bearer token. */
export function authHeaders(url: string, apiKey: string): Record<string, string> {
    let host = "";
    try { host = new URL(url).hostname; } catch { /* validated by the caller */ }
    return /\.azure\.(com|us|cn)$|cognitiveservices/i.test(host) ? { "api-key": apiKey } : { Authorization: `Bearer ${apiKey}` };
}

export async function transcribe(wav: Buffer, cfg: VoiceConfig, fetchImpl: typeof fetch = fetch): Promise<string> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "voice.wav");
    if (cfg.model) form.append("model", cfg.model);
    if (cfg.language) form.append("language", cfg.language);
    form.append("response_format", "json");
    const res = await fetchImpl(cfg.url, { method: "POST", headers: authHeaders(cfg.url, cfg.apiKey), body: form });
    if (!res.ok) {
        const body = (await res.text().catch(() => "")).slice(0, 300);
        throw new Error(`Transcription failed (HTTP ${res.status})${body ? `: ${body}` : ""}`);
    }
    const data = await res.json() as { text?: unknown };
    return String(data.text ?? "").trim();
}
