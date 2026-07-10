// ---- Online leaderboard + gated login (Supabase) -------------------------
// A full-screen gate requires magic-link sign-in (and a username) before the
// game unlocks. Once in, scores post to a global top-20 best-score board.
// If Supabase keys aren't configured, the gate is skipped and the game plays.

(function () {
  const URL_ = window.SUPABASE_URL;
  const KEY_ = window.SUPABASE_ANON_KEY;
  const configured = URL_ && KEY_ && !URL_.startsWith("YOUR-") && !KEY_.startsWith("YOUR-");

  const gateEl = document.getElementById("gate");
  const gateBody = document.getElementById("gateBody");
  const gateMsg = document.getElementById("gateMsg");
  const authEl = document.getElementById("auth");
  const listEl = document.getElementById("leaderboard");
  const rankEl = document.getElementById("myrank");

  // Lock = gate visible + game input blocked. Start locked to avoid a flash of
  // the game before we know whether the player is signed in.
  window.SNAKE_LOCKED = true;
  function lock(on) {
    window.SNAKE_LOCKED = on;
    gateEl.classList.toggle("hidden", !on);
    if (on) document.dispatchEvent(new Event("snake:lock"));   // pause if playing
  }

  if (!configured) {
    lock(false);
    authEl.innerHTML = '<span class="muted">leaderboard coming soon</span>';
    return;
  }

  const sb = window.supabase.createClient(URL_, KEY_);
  let user = null;                              // logged-in auth user
  let profile = null;                          // their { username, best_score }

  // ---- gate screens -------------------------------------------------------
  function showLogin() {
    lock(true);
    gateBody.innerHTML =
      '<p class="gate-sub">sign in to play</p>' +
      '<button id="googleBtn" class="google-btn">continue with Google</button>' +
      '<div class="or">or</div>' +
      '<form id="loginForm" class="gate-form">' +
      '<input id="email" type="email" placeholder="your@email.com" required />' +
      "<button type=\"submit\">send magic link</button></form>";
    gateMsg.textContent = "";
    document.getElementById("googleBtn").addEventListener("click", onGoogle);
    document.getElementById("loginForm").addEventListener("submit", onLogin);
  }

  function showUsername() {
    lock(true);
    const guess = suggestName();               // prefill from Google name / email
    gateBody.innerHTML =
      '<p class="gate-sub">pick a username</p>' +
      '<form id="nameForm" class="gate-form">' +
      '<input id="username" maxlength="16" value="' + guess + '" placeholder="username" required autofocus />' +
      "<button type=\"submit\">start playing</button></form>";
    gateMsg.textContent = "";
    document.getElementById("nameForm").addEventListener("submit", onCreateProfile);
  }

  function suggestName() {
    const m = (user && user.user_metadata) || {};
    const raw = m.user_name || m.full_name || m.name || (user && user.email || "").split("@")[0] || "";
    return raw.replace(/[^A-Za-z0-9_]/g, "").slice(0, 16);   // only safe chars
  }

  async function onGoogle() {
    gateMsg.textContent = "redirecting to Google…";
    const redirectTo = location.origin + location.pathname;
    const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
    if (error) gateMsg.textContent = "error: " + error.message;
  }

  function showGame() {
    lock(false);
    authEl.innerHTML =
      "<span>signed in as <b>" + esc(profile.username) + "</b></span>" +
      '<button id="logout">log out</button>';
    document.getElementById("logout").addEventListener("click", () => sb.auth.signOut());
  }

  async function updateGate() {
    if (!user) { profile = null; showLogin(); return; }
    if (!profile) {
      const { data } = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
      profile = data;
    }
    if (!profile) { showUsername(); return; }
    showGame();
  }

  async function onLogin(e) {
    e.preventDefault();
    const email = document.getElementById("email").value.trim();
    if (!email) return;
    gateMsg.textContent = "sending…";
    const emailRedirectTo = location.origin + location.pathname;   // return here
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo } });
    gateMsg.textContent = error ? "error: " + error.message : "check your email for a login link ✉️";
  }

  async function onCreateProfile(e) {
    e.preventDefault();
    const username = document.getElementById("username").value.trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
      gateMsg.textContent = "3–16 letters, numbers, or underscores";
      return;
    }
    const { data, error } = await sb.from("profiles")
      .insert({ id: user.id, username, best_score: 0 }).select().single();
    if (error) {
      gateMsg.textContent = error.code === "23505" ? "that username is taken" : error.message;
      return;
    }
    profile = data;
    showGame();
    await loadBoard();
  }

  // ---- leaderboard --------------------------------------------------------
  async function loadBoard() {
    const { data, error } = await sb.from("profiles")
      .select("username,best_score")
      .order("best_score", { ascending: false })
      .order("updated_at", { ascending: true })
      .limit(20);
    if (error) { listEl.innerHTML = '<li class="muted">could not load leaderboard</li>'; return; }
    listEl.innerHTML = data.length
      ? data.map((r, i) =>
          "<li" + (profile && r.username === profile.username ? ' class="me"' : "") + ">" +
          '<span class="rank">' + (i + 1) + "</span>" +
          '<span class="name">' + esc(r.username) + "</span>" +
          '<span class="pts">' + r.best_score + "</span></li>"
        ).join("")
      : '<li class="muted">no scores yet — be the first!</li>';

    if (profile) {
      const { count } = await sb.from("profiles")
        .select("*", { count: "exact", head: true })
        .gt("best_score", profile.best_score);
      rankEl.textContent = "your rank: #" + ((count ?? 0) + 1) + " · best " + profile.best_score;
    } else {
      rankEl.textContent = "";
    }
  }

  // ---- score submission ---------------------------------------------------
  async function submitScore(score) {
    if (!user || !profile || score <= profile.best_score) return;
    const { error } = await sb.from("profiles")
      .update({ best_score: score, updated_at: new Date().toISOString() })
      .eq("id", user.id)
      .lt("best_score", score);                 // only ever raises the best
    if (!error) {
      profile.best_score = score;
      await loadBoard();
    }
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---- wire up ------------------------------------------------------------
  sb.auth.onAuthStateChange(async (_event, session) => {
    user = session?.user ?? null;
    profile = null;
    await updateGate();
    await loadBoard();
  });

  document.addEventListener("snake:gameover", (e) => submitScore(e.detail.score));

  (async function boot() {
    const { data } = await sb.auth.getSession();
    user = data.session?.user ?? null;
    await updateGate();
    await loadBoard();
  })();
})();
