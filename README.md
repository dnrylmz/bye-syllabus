# Bye Syllabus

Drop in a syllabus (PDF or Word), get your deadlines, course info and calendar reminders.

- **Review** every extracted item next to the exact line from the syllabus.
- **Reminders & export**: choose how many days before each kind of deadline you want a reminder, then download an `.ics` file with the reminders built in. Items already added are never exported twice.
- **My courses**: instructor, emails, office hours, grading, key rules and your own notes — plus a *Due soon* list.

Data stays in the user's browser (localStorage). The syllabus text is sent to Claude through a Netlify Function to be read.

## Deploy on Netlify

1. Netlify → **Add new site → Import an existing project** → pick this GitHub repo. No build command, publish directory `.`.
2. **Site configuration → Environment variables**, add:
   - `ANTHROPIC_API_KEY` — your key from console.anthropic.com (required)
   - `ACCESS_CODE` — optional invite code; if set, users must enter it before their first upload
   - `MODEL` — optional, defaults to `claude-sonnet-5-5`
3. Redeploy. Done.

## Costs

Every syllabus read is one call to the Anthropic API, billed to the key above. Set a monthly spend limit in the Anthropic Console.

## Files

- `index.html` — the whole app (no build step)
- `netlify/functions/extract.mjs` — server function that holds the API key, builds the prompt and streams Claude's answer back
