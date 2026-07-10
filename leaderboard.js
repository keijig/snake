// ---- Online leaderboard (Supabase) ---------------------------------------
// Magic-link accounts + a global top-20 best-score board. If the Supabase keys
// in config.js aren't filled in yet, this quietly shows "coming soon" and the
// game plays normally.

(function () {
  const URL_ = window.SUPABASE_URL;
  const KEY_ = window.SUPABASE_ANON_KEY;
  const configured = URL_ && KEY_ && !URL_.startsWith("YOUR-") && !KEY_.startsWith("YOUR-");

  const authEl = document.getElementById("auth");
  const listEl = document.getElementById("leaderboard");
  const rankEl = document.getElementById("myrank");

  if (!configured) {
    authEl.innerHTML = '<span class="muted">leaderboard coming soon</span>';
    return;
  }

  const sb = window.supabase.createClient(URL_, KEY_);
  let user = null;                              // the logged-in auth user
  let profile = null;                          // their { username, best_score }

  // ---- auth / profile UI --------------------------------------------------
  async function refreshAuth() {
    if (!user) {                               // logged out → ask for email
      authEl.innerHTML =
        '<form id="loginForm" class="authrow">' +
        '<input id="email" type="email" placeholder="your@email.com" required />' +
        '<button type="submit">send login link</button></form>';
      document.getElementById("loginForm").addEventListener("submit", onLogin);
      rankEl.textContent = "";
      return;
    }
    if (!profile) {                            // logged in but no username yet
      const { data } = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
      profile = data;
    }
    if (!profile) {                            // → ask them to pick one
      authEl.innerHTML =
        '<form id="nameForm" class="authrow">' +
        '<input id="username" maxlength="16" placeholder="pick a username" required />' +
        '<button type="submit">save</button></form>';
      document.getElementById("nameForm").addEventListener("submit", onCreateProfile);
      return;
    }
    authEl.innerHTML =                          // fully set up
      "<span>signed in as <b>" + esc(profile.username) + "</b></span>" +
      '<button id="logout">log out</button>';
    document.getElementById("logout").addEventListener("click", () => sb.auth.signOut());
  }

  async function onLogin(e) {
    e.preventDefault();
    const email = document.getElementById("email").value.trim();
    if (!email) return;
    const emailRedirectTo = location.origin + location.pathname;   // come back here
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo } });
    authEl.innerHTML = error
      ? '<span class="muted">error: ' + esc(error.message) + "</span>"
      : '<span class="muted">check your email for a login link ✉️</span>';
  }

  async function onCreateProfile(e) {
    e.preventDefault();
    const username = document.getElementById("username").value.trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
      alert("username must be 3–16 letters, numbers, or underscores");
      return;
    }
    const { data, error } = await sb.from("profiles")
      .insert({ id: user.id, username, best_score: 0 }).select().single();
    if (error) {
      alert(error.code === "23505" ? "that username is taken" : error.message);
      return;
    }
    profile = data;
    await refreshAuth();
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
    await refreshAuth();
    await loadBoard();
  });

  document.addEventListener("snake:gameover", (e) => submitScore(e.detail.score));

  (async function boot() {
    const { data } = await sb.auth.getSession();
    user = data.session?.user ?? null;
    await refreshAuth();
    await loadBoard();
  })();
})();
