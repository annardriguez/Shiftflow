# Put ShiftFlow online (free, on Hugging Face Spaces)

This publishes a **demo** of ShiftFlow at a public web address you can send to anyone. It runs the whole app (website, scheduling engine and database) in one container on Hugging Face's free plan.

What to expect from the free demo:

- **It starts fresh every time.** The demo team and a valid roster are created automatically when it starts. Changes people make are kept until the Space restarts or goes to sleep, then reset.
- **It sleeps when nobody uses it.** After about two days without visitors it pauses. The next visitor waits a minute or two while it wakes up.
- **Anyone with the link and the demo password can sign in.** Only use it with the fictional demo team, never with real employee details.

## One-time setup (about 15 minutes)

### 1. Create the Space on Hugging Face

1. Sign up for free at [huggingface.co](https://huggingface.co/join).
2. Click your profile picture → **New Space**.
3. Fill in:
   - **Space name:** `shiftflow`
   - **SDK:** Docker → **Blank**
   - **Hardware:** CPU basic (free)
   - **Visibility:** Public (so your manager doesn't need an account)
4. Click **Create Space**.

### 2. Choose the demo password

In the new Space, open **Settings** → **Variables and secrets** → **New secret**:

- **Name:** `SHIFTFLOW_DEMO_PASSWORD`
- **Value:** a password of at least 12 characters. Every demo account uses it.

### 3. Let GitHub publish to the Space

1. On Hugging Face: profile picture → **Settings** → **Access Tokens** → **Create new token**. Choose type **Write**, give it a name like `shiftflow-github`, and copy the token.
2. On GitHub, open the ShiftFlow repository → **Settings** → **Secrets and variables** → **Actions**.
   - **Secrets** tab → **New repository secret**: name `HF_TOKEN`, paste the token.
   - **Variables** tab → **New repository variable**: name `HF_SPACE`, value `your-hf-username/shiftflow`.

### 4. Publish

On GitHub open **Actions** → **Deploy demo** → **Run workflow**. After that, every change merged into `main` publishes automatically.

On Hugging Face, the Space shows **Building** for about 10 minutes the first time, then **Running**.

## Open it

Use the direct address, not the huggingface.co page:

```
https://your-hf-username-shiftflow.hf.space
```

The huggingface.co/spaces page shows the app inside a frame, where the browser blocks the sign-in cookie. The direct `.hf.space` address works normally.

Sign in with the demo password you chose and:

| Who | Email |
| --- | --- |
| Manager | `jamie@shiftflow.test` |
| Employees | `emp-1@utrecht.shiftflow.test` to `emp-15@utrecht.shiftflow.test` |

A good path to show someone: sign in as an employee on a phone, open a shift, tap **Find a replacement** and ask a colleague. Then sign in as that colleague to accept, and as the manager to approve it in the **Swap Centre**.

## How it works

- `Dockerfile` builds one image with Node, the pinned Python engine and the app.
- `scripts/start-demo.sh` starts the embedded PostgreSQL, creates the database roles and demo data, starts the engine and the app on port 7860, then runs `scripts/demo-prepare.mts`, which signs in as the demo manager and saves a generated, validated roster for the demo week.
- On Hugging Face, `SPACE_HOST` sets `SHIFTFLOW_PUBLIC_ORIGIN` to the Space's HTTPS address. In that mode the app accepts writes only when the browser's `Origin` is exactly that address, and cookies are marked `Secure`. Without it, the app keeps its original local-only behaviour.
- `.github/workflows/deploy-demo.yml` pushes the repository to the Space, leaving out screenshots and the source zip, which the Space doesn't need.

Run the same image locally with Docker:

```bash
docker build -t shiftflow-demo .
```

```bash
docker run -p 7860:7860 -e SHIFTFLOW_DEMO_PASSWORD=choose-a-long-password -e SHIFTFLOW_PUBLIC_ORIGIN=https://your-https-address shiftflow-demo
```

`SHIFTFLOW_PUBLIC_ORIGIN` must be an `https://` address that reaches the container through an HTTPS proxy, because cookies are marked secure.
