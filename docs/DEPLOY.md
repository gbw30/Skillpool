# Deploying the hosted demo

These steps put the demo online at no hosting cost, with model spend capped at about $5 a
month. The demo uses one shared dataset, already loaded in AuraDB Free, with uploads off.
The reasons behind each setting are in README.md, section "Deploy".

| Part | Where | Cost |
|---|---|---|
| Web app (`web/`) | Vercel Hobby | Free |
| Service (`service/Dockerfile`) | Render, Free web service | Free |
| Graph | Neo4j AuraDB Free (already loaded) | Free |
| Claude and Voyage calls | Anthropic, Voyage through MongoDB Atlas | Well under a cent a search, capped in step 1 |

Do the steps in order. Steps marked **(owner)** need your accounts, and Claude never sees the
values they produce. Never paste a key or secret into a chat, a commit or an issue.

## 1. Set the spend limits (owner)

Do this first, so nothing can run up a bill while you deploy.

1. **Anthropic.** In the Claude Console, open your organization's settings, then **Limits**
   (on some accounts it is under **Billing**, then **Spend limits**). Set the monthly
   organization limit to **$5**. Calls stop when it is reached, until the next month.
2. **Voyage (MongoDB Atlas).** Atlas documents no hard spending cap for model API keys. Set a
   **billing alert** instead: in Atlas, open the organization, then **Alerts**, and add a
   billing alert for an amount above **$5**. Embedding a search question costs a tiny fraction
   of a cent, so this is a guard against a leaked key, not against normal use. Also check
   whether your plan lets Voyage use API inputs to train its models, and turn that off if it
   does: the privacy page tells visitors that their questions go to Voyage.
3. **AWS.** In **Billing and Cost Management**, open **Budgets** and create a monthly cost
   budget of **$5** with email alerts at 80% and 100%. A budget only sends alerts. It does not
   stop spending. With uploads off the hosted demo does not use AWS at all; the alert covers
   the bucket's storage and anything else on the account.
4. **The app's own cap.** The service stops calling Claude and Voyage for the rest of the day
   once its daily total reaches `DAILY_MODEL_BUDGET_USD` (default 5). Step 4 sets it to **0.50**,
   so one busy day cannot use the whole month's $5. The total is stored in the graph, so a
   restart does not reset it.

## 2. Make the secrets (owner)

On your own computer, make three different values and keep them in your password manager:

```bash
openssl rand -base64 18   # SITE_ACCESS_CODE: the code you give recruiters
openssl rand -hex 32      # SERVICE_SIGNING_SECRET: set on both the service and the web app
openssl rand -base64 24   # UPLOAD_ACCESS_CODE: unused while uploads are off, set it anyway
```

## 3. Wake the database (owner)

