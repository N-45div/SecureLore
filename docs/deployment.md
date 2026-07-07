# SecureLore Deployment

SecureLore uses Vercel for the public HTTPS Slack endpoints. Cloudflare is not required for the hackathon submission path.

## Production Shape

```txt
Slack workspace
  -> Vercel HTTPS functions
    -> /api/slack/events
    -> /api/slack/commands
    -> /api/slack/actions
  -> SecureLore Bolt app
  -> Neon policy/review storage
  -> Cohere embeddings
  -> OpenRouter/Eve enrichment
```

Local development can still use Socket Mode by setting `SLACK_SOCKET_MODE=true` and `SLACK_APP_TOKEN`. Production should use HTTP mode with `SLACK_SOCKET_MODE=false`.

## Vercel Environment Variables

Set these in the Vercel project:

```txt
SLACK_BOT_TOKEN=
SLACK_SIGNING_SECRET=
SLACK_SOCKET_MODE=false
DATABASE_URL=
COHERE_API_KEY=
OPENROUTER_API_KEY=
OPENROUTER_MODEL=openai/gpt-4o-mini
```

`SLACK_APP_TOKEN` is only needed for local Socket Mode. Do not set it for the Vercel HTTP deployment unless you intentionally switch back to Socket Mode.

## Deploy

1. Import the GitHub repo into Vercel.
2. Use the repository root as the project root.
3. Keep the build command as `npm run build`.
4. Add the environment variables above.
5. Deploy.
6. Open `https://<vercel-domain>/api/health` and confirm it returns `{"ok":true,...}`.

## Slack App URLs

After deployment, replace `your-securelore-deployment.vercel.app` in `apps/slack/manifest.json` with the real Vercel domain.

Use these URLs in the Slack app settings:

```txt
Slash command /securelore:
https://<vercel-domain>/api/slack/commands

Event subscriptions:
https://<vercel-domain>/api/slack/events

Interactivity:
https://<vercel-domain>/api/slack/actions
```

Required bot scopes:

```txt
app_mentions:read
chat:write
commands
files:read
```

Required bot events:

```txt
app_mention
file_shared
```

## Judging Checklist

- Install the app into the Slack developer sandbox.
- Invite `slackhack@salesforce.com` and `testing@devpost.com` to the sandbox.
- Run `/securelore review` with a real Slack manifest.
- Upload a real manifest or MCP tools/list JSON and verify file ingestion.
- Confirm App Home shows review history.
- Capture the working Slack flow for the demo video.
