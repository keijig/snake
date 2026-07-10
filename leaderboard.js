// ---- Online leaderboard + gated login (Supabase) -------------------------
// A full-screen gate requires Google sign-in (and a username) before the game
// unlocks. Once in, scores post to a global top-20 best-score board.
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

  // official multicolor Google "G"
  const GOOGLE_G =
    '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">' +
    '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>' +
    '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>' +
    '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>' +
    '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';

  // ---- gate screens -------------------------------------------------------
  function showLogin() {
    lock(true);
    gateBody.innerHTML =
      '<button id="googleBtn" class="google-btn">' + GOOGLE_G +
      "<span>Sign in with Google</span></button>" +
      '<p class="gate-fine">sign in to save your score and compete for #1</p>';
    gateMsg.textContent = "";
    document.getElementById("googleBtn").addEventListener("click", onGoogle);
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
