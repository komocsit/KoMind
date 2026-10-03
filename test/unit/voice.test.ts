import { describe, it, expect, vi } from "vitest";
import { authHeaders, recorderCommand, transcribe } from "../../src/host/voice";

describe("authHeaders", () => {
  it("uses api-key for Azure AI Foundry / Azure OpenAI hosts", () => {
    expect(authHeaders("https://res.openai.azure.com/openai/deployments/w/audio/transcriptions?api-version=2024-06-01", "k")).toEqual({ "api-key": "k" });
    expect(authHeaders("https://res.cognitiveservices.azure.com/openai/deployments/w/audio/transcriptions", "k")).toEqual({ "api-key": "k" });
    expect(authHeaders("https://proj.services.ai.azure.com/openai/v1/audio/transcriptions", "k")).toEqual({ "api-key": "k" });
  });
  it("uses a bearer token elsewhere", () => {
    expect(authHeaders("https://api.openai.com/v1/audio/transcriptions", "k")).toEqual({ Authorization: "Bearer k" });
  });
});

describe("recorderCommand", () => {
  it("records with built-in PowerShell on Windows and passes the file via env", () => {
    const c = recorderCommand("C:\\tmp\\a b.wav", "win32");
    expect(c.cmd).toBe("powershell.exe");
    expect(c.env).toEqual({ KOMIND_REC_FILE: "C:\\tmp\\a b.wav" });
    expect(c.signalsReady).toBe(true);
  });
  it("uses ffmpeg with the platform's capture device elsewhere", () => {
    expect(recorderCommand("/t/a.wav", "darwin").args).toContain("avfoundation");
    expect(recorderCommand("/t/a.wav", "linux").args).toContain("pulse");
  });
});

describe("transcribe", () => {
  it("posts the WAV as multipart and returns the trimmed text", async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const form = init!.body as FormData;
      expect(form.get("model")).toBe("whisper");
      expect(form.get("language")).toBe("en");
      expect((form.get("file") as File).name).toBe("voice.wav");
      return new Response(JSON.stringify({ text: "  fix the login bug \n" }), { status: 200 });
    });
    const text = await transcribe(Buffer.from("RIFF"), { url: "https://res.openai.azure.com/x", apiKey: "k", model: "whisper", language: "en" }, fetchImpl as unknown as typeof fetch);
    expect(text).toBe("fix the login bug");
    expect((fetchImpl.mock.calls[0][1] as RequestInit).headers).toEqual({ "api-key": "k" });
  });
  it("omits empty optional fields", async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const form = init!.body as FormData;
      expect(form.has("model")).toBe(false);
      expect(form.has("language")).toBe(false);
      return new Response(JSON.stringify({ text: "hi" }), { status: 200 });
    });
    await transcribe(Buffer.from("RIFF"), { url: "https://api.openai.com/v1/audio/transcriptions", apiKey: "k" }, fetchImpl as unknown as typeof fetch);
  });
  it("surfaces HTTP errors with the response body", async () => {
    const fetchImpl = async () => new Response("DeploymentNotFound", { status: 404 });
    await expect(transcribe(Buffer.from("RIFF"), { url: "https://res.openai.azure.com/x", apiKey: "k" }, fetchImpl as unknown as typeof fetch))
      .rejects.toThrow("HTTP 404): DeploymentNotFound");
  });
});
