# Publish and Enable Daily Pages

The project is already configured for automatic daily publishing through
GitHub Actions and GitHub Pages.

## One-time publish

From the prepared local publishing repository:

```bash
git config --global --add safe.directory C:/My_project_data_trending/.publish-test
cd C:\My_project_data_trending\.publish-test
git push -u origin main
```

If HTTPS push fails with `Recv failure: Connection was reset`, use the
prepared SSH-over-443 route instead. The local publishing repository has been
configured to use:

```text
ssh://git@ssh.github.com:443/JohnneyLee/control-trend-digest.git
```

Add this public key as a repository Deploy key with write access:

```text
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKPdwGMuXjgGZdrz5qmF7i+OhW3tf+3b370yEXTG1ira control-trend-digest deploy key
```

Then run:

```bash
cd C:\My_project_data_trending\.publish-test
git push -u origin main
```

If Git asks for authentication, sign in with your GitHub account that owns:

```text
JohnneyLee/control-trend-digest
```

## Enable GitHub Pages

After the files are pushed:

1. Open `https://github.com/JohnneyLee/control-trend-digest/settings/pages`.
2. Under **Build and deployment**, select **GitHub Actions**.
3. Open the **Actions** tab and run `control-theory-trend-digest` manually once,
   or wait for the daily schedule.

The workflow will:

```text
generate daily/YYYY-MM-DD.md
build public/
deploy public/ to GitHub Pages
optionally send Slack/Telegram/webhook notification
```

## Optional notifications

Add repository secrets only if push notifications are needed:

```text
SLACK_WEBHOOK_URL
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
GENERIC_WEBHOOK_URL
```

Without these secrets, the website and RSS still update normally.
