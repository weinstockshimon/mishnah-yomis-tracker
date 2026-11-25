(() => {
  const SUPABASE_URL = "https://tkzcgnjejuevtfnikmfl.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_gsMVtiDUhfZVw1oCYp1RlA_pwWMErw7";

  if (!window.supabase?.createClient || !window.MISHNAH_YOMIS_DATA) {
    return;
  }

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: window.localStorage,
    },
  });

  const syncPanel = document.querySelector(".sync-panel");
  const syncCopy = document.querySelector(".sync-copy");
  const authForm = document.querySelector("#authForm");
  const authEmail = document.querySelector("#authEmail");
  const authButton = document.querySelector("#authButton");
  const signOutButton = document.querySelector("#signOutButton");
  const toolbar = document.querySelector(".toolbar");
  const titleBlock = document.querySelector(".topbar > div:first-child");
  const appTitle = document.querySelector("#app-title");

  let currentUser = null;
  let cloudReady = false;
  let applyingCloud = false;
  let previousCompleted = snapshotCompleted();

  if (toolbar) {
    toolbar.remove();
  }

  if (typeof visibleItems === "function") {
    visibleItems = function visibleDueItems(collections) {
      return collections.due;
    };
  }

  const passwordStyle = document.createElement("style");
  passwordStyle.textContent = `
    .auth-form.password-login {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 8px;
    }

    .auth-form.password-login input {
      width: 100%;
    }
  `;
  document.head.append(passwordStyle);

  const authPassword = document.createElement("input");
  authPassword.id = "authPassword";
  authPassword.type = "password";
  authPassword.autocomplete = "current-password";
  authPassword.placeholder = "Password";
  if (authForm && authEmail) {
    authForm.classList.add("password-login");
    authEmail.placeholder = "Email";
    authEmail.after(authPassword);
  }
  if (authButton) {
    authButton.textContent = "Log in";
  }

  if (titleBlock && appTitle && signOutButton && !titleBlock.querySelector(".title-row")) {
    const titleRow = document.createElement("div");
    titleRow.className = "title-row";
    appTitle.replaceWith(titleRow);
    titleRow.append(appTitle, signOutButton);
  }

  const topStatus = document.createElement("div");
  topStatus.className = "sync-copy top-sync-copy";
  topStatus.innerHTML = `
    <span id="topSyncStatus">Loading...</span>
    <strong id="topSyncUser">Not signed in</strong>
  `;
  if (titleBlock) {
    titleBlock.append(topStatus);
  }

  const authScreen = document.createElement("section");
  authScreen.className = "auth-screen";
  authScreen.id = "authScreen";
  authScreen.setAttribute("aria-labelledby", "authTitle");

  const authCard = document.createElement("div");
  authCard.className = "auth-card";
  authCard.innerHTML = `
    <p class="eyebrow">Mishnah Yomis</p>
    <h1 id="authTitle">Log in to your tracker</h1>
    <p class="auth-note">Use your email and password. No email link required.</p>
  `;

  if (syncCopy) {
    authCard.append(syncCopy.cloneNode(true));
  }
  if (authForm) {
    authForm.hidden = false;
    authForm.style.display = "";
    authCard.append(authForm);
  }
  authScreen.append(authCard);
  document.body.insertBefore(authScreen, document.querySelector(".app-shell"));
  if (syncPanel) {
    syncPanel.remove();
  }

  function setStatus(message) {
    const status = document.querySelector("#syncStatus");
    if (status) {
      status.textContent = message;
    }
    const top = document.querySelector("#topSyncStatus");
    if (top) {
      top.textContent = message;
    }
  }

  function setUserText(message) {
    const syncUser = document.querySelector("#syncUser");
    if (syncUser) {
      syncUser.textContent = message;
    }
    const topUser = document.querySelector("#topSyncUser");
    if (topUser) {
      topUser.textContent = message;
    }
  }

  function snapshotCompleted() {
    return { ...state.completed };
  }

  function changedCompleted() {
    const changes = [];
    for (const item of DATA.items) {
      const before = Boolean(previousCompleted[item.id]);
      const after = Boolean(state.completed[item.id]);
      if (before !== after) {
        changes.push({ item, completed: after });
      }
    }
    return changes;
  }

  const originalSaveState = saveState;
  saveState = function saveStateWithCloud() {
    originalSaveState();
    const changes = changedCompleted();
    previousCompleted = snapshotCompleted();
    if (applyingCloud || !currentUser || !changes.length) {
      return;
    }
    for (const change of changes) {
      syncProgressChange(change.item, change.completed).catch((error) => {
        setStatus(`Progress cloud save failed: ${error.message || error}`);
      });
    }
  };

  function progressPayload(item, completed) {
    const now = new Date().toISOString();
    return {
      user_id: currentUser.id,
      study_day_id: item.id,
      completed: Boolean(completed),
      completed_at: completed ? now : null,
      updated_at: now,
    };
  }

  async function syncProgressChange(item, completed) {
    setStatus("Saving progress...");
    const result = await client
      .from("progress")
      .upsert(progressPayload(item, completed), { onConflict: "user_id,study_day_id" });
    if (result.error) {
      throw result.error;
    }
    setStatus("Cloud sync is on");
  }

  async function loadCloudProgress() {
    const result = await client
      .from("progress")
      .select("study_day_id, completed")
      .eq("user_id", currentUser.id);
    if (result.error) {
      throw result.error;
    }

    if (!result.data.length) {
      const localChanges = DATA.items
        .filter((item) => Boolean(state.completed[item.id]) !== Boolean(item.sourceCompleted))
        .map((item) => progressPayload(item, state.completed[item.id]));
      if (localChanges.length) {
        const saved = await client
          .from("progress")
          .upsert(localChanges, { onConflict: "user_id,study_day_id" });
        if (saved.error) {
          throw saved.error;
        }
      }
      return;
    }

    applyingCloud = true;
    for (const row of result.data) {
      if (Object.prototype.hasOwnProperty.call(state.completed, row.study_day_id)) {
        state.completed[row.study_day_id] = Boolean(row.completed);
      }
    }
    originalSaveState();
    previousCompleted = snapshotCompleted();
    applyingCloud = false;
  }

  function withTimeout(promise, message, timeoutMs = 25000) {
    let timerId;
    const timeout = new Promise((_, reject) => {
      timerId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timerId));
  }

  function withCloudTimeout(promise, message) {
    return withTimeout(promise, message, 30000);
  }

  function showSignedOut() {
    document.body.classList.add("auth-signed-out");
    document.body.classList.remove("auth-signed-in", "auth-checking");
    authScreen.hidden = false;
    if (authForm) {
      authForm.hidden = false;
      authForm.style.display = "";
    }
    if (authButton) {
      authButton.hidden = false;
      authButton.disabled = false;
      authButton.textContent = "Log in";
    }
    if (authEmail) {
      authEmail.hidden = false;
      authEmail.disabled = false;
    }
    if (authPassword) {
      authPassword.hidden = false;
      authPassword.disabled = false;
    }
    if (signOutButton) {
      signOutButton.hidden = true;
    }
    setStatus("Not signed in");
    setUserText("Not signed in");
  }

  function showSignedIn() {
    document.body.classList.add("auth-signed-in");
    document.body.classList.remove("auth-signed-out", "auth-checking");
    authScreen.hidden = true;
    if (signOutButton) {
      signOutButton.hidden = false;
      signOutButton.disabled = false;
    }
    setUserText(currentUser.email || "Signed in");
    setStatus(cloudReady ? "Cloud sync is on" : "Loading cloud data...");
  }

  if (authForm) {
    authForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = authEmail?.value.trim();
      const password = authPassword?.value || "";
      if (!email || !password) {
        setStatus("Enter your email and password");
        return;
      }
      authButton.disabled = true;
      setStatus("Logging in...");
      const result = await client.auth.signInWithPassword({
        email,
        password,
      });
      authButton.disabled = false;
      if (result.error) {
        setStatus("Login failed");
        window.alert(result.error.message);
        return;
      }
      authPassword.value = "";
      await handleSession(result.data.session);
    });
  }

  if (signOutButton) {
    signOutButton.addEventListener("click", async () => {
      signOutButton.disabled = true;
      setStatus("Signing out...");
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("sb-")) {
          localStorage.removeItem(key);
        }
      }
      currentUser = null;
      cloudReady = false;
      showSignedOut();
      render();
      client.auth.signOut({ scope: "global" }).catch(() => {});
    });
  }

  async function loadCloudData() {
    try {
      setStatus("Loading cloud progress...");
      await withCloudTimeout(loadCloudProgress(), "Cloud progress did not load. Please check the progress table policies.");
      cloudReady = true;
      showSignedIn();
      render();
    } catch (error) {
      cloudReady = false;
      setStatus(`Cloud setup issue: ${error.message || error}`);
      render();
    }
  }

  async function handleSession(session) {
    currentUser = session?.user || null;
    cloudReady = false;
    if (!currentUser) {
      showSignedOut();
      render();
      return;
    }
    showSignedIn();
    await loadCloudData();
  }

  client.auth.getSession().then(({ data }) => handleSession(data.session));
  client.auth.onAuthStateChange((_event, session) => handleSession(session));
})();
