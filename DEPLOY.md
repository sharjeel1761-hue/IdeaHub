# Putting IdeaHub online: the complete workflow (free)

You will make three free accounts and connect them:

| Service | What it does | Cost |
|---|---|---|
| **GitHub** | Stores the website's code | Free |
| **Turso** | Stores the data (accounts, ideas, corrections) | Free plan |
| **Render** | Runs the website and gives it a web address | Free plan |

Render's free plan wipes its disk on every restart, so the site keeps all its data in Turso instead.
Nothing is lost when Render restarts or goes to sleep.

Total time: about 20 to 30 minutes. You never need to paste a password or token into the chat.

---

## Part 1: Put the code on GitHub

1. Go to **https://github.com** and click **Sign up**. Use any email, choose a username and password, and verify your email.
2. When you're signed in, click the **+** at the top right, then **New repository**.
3. Fill in:
   - Repository name: `ideahub`
   - **Private** (only you see the code; Render can still use it) or **Public**. Either works.
   - Leave all the "Add a README / .gitignore / license" options **off**.
4. Click **Create repository**.
5. Now get the code into it. Pick **one** way:
   - **Way A (Claude uploads it):** open https://claude.ai/connect-github and connect your GitHub account. Allow access to the `ideahub` repository when asked. Then tell Claude in the thread: "GitHub is connected, my username is ____". Claude puts the code in and tells you when it's there.
   - **Way B (you upload it):** download `ideahub.zip` from the thread and unzip it. On your new repository's page, click the link **uploading an existing file**. Open the unzipped `ideahub` folder, select **everything inside it** (including the `public` and `src` folders), and drag it onto the page. Wait for all files to finish, then click **Commit changes**.
6. Check: your repository page should list `server.js`, `package.json`, `public`, `src` and others at the top level, not one folder called `ideahub`. If you see only an `ideahub` folder, the files are one level too deep; delete it and drag the folder's *contents* instead.

## Part 2: Create the database on Turso

1. Go to **https://turso.tech** and click **Sign up**. Choose **Continue with GitHub** (easiest) and allow it.
2. If it asks for an organisation name, use your username. Choose the **Free** plan if asked.
3. Click **Create Database** (or **New Database**).
   - Name: `ideahub`
   - Location: the closest to India that's offered (for example Mumbai or Singapore).
4. Open the database's page and copy its **URL**. It starts with `libsql://` and looks like `libsql://ideahub-yourname.turso.io`. Paste it into a note on your own computer for now.
5. On the same page, click **Create Token** (it may be called **Generate Token** or sit under the **⋯** menu).
   - Expiration: **Never** (otherwise the site stops working when it expires).
   - Access: **Read & Write**.
   Copy the long token into your note. **Treat it like a password**: anyone with it can change your data. Don't post it anywhere.

## Part 3: Create the website on Render

1. Go to **https://render.com**, click **Get Started**, choose **GitHub** to sign up, and allow it.
2. In the Render dashboard click **+ New** → **Web Service**.
3. Under "Git Provider" choose **GitHub**. If `ideahub` isn't listed, click **Configure account**, allow Render access to `ideahub`, and come back. Select `ideahub` and click **Connect**.
4. Fill in the form:
   - Name: `ideahub-dduc` (this becomes your address, `https://ideahub-dduc.onrender.com`, if the name is free)
   - Language: **Node**
   - Branch: `main`
   - Region: **Singapore** (closest to India)
   - Build Command: `npm install`
   - Start Command: `node server.js`
   - Instance Type: **Free**
5. Scroll to **Environment Variables** and click **Add Environment Variable** to add these four:

   | Name (type exactly) | Value |
   |---|---|
   | `TURSO_DATABASE_URL` | the `libsql://…` URL from Part 2, step 4 |
   | `TURSO_AUTH_TOKEN` | the token from Part 2, step 5 |
   | `SEED` | `0` |
   | `MODERATORS` | the username you will use on IdeaHub, e.g. `sharjeel` |

   `SEED = 0` makes the site start empty, without the fictional sample students (their password is public, so they must not be on the real site).
6. Click **Deploy Web Service**.
7. Render shows a log. Wait until you see these lines (usually 2 to 5 minutes) and the status at the top says **Live**:
   ```
   Loaded 0 users and 0 ideas from Turso.
   IdeaHub DDUC running at http://localhost:10000
   ```
   The "localhost" part is normal; it's how Render runs it inside.

## Part 4: Make yourself moderator and test the site

1. Click your web address at the top of the Render page (like `https://ideahub-dduc.onrender.com`).
2. Click **Create account** and sign up with **exactly the username you put in `MODERATORS`**.
3. Check you're the moderator: you should see the **Moderation** page in the menu. If not, the username doesn't match `MODERATORS`; fix the value in Render under **Environment**, save, and the site restarts with the change.
4. As moderator, create the first **weekly challenge** so the homepage has something to do.
5. Post a test idea. Then open the same link on your phone, create a second account, and leave a correction on your idea. This checks that two people really share the same site.
6. Persistence check: in Render click **Manual Deploy** → **Deploy latest commit**. When it's Live again, reload the site. Your accounts and idea should still be there, and the log should say `Loaded 2 users and 1 ideas from Turso.`
7. Share the link with your classmates.

## Part 5: Later

- **Changing the website:** when code in the GitHub repository changes, Render rebuilds and updates the live site by itself in a few minutes. Data in Turso is kept.
- **Sleeping:** the free Render site sleeps after about 15 minutes with no visitors. The next visitor waits up to a minute while it wakes. That's normal on the free plan.
- **More moderators:** add usernames to `MODERATORS`, separated by commas (e.g. `sharjeel,neha_k`), in Render under **Environment**.
- **Own domain name (optional):** a domain you buy (or get free with the GitHub Student Developer Pack) can be added in Render under **Settings → Custom Domains**.

## If something goes wrong

| What you see | What to do |
|---|---|
| Render log says `Could not open the database` | The Turso URL or token is wrong or expired. Copy them again from Turso (Part 2), paste into Render's **Environment**, save. |
| Render log mentions the Node version or `node:sqlite` | In Render's **Environment**, add `NODE_VERSION` with value `22`, save. |
| Build fails with `Could not read package.json` | The files are inside an extra `ideahub` folder on GitHub. Redo Part 1, step 6. |
| Site is slow to open the first time | It was asleep. Wait up to a minute. |
| Data disappeared after a restart | `TURSO_DATABASE_URL` is missing or misspelled in Render's **Environment**. |

Stuck at any step? Tell Claude the part and step number and what the screen shows. A screenshot is fine, but cover any token first.
