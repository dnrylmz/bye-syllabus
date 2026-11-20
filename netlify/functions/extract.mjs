// Bye Syllabus — reads a syllabus with Claude and streams the JSON answer back.
// The Anthropic API key lives only here, in the ANTHROPIC_API_KEY environment variable.
// The prompt is built on the server, so this endpoint can't be used as a free general-purpose Claude proxy.

const MODEL_DEFAULT = "claude-sonnet-5-5";
const MAX_TEXT = 150_000;      // characters of syllabus text
const MAX_IMAGES = 4;          // scanned pages
const MAX_IMAGE_B64 = 2_000_000; // ~1.5 MB per page

function buildPrompt(text, start, today, hasImages) {
  return `You extract structured data from a university course syllabus.
Today is ${today}. ${start ? `The lecture period starts on ${start} (Week 1 = that week).` : "No semester start date was given."}
Reply with ONLY one JSON object of this shape:
{"course":{"title":string,"code":string|null,"instructor":string|null,"email":string|null,"office_hours":string|null,"room":string|null,"platform":string|null,"language":string|null,"credits":string|null},
"contacts":[{"name":string,"role":string,"email":string|null}],
"grading":[{"component":string,"weight":string}],
"notes":[string],
"materials":[string],
"items":[{"title":string,"type":"exam"|"assignment"|"presentation"|"project"|"quiz"|"lecture"|"other","date":"YYYY-MM-DD"|null,"time":"HH:MM"|null,"notes":string|null,"source":string,"confidence":"high"|"medium"|"low"}]}
Rules:
- Write titles and notes in English even if the syllabus is in German, Turkish or another language. Keep names, emails and rooms exactly as written.
- Look hard for every email address and contact person (instructor, tutors, assistants, secretary) anywhere in the document.
- platform = where materials/submissions live (e.g. ILIAS, Moodle) incl. course link if given.
- notes = up to 8 short, useful facts a student should remember: attendance, late work, AI use, group work, exam format & allowed aids, exam registration, pass requirements.
- materials = required readings/books, max 6.
- items = every graded or due thing (exams, assignments, presentations, projects, quizzes; registration deadlines as "other") plus dated lecture sessions as "lecture" (max 20).
- Set "date" only when the syllabus states it, or it can be computed from a week/session number and the start date (then confidence "medium" and explain how in notes). Never invent dates: unknown → null.
- If the year is missing, use the occurrence that fits the current semester.
- "source" = the exact sentence from the syllabus that supports the item, in its original language, max 25 words.
${hasImages ? "The syllabus pages are attached as images." : ""}
SYLLABUS:
<<<
${text}
>>>`;
}

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const key = Netlify.env.get("ANTHROPIC_API_KEY");
  if (!key) return json(500, { error: "missing_api_key", message: "ANTHROPIC_API_KEY is not set in Netlify." });

  // Optional invite code: set ACCESS_CODE in Netlify to limit who can use your credits.
  const code = Netlify.env.get("ACCESS_CODE");
  if (code && req.headers.get("x-access-code") !== code) return json(401, { error: "access_code" });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "bad_request" }); }

  const text = String(body.text || "").slice(0, MAX_TEXT);
  const start = /^\d{4}-\d\d-\d\d$/.test(body.start || "") ? body.start : null;
  const today = /^\d{4}-\d\d-\d\d$/.test(body.today || "") ? body.today : new Date().toISOString().slice(0, 10);
  const images = (Array.isArray(body.images) ? body.images : [])
    .slice(0, MAX_IMAGES)
    .filter((im) => im && /^image\/(jpeg|png|webp)$/.test(im.media_type) && typeof im.data === "string" && im.data.length <= MAX_IMAGE_B64);
  if (!text.trim() && !images.length) return json(400, { error: "empty" });

  const content = [
    ...images.map((im) => ({ type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } })),
    { type: "text", text: buildPrompt(text, start, today, images.length > 0) },
  ];

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: Netlify.env.get("MODEL") || MODEL_DEFAULT,
      max_tokens: 8000,
      stream: true,
      messages: [{ role: "user", content }],
    }),
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    console.error("Anthropic error", upstream.status, detail.slice(0, 500));
    return json(upstream.status === 429 ? 429 : 502, { error: upstream.status === 429 ? "rate_limited" : "upstream_error" });
  }

  // Turn Anthropic's server-sent events into a plain stream of answer text,
  // so the connection stays alive while Claude writes (Netlify cuts silent requests).
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body.getReader();
      let buf = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (!line.startsWith("data:")) continue;
            try {
              const ev = JSON.parse(line.slice(5));
              if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") controller.enqueue(enc.encode(ev.delta.text));
              if (ev.type === "error") controller.enqueue(enc.encode("\n__ERROR__"));
            } catch { /* ignore partial lines */ }
          }
        }
      } catch (e) {
        controller.enqueue(enc.encode("\n__ERROR__"));
      }
      controller.close();
    },
  });

  return new Response(stream, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
};

export const config = { path: "/api/extract" };
