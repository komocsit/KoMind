import { describe, it, expect } from "vitest";
import { parseImport } from "../../src/host/sessionImport";

describe("parseImport", () => {
    it("parses an OpenAI chat completion request (messages array)", () => {
        const raw = JSON.stringify({
            model: "gpt-4o",
            messages: [
                { role: "system", content: "You are helpful." },
                { role: "user", content: "Fix the login bug" },
                { role: "assistant", content: "Sure, let me look at the auth code." },
                { role: "user", content: "Thanks" },
            ],
        });
        const [conv] = parseImport(raw);
        expect(conv.provider).toBe("OpenAI API");
        expect(conv.events[0]).toMatchObject({ kind: "user" });
        expect(conv.events[0].kind === "user" && conv.events[0].text).toContain("System instructions:");
        expect(conv.events[0].kind === "user" && conv.events[0].text).toContain("Fix the login bug");
        expect(conv.events[1]).toMatchObject({ kind: "assistantText", text: "Sure, let me look at the auth code." });
        expect(conv.events[2]).toMatchObject({ kind: "user", text: "Thanks" });
    });

    it("parses an Anthropic messages request with block content", () => {
        const raw = JSON.stringify({
            model: "claude-sonnet-4-5",
            system: "Be concise.",
            messages: [
                { role: "user", content: [{ type: "text", text: "Refactor this" }] },
                { role: "assistant", content: [{ type: "text", text: "Done." }] },
            ],
        });
        const [conv] = parseImport(raw);
        expect(conv.provider).toBe("Anthropic API");
        expect(conv.events[0].kind === "user" && conv.events[0].text).toContain("Be concise.");
        expect(conv.events[0].kind === "user" && conv.events[0].text).toContain("Refactor this");
        expect(conv.events[1]).toMatchObject({ kind: "assistantText", text: "Done." });
    });

    it("parses a ChatGPT export with a mapping tree", () => {
        const raw = JSON.stringify([{
            title: "Bug hunt",
            create_time: 1_700_000_000,
            mapping: {
                root: { id: "root", parent: null, children: ["a"] },
                a: { id: "a", parent: "root", children: ["b"], message: { author: { role: "user" }, content: { content_type: "text", parts: ["Why does X crash?"] } } },
                b: { id: "b", parent: "a", children: [], message: { author: { role: "assistant" }, content: { content_type: "text", parts: ["Because of a null deref."] } } },
            },
        }]);
        const [conv] = parseImport(raw);
        expect(conv.provider).toBe("ChatGPT");
        expect(conv.title).toBe("Bug hunt");
        expect(conv.events[0]).toMatchObject({ kind: "user", text: "Why does X crash?" });
        expect(conv.events[1]).toMatchObject({ kind: "assistantText", text: "Because of a null deref." });
    });

    it("parses a Claude.ai export with chat_messages", () => {
        const raw = JSON.stringify({
            name: "Session about parsers",
            created_at: "2024-01-01T00:00:00Z",
            chat_messages: [
                { sender: "human", text: "Write a parser" },
                { sender: "assistant", content: [{ type: "text", text: "Here is one." }] },
            ],
        });
        const [conv] = parseImport(raw);
        expect(conv.provider).toBe("Claude");
        expect(conv.title).toBe("Session about parsers");
        expect(conv.events[0]).toMatchObject({ kind: "user", text: "Write a parser" });
        expect(conv.events[1]).toMatchObject({ kind: "assistantText", text: "Here is one." });
    });

    it("parses a Gemini contents array (user/model roles)", () => {
        const raw = JSON.stringify({
            contents: [
                { role: "user", parts: [{ text: "Summarize this repo" }] },
                { role: "model", parts: [{ text: "It is a VS Code extension." }] },
            ],
        });
        const [conv] = parseImport(raw);
        expect(conv.provider).toBe("Gemini");
        expect(conv.events[0]).toMatchObject({ kind: "user", text: "Summarize this repo" });
        expect(conv.events[1]).toMatchObject({ kind: "assistantText", text: "It is a VS Code extension." });
    });

    it("parses a plain-text transcript with speaker labels", () => {
        const raw = [
            "User: How do I add pagination?",
            "Assistant: Add limit and offset params.",
            "It returns metadata too.",
            "User: Great, thanks",
        ].join("\n");
        const [conv] = parseImport(raw);
        expect(conv.provider).toBe("Transcript");
        expect(conv.events).toHaveLength(3);
        expect(conv.events[0]).toMatchObject({ kind: "user", text: "How do I add pagination?" });
        expect(conv.events[1].kind === "assistantText" && conv.events[1].text).toContain("limit and offset");
        expect(conv.events[1].kind === "assistantText" && conv.events[1].text).toContain("metadata too");
        expect(conv.events[2]).toMatchObject({ kind: "user", text: "Great, thanks" });
    });

    it("merges consecutive same-role messages", () => {
        const raw = JSON.stringify({
            messages: [
                { role: "user", content: "part one" },
                { role: "user", content: "part two" },
                { role: "assistant", content: "reply" },
            ],
        });
        const [conv] = parseImport(raw);
        expect(conv.events).toHaveLength(2);
        expect(conv.events[0].kind === "user" && conv.events[0].text).toBe("part one\n\npart two");
    });

    it("extracts base64 images from Anthropic image blocks", () => {
        const raw = JSON.stringify({
            messages: [
                {
                    role: "user", content: [
                        { type: "text", text: "What is this?" },
                        { type: "image", source: { type: "base64", media_type: "image/png", data: "aW1hZ2U=" } },
                    ]
                },
            ],
        });
        const [conv] = parseImport(raw);
        const first = conv.events[0];
        expect(first.kind).toBe("user");
        expect(first.kind === "user" && first.images).toEqual([
            { name: "imported-image", mediaType: "image/png", data: "aW1hZ2U=" },
        ]);
    });

    it("returns an empty array for empty or meaningless input", () => {
        expect(parseImport("")).toEqual([]);
        expect(parseImport("   ")).toEqual([]);
        expect(parseImport("{}")).toEqual([]);
    });

    it("splits a multi-conversation ChatGPT export into separate conversations", () => {
        const conv = (title: string, q: string, a: string) => ({
            title,
            mapping: {
                r: { id: "r", parent: null, children: ["u"] },
                u: { id: "u", parent: "r", children: ["m"], message: { author: { role: "user" }, content: { parts: [q] } } },
                m: { id: "m", parent: "u", children: [], message: { author: { role: "assistant" }, content: { parts: [a] } } },
            },
        });
        const raw = JSON.stringify([conv("First", "q1", "a1"), conv("Second", "q2", "a2")]);
        const result = parseImport(raw);
        expect(result).toHaveLength(2);
        expect(result[0].title).toBe("First");
        expect(result[1].title).toBe("Second");
    });
});

