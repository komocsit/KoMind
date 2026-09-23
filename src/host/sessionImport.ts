import type { SessionEvent, ImageAttachment } from "../shared/protocol";

/** One conversation parsed from an external AI provider export. */
export interface ImportedConversation {
    /** Human-readable title used in the session list and QuickPick. */
    title: string;
    /** Detected source, e.g. "ChatGPT", "Claude", "Gemini", "OpenAI API". */
    provider: string;
    /** Normalized events ready to seed a KoMind session. */
    events: SessionEvent[];
    /** Original creation time in ms (falls back to now). */
    ts: number;
}

const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/** Internal, provider-agnostic message before it becomes a SessionEvent. */
interface RawMsg {
    role: "user" | "assistant";
    text: string;
    images?: ImageAttachment[];
}

/**
 * Parse an exported chat from another AI provider into one or more
 * conversations. Supports ChatGPT, Claude, Gemini, the OpenAI and Anthropic
 * API message shapes, generic role/content arrays, and plain-text transcripts.
 * Never throws — an unrecognized payload yields a best-effort transcript.
 */
export function parseImport(raw: string): ImportedConversation[] {
    const trimmed = raw.trim();
    if (!trimmed) return [];

    let data: unknown;
    try {
        data = JSON.parse(trimmed);
    } catch {
        // Not JSON — treat it as a copied transcript ("User: …\nAssistant: …").
        const transcript = parsePlainTranscript(trimmed);
        return transcript.events.length ? [transcript] : [];
    }

    const conversations = parseJson(data);
    return conversations.filter((c) => c.events.length > 0);
}

function parseJson(data: unknown): ImportedConversation[] {
    // ChatGPT full export is an array of conversation objects with a `mapping`.
    if (Array.isArray(data)) {
        // Claude.ai / ChatGPT exports, or a bare OpenAI/Anthropic messages array.
        if (data.length > 0 && looksLikeMessageArray(data)) {
            return [conversationFromMessages(data, "Imported chat", "Imported")];
        }
        const out: ImportedConversation[] = [];
        for (const item of data) {
            out.push(...parseJson(item));
        }
        return out;
    }

    if (!data || typeof data !== "object") return [];
    const obj = data as Record<string, unknown>;

    // ChatGPT: conversation tree keyed by node id.
    if (obj.mapping && typeof obj.mapping === "object") {
        return [parseChatGptMapping(obj)];
    }

    // Claude.ai export: { name, chat_messages: [...] }.
    if (Array.isArray(obj.chat_messages)) {
        return [parseClaudeExport(obj)];
    }

    // Gemini / Google AI: { contents: [{ role: "user"|"model", parts }] }.
    if (Array.isArray(obj.contents)) {
        return [parseGemini(obj)];
    }

    // OpenAI / Anthropic API request or response with a `messages` array.
    if (Array.isArray(obj.messages)) {
        const provider = typeof obj.system === "string" || Array.isArray(obj.system) ? "Anthropic API" : "OpenAI API";
        const msgs = [...(obj.messages as unknown[])];
        if (obj.system) msgs.unshift({ role: "system", content: obj.system });
        return [conversationFromMessages(msgs, titleOf(obj), provider)];
    }

    // OpenAI chat completion response: { choices: [{ message }] }.
    if (Array.isArray(obj.choices)) {
        const msgs = (obj.choices as Record<string, unknown>[])
            .map((c) => c.message)
            .filter(Boolean);
        return [conversationFromMessages(msgs, "Imported chat", "OpenAI API")];
    }

    // A single message object.
    if (obj.role || obj.author || obj.sender) {
        return [conversationFromMessages([obj], "Imported chat", "Imported")];
    }

    return [];
}

/* ---------- Provider-specific parsers ---------- */

function parseChatGptMapping(conv: Record<string, unknown>): ImportedConversation {
    const mapping = conv.mapping as Record<string, ChatGptNode>;
    // Find the root node (no parent) and walk children depth-first in order.
    const root = Object.values(mapping).find((n) => !n.parent);
    const ordered: ChatGptNode[] = [];
    const visit = (id: string | undefined) => {
        if (!id) return;
        const node = mapping[id];
        if (!node) return;
        if (node.message) ordered.push(node);
        for (const child of node.children ?? []) visit(child);
    };
    if (root) visit(root.id);
    else for (const node of Object.values(mapping)) if (node.message) ordered.push(node);

    const raws: RawMsg[] = [];
    for (const node of ordered) {
        const msg = node.message!;
        const role = normalizeRole(msg.author?.role);
        if (!role) continue;
        const parts = msg.content?.parts;
        const text = Array.isArray(parts)
            ? parts.map(partText).filter(Boolean).join("\n")
            : typeof msg.content?.text === "string" ? msg.content.text : "";
        raws.push(applyRolePrefix(msg.author?.role, role, text));
    }

    const ts = typeof conv.create_time === "number" ? conv.create_time * 1000 : Date.now();
    return { title: titleOf(conv), provider: "ChatGPT", events: toEvents(raws), ts };
}