AuraDB Free pauses after 72 hours with no activity and is deleted after 30 days paused. In the
[Aura console](https://console.neo4j.io), make sure the instance is **Running**, and resume it
if not. The service's connection details are in the credentials file you downloaded when the
instance was made (`NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`).

Once per database, and again after an update that adds a database rule (the daily search count
did, on 2026-11-16), run from `service/`. It changes no data:

```bash
uv run --env-file .env --env-file <aura file> skillpool init-db
```

## 4. Deploy the service on Render (owner)

Render's free web services need no payment card. They stop after 15 minutes with no requests
and take about a minute to start again; step 6 keeps the service awake.

1. Sign in at [render.com](https://render.com) with GitHub and choose **New**, then
   **Web Service**. Pick the repository `gbw30/Skillpool`.
2. Settings:
   - **Language:** Docker
   - **Branch:** `main`
   - **Root Directory:** `service`
   - **Dockerfile Path:** `./Dockerfile`
   - **Instance Type:** Free
   - **Health Check Path:** `/healthz`
3. **Environment variables** (Render sets `PORT` itself, and the image listens on it):

   | Name | Value |
   |---|---|
   | `ANTHROPIC_API_KEY` | your Anthropic key |
   | `VOYAGE_API_KEY` | your Voyage key (starts with `al-`) |
   | `EMBED_PROVIDER` | `voyage` |
   | `NEO4J_URI` | from the AuraDB credentials file (`neo4j+s://...`) |
   | `NEO4J_USERNAME` | from the same file |
   | `NEO4J_PASSWORD` | from the same file |
   | `SERVICE_SIGNING_SECRET` | the value from step 2 |
   | `SOURCE_BASE_URL` | `https://github.com/gbw30/Skillpool/blob/main/corpus` |
   | `DAILY_MODEL_BUDGET_USD` | `0.50` |
   | `SEARCH_RATE_PER_MIN` | `5` (searches per visitor per minute) |
   | `SEARCH_RATE_TOTAL_PER_MIN` | `20` (searches per minute for everyone together) |
   | `SEARCH_RATE_PER_DAY` | `20` (searches per visitor per day, counted in AuraDB; the default) |

   Leave the `S3_*` and `AWS_*` variables out: they are only used for uploads.
4. Create the service and wait for the first deploy. Open
   `https://<your-service>.onrender.com/healthz`. It must show `{"ok":true,"database":true}`.
   `"database":false` means the AuraDB values are wrong or the instance is paused.

The service checks a signature on every request except `/healthz`, so its address can be
public. Only the web app holds the signing secret.

## 5. Deploy the web app on Vercel (owner)

1. Sign in at [vercel.com](https://vercel.com) with GitHub, choose **Add New**, then
   **Project**, and import `gbw30/Skillpool`.
2. Set **Root Directory** to `web`. Vercel detects Next.js.
3. **Environment variables**, before the first deploy (whether upload links show is decided
   when the site is built):

   | Name | Value |
   |---|---|
   | `SERVICE_URL` | `https://<your-service>.onrender.com` (must be `https://`) |
   | `SERVICE_SIGNING_SECRET` | the same value as the service's |
   | `SITE_ACCESS_CODE` | the access code from step 2 |
   | `UPLOADS_ENABLED` | `false` |
   | `UPLOAD_ACCESS_CODE` | the upload code from step 2 |

4. Deploy. Changing a variable later needs a **Redeploy** to take effect.

An update that changes the access cookie (2026-11-16 did) signs everyone out once.

## 5b. Turn on security reports (owner)

On GitHub, open the repository's **Settings**, then **Advanced Security** (or **Code security**),
and enable **Private vulnerability reporting**. The site's `/.well-known/security.txt`, the
footer and `SECURITY.md` send reports there; without it, the link shows a 404. The
`security.txt` file expires on 2027-11-16: move its `Expires` date forward before then.

## 6. Keep the service awake (owner, optional)

A free Render service that has been idle answers its first request about a minute late. The
home page then says "Waking the index" and waits up to a minute; only if the service is still
not answering does it show the made-up sample graph. To skip the wait, have a free uptime monitor (for example UptimeRobot or cron-job.org) request
`https://<your-service>.onrender.com/healthz` every 10 minutes.

- **Hours:** one service awake all month uses about 744 of Render's 750 free hours. Do not add
  a second free service to the same workspace, or both stop for the rest of the month when
  the hours run out.
- **AuraDB:** each check also runs a small query on AuraDB, which should keep it from pausing.
  Check in the Aura console after three days that it is still running.

Without the monitor, open the site a minute before a demo to wake it.

## 7. Check the live site

1. Open the Vercel address. You get the access page. Enter the access code.
2. The home page says **Indexed** with 143 people, and the brain lights a path under the
   question.
3. Search "Who has hands-on experience with Kafka?". People appear with quoted passages, and
   the short answer is written out.
4. Click **Open source** on a passage. It opens the document in the corpus folder on GitHub.
5. Open `/upload`. It sends you back to the home page.
6. In a private window, without the code, open `/privacy`, `/robots.txt` and
   `/.well-known/security.txt`. Each loads; any other page sends you to the access page.
7. In the Claude Console, check the usage for the day: a few searches cost under a cent.

Give recruiters the Vercel address, the access code, and the corpus link
(`https://github.com/gbw30/Skillpool/tree/main/corpus`), so they can read the documents the
answers come from.

## If something is wrong

| What you see | Likely cause |
|---|---|
| The access page never lets you in | `SITE_ACCESS_CODE` is not set on Vercel, or was changed without a redeploy |
| "Index unreachable · showing a sample" | The service is asleep or down, `SERVICE_URL` is wrong, or the two signing secrets differ |
| `/healthz` shows `"database":false` | AuraDB is paused, or a `NEO4J_*` value is wrong |
| "Today's search budget is used up." | The day's `DAILY_MODEL_BUDGET_USD` is used up; it resets at midnight on the server's clock (UTC on Render) |
| Searches fail every time, with no budget message | The Anthropic monthly limit is reached, or a key is wrong; the service's log on Render shows which |
| "Open source" answers 404 | `SOURCE_BASE_URL` is missing on the service |