function parseClaudeExport(conv: Record<string, unknown>): ImportedConversation {
    const msgs = conv.chat_messages as Record<string, unknown>[];
    const raws: RawMsg[] = [];
    for (const m of msgs) {
        const role = normalizeRole(String(m.sender ?? m.role ?? ""));
        if (!role) continue;
        const { text, images } = normalizeContent(m.content ?? m.text ?? "");
        raws.push({ role, text: text || String(m.text ?? ""), images });
    }
    const ts = parseTime(conv.created_at) ?? Date.now();
    return { title: titleOf(conv), provider: "Claude", events: toEvents(raws), ts };
}

function parseGemini(conv: Record<string, unknown>): ImportedConversation {
    const contents = conv.contents as Record<string, unknown>[];
    const raws: RawMsg[] = [];
    for (const c of contents) {
        const role = normalizeRole(String(c.role ?? ""));
        if (!role) continue;
        const { text, images } = normalizeContent(c.parts ?? "");
        raws.push({ role, text, images });
    }
    return { title: titleOf(conv), provider: "Gemini", events: toEvents(raws), ts: Date.now() };
}

function conversationFromMessages(msgs: unknown[], title: string, provider: string): ImportedConversation {
    const raws: RawMsg[] = [];
    for (const entry of msgs) {
        if (!entry || typeof entry !== "object") continue;
        const m = entry as Record<string, unknown>;
        const rawRole = m.role ?? (m.author as Record<string, unknown>)?.role ?? m.sender;
        const role = normalizeRole(String(rawRole ?? ""));
        if (!role) continue;
        const { text, images } = normalizeContent(m.content ?? m.text ?? m.parts ?? "");
        raws.push(applyRolePrefix(String(rawRole ?? ""), role, text, images));
    }
    return { title, provider, events: toEvents(raws), ts: Date.now() };
}

function parsePlainTranscript(raw: string): ImportedConversation {
    // Split on speaker labels at the start of a line: "User:", "Assistant:",
    // "Human:", "AI:", "ChatGPT:", "Claude:", "Gemini:", "System:".
    const labelRe = /^(?:###\s*)?(user|assistant|human|ai|system|chatgpt|claude|gemini|bot|model)\s*:\s*/i;
    const lines = raw.split(/\r?\n/);
    const raws: RawMsg[] = [];
    let current: { rawRole: string; role: "user" | "assistant"; buf: string[] } | null = null;
    const flush = () => {
        if (current && current.buf.join("\n").trim()) {
            raws.push(applyRolePrefix(current.rawRole, current.role, current.buf.join("\n").trim()));
        }
    };
    for (const line of lines) {
        const match = line.match(labelRe);
        if (match) {
            flush();
            const rawRole = match[1].toLowerCase();
            const role = normalizeRole(rawRole) ?? "user";
            current = { rawRole, role, buf: [line.slice(match[0].length)] };
        } else if (current) {
            current.buf.push(line);
        } else {
            // Text before any label — treat as an opening user message.
            current = { rawRole: "user", role: "user", buf: [line] };
        }
    }
    flush();
    return { title: "Imported transcript", provider: "Transcript", events: toEvents(raws), ts: Date.now() };
}

/* ---------- Shared helpers ---------- */

interface ChatGptNode {
    id: string;
    parent?: string;
    children?: string[];
    message?: {
        author?: { role?: string };
        content?: { parts?: unknown[]; text?: string; content_type?: string };
    };
}

function looksLikeMessageArray(arr: unknown[]): boolean {
    return arr.every((x) => {
        if (!x || typeof x !== "object") return false;
        const o = x as Record<string, unknown>;
        return "role" in o || "author" in o || "sender" in o;
    });
}

function normalizeRole(role: string | undefined): "user" | "assistant" | null {
    const r = (role ?? "").toLowerCase().trim();
    if (["user", "human"].includes(r)) return "user";
    if (["assistant", "model", "ai", "bot", "gpt", "chatgpt", "claude", "gemini"].includes(r)) return "assistant";
    // System, developer, tool, and function messages fold into the user side so
    // the model still sees them as context on resume.
    if (["system", "developer", "tool", "function"].includes(r)) return "user";
    return null;
}

/** Prefix system/tool content so its origin stays clear after the role fold. */
function applyRolePrefix(rawRole: string | undefined, role: "user" | "assistant", text: string, images?: ImageAttachment[]): RawMsg {
    const r = (rawRole ?? "").toLowerCase().trim();
    if (r === "system" || r === "developer") return { role, text: text ? `System instructions:\n${text}` : text, images };
    if (r === "tool" || r === "function") return { role, text: text ? `Tool result:\n${text}` : text, images };
    return { role, text, images };
}

function partText(part: unknown): string {
    if (typeof part === "string") return part;
    if (part && typeof part === "object") {
        const p = part as Record<string, unknown>;
        if (typeof p.text === "string") return p.text;
        if (typeof p.content_type === "string" && p.content_type.includes("image")) return "[image]";
    }
    return "";
}

/** Extract text and any base64 images from a content field of any shape. */
function normalizeContent(content: unknown): { text: string; images: ImageAttachment[] } {
    if (typeof content === "string") return { text: content, images: [] };
    if (!Array.isArray(content)) {
        if (content && typeof content === "object") {
            const o = content as Record<string, unknown>;
            if (Array.isArray(o.parts)) return normalizeContent(o.parts);
            if (typeof o.text === "string") return { text: o.text, images: [] };
        }
        return { text: "", images: [] };
    }

    const texts: string[] = [];
    const images: ImageAttachment[] = [];
    for (const item of content) {
        if (typeof item === "string") { texts.push(item); continue; }
        if (!item || typeof item !== "object") continue;
        const b = item as Record<string, unknown>;
        const type = String(b.type ?? "");

        if (type === "text" || type === "input_text" || type === "output_text") {
            if (typeof b.text === "string") texts.push(b.text);
        } else if (type === "tool_use") {
            texts.push(`[tool call: ${String(b.name ?? "tool")}(${safeJson(b.input)})]`);
        } else if (type === "tool_result") {
            const inner = normalizeContent(b.content ?? "");
            texts.push(`[tool result: ${inner.text}]`);
        } else if (type === "image") {
            const image = imageFromBlock(b.source);
            if (image) images.push(image);
            else texts.push("[image]");
        } else if (type === "image_url" || b.image_url) {
            texts.push("[image]");
        } else if (typeof b.text === "string") {
            texts.push(b.text);
        }
    }
    return { text: texts.filter(Boolean).join("\n"), images };
}

function imageFromBlock(source: unknown): ImageAttachment | null {
    if (!source || typeof source !== "object") return null;
    const s = source as Record<string, unknown>;
    const mediaType = String(s.media_type ?? "");
    const data = typeof s.data === "string" ? s.data : "";
    if (s.type === "base64" && data && SUPPORTED_IMAGE_TYPES.has(mediaType)) {
        return { name: "imported-image", mediaType: mediaType as ImageAttachment["mediaType"], data };
    }
    return null;
}

function safeJson(value: unknown): string {
    try {
        const s = JSON.stringify(value ?? {});
        return s.length > 200 ? s.slice(0, 200) + "…" : s;
    } catch {
        return "";
    }
}

/** Merge consecutive same-role messages and emit alternating SessionEvents. */
function toEvents(msgs: RawMsg[]): SessionEvent[] {
    const merged: RawMsg[] = [];
    for (const m of msgs) {
        const hasContent = Boolean(m.text) || Boolean(m.images && m.images.length);
        if (!hasContent) continue;
        const last = merged[merged.length - 1];
        if (last && last.role === m.role) {
            last.text = [last.text, m.text].filter(Boolean).join("\n\n");
            last.images = [...(last.images ?? []), ...(m.images ?? [])];
        } else {
            merged.push({ role: m.role, text: m.text, images: m.images ? [...m.images] : undefined });
        }
    }
    const now = Date.now();
    return merged.map((m, i): SessionEvent =>
        m.role === "user"
            ? { kind: "user", text: m.text, ts: now + i, images: m.images && m.images.length ? m.images : undefined }
            : { kind: "assistantText", text: m.text, ts: now + i }
    );
}

function titleOf(obj: Record<string, unknown>): string {
    const t = obj.title ?? obj.name ?? obj.subject;
    return typeof t === "string" && t.trim() ? t.trim() : "Imported chat";
}

function parseTime(value: unknown): number | undefined {
    if (typeof value === "number") return value > 1e12 ? value : value * 1000;
    if (typeof value === "string") {
        const ms = Date.parse(value);
        if (!Number.isNaN(ms)) return ms;
    }
    return undefined;
}

