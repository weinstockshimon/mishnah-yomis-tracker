(() => {
  const SUPABASE_URL = "https://tkzcgnjejuevtfnikmfl.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_gsMVtiDUhfZVw1oCYp1RlA_pwWMErw7";
  const PHOTO_BUCKET = "study-photos";

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
  let selectedCalendarItemId = null;

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

  function normalizePhoto(record) {
    return {
      rowId: record.id,
      studyDayId: record.study_day_id,
      filePath: record.file_path,
      fileName: record.file_name,
      takenAt: record.taken_at,
      englishDate: record.english_date,
      hebrewDate: record.hebrew_date,
      tractate: record.tractate,
      assignment: record.assignment,
      cloud: true,
    };
  }

  async function loadCloudPhotos() {
    const result = await client
      .from("photos")
      .select("id, study_day_id, file_path, file_name, taken_at, english_date, hebrew_date, tractate, assignment")
      .eq("user_id", currentUser.id)
      .order("taken_at", { ascending: false });
    if (result.error) {
      throw result.error;
    }

    photoIndex = new Map();
    for (const record of result.data.map(normalizePhoto)) {
      if (!photoIndex.has(record.studyDayId)) {
        photoIndex.set(record.studyDayId, record);
      }
    }
  }

  async function signedPhotoUrl(filePath) {
    const result = await client.storage.from(PHOTO_BUCKET).createSignedUrl(filePath, 600);
    if (result.error) {
      throw result.error;
    }
    return result.data.signedUrl;
  }

  function loadCloudPhotoImage(image, photo) {
    if (!photo?.filePath) {
      image.remove();
      return;
    }
    signedPhotoUrl(photo.filePath)
      .then((url) => {
        if (image.isConnected) {
          image.src = url;
        }
      })
      .catch(() => image.remove());
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

  function photoFileName(item, takenAt) {
    const time = takenAt.slice(11, 19).replace(/:/g, "-");
    return `${item.isoDate}_${item.id}_${time}.jpg`;
  }

  async function uploadPhoto(item, file) {
    if (!file) {
      return;
    }
    const { data: sessionData } = await client.auth.getSession().catch(() => ({ data: null }));
    const user = sessionData?.session?.user || currentUser;
    if (!user) {
      window.alert("Please sign in first so the photo can save to Supabase.");
      showSignedOut();
      return;
    }
    if (photoIndex.has(item.id)) {
      window.alert("This day already has a photo. Delete the existing photo first if you want to upload a different one.");
      return;
    }

    try {
      setStatus(`Photo selected: ${(file.size / 1024 / 1024).toFixed(1)} MB`);
      setStatus("Stamping photo...");
      const { blob, takenAt } = await withTimeout(
        createStampedPhoto(file, item),
        "The phone gave the app a photo, but the browser could not prepare it. Try Upload Photo from the photo library, or choose a smaller photo.",
      );

      setStatus("Uploading photo to Supabase...");
      const fileName = photoFileName(item, takenAt);
      const filePath = `${user.id}/${item.isoDate}/${fileName}`;
      const uploaded = await withCloudTimeout(
        client.storage
          .from(PHOTO_BUCKET)
          .upload(filePath, blob, { contentType: "image/jpeg", upsert: true }),
        "Supabase Storage did not respond. Please check the study-photos bucket policies.",
      );
      if (uploaded.error) {
        throw uploaded.error;
      }

      setStatus("Saving photo details...");
      const saved = await withCloudTimeout(
        client
          .from("photos")
          .insert({
            user_id: user.id,
            study_day_id: item.id,
            file_path: filePath,
            file_name: fileName,
            taken_at: takenAt,
            english_date: item.englishDate,
            hebrew_date: item.hebrewDate,
            tractate: item.tractate,
            assignment: item.assignment,
          })
          .select("id, study_day_id, file_path, file_name, taken_at, english_date, hebrew_date, tractate, assignment")
          .single(),
        "Supabase did not save the photo details. Please check the photos table policies.",
      );
      if (saved.error) {
        throw saved.error;
      }

      photoIndex.set(item.id, normalizePhoto(saved.data));
      setStatus("Photo saved to Supabase");
      render();
    } catch (error) {
      const message = error.message || String(error);
      setStatus(`Photo upload failed: ${message}`);
      window.alert(`The photo did not upload to Supabase.\n\n${message}`);
    }
  }

  async function deletePhoto(photo) {
    if (!currentUser || !photo?.rowId) {
      return;
    }
    setStatus("Deleting photo...");
    const removed = await client.storage.from(PHOTO_BUCKET).remove([photo.filePath]);
    if (removed.error) {
      throw removed.error;
    }
    const deleted = await client
      .from("photos")
      .delete()
      .eq("id", photo.rowId)
      .eq("user_id", currentUser.id);
    if (deleted.error) {
      throw deleted.error;
    }
    photoIndex.delete(photo.studyDayId);
    setStatus("Photo deleted");
    render();
  }

  function cameraIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l1.5-2h3L15 5h3a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3h3z"></path><circle cx="12" cy="12.5" r="3.5"></circle></svg>';
  }

  function uploadIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4"></path><path d="M7 9l5-5 5 5"></path><path d="M5 20h14"></path></svg>';
  }

  function trashIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M6 7l1 14h10l1-14"></path><path d="M9 7V4h6v3"></path></svg>';
  }

  function photoPicker(label, icon, item, capture) {
    const control = document.createElement("label");
    control.className = "photo-button photo-icon-button photo-picker-control";
    control.title = label;
    control.setAttribute("aria-label", label);
    control.innerHTML = icon;

    const input = document.createElement("input");
    input.className = "photo-file-input";
    input.type = "file";
    input.accept = "image/*";
    if (capture) {
      input.capture = "environment";
    }
    input.addEventListener("change", async () => {
      const file = input.files?.[0] || null;
      input.value = "";
      await uploadPhoto(item, file);
    });

    control.append(input);
    return control;
  }

  function plainIconButton(label, icon, extraClass = "") {
    const button = document.createElement("button");
    button.className = `photo-button photo-icon-button ${extraClass}`.trim();
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = icon;
    return button;
  }

  renderPhotoControls = function renderCloudPhotoControls(container, item, variant = "list") {
    const meta = photoIndex.get(item.id);
    const wrap = document.createElement("div");
    wrap.className = `photo-controls ${variant}`;

    if (!meta) {
      if (variant !== "calendar-selected") {
        wrap.append(photoPicker("Take photo", cameraIcon(), item, true));
      }
      wrap.append(photoPicker("Upload photo", uploadIcon(), item, false));
      container.append(wrap);
      return;
    }

    const status = document.createElement("span");
    status.className = "photo-status";
    status.textContent = `Photo saved ${new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(meta.takenAt))}`;
    wrap.append(status);

    if (variant === "list") {
      const image = document.createElement("img");
      image.className = "photo-thumb";
      image.alt = `Stamped photo for ${shortDate(item)}`;
      loadCloudPhotoImage(image, meta);
      wrap.append(image);
    }

    const deleteButton = plainIconButton("Delete photo", trashIcon(), "danger");
    deleteButton.addEventListener("click", async () => {
      if (!window.confirm("Delete this photo from Supabase?")) {
        return;
      }
      try {
        await deletePhoto(meta);
      } catch (error) {
        window.alert(error.message || "The photo could not be deleted.");
      }
    });
    wrap.append(deleteButton);
    container.append(wrap);
  };

  const originalRenderCalendarDay = renderCalendarDay;
  renderCalendarDay = function renderSelectableCalendarDay(options) {
    const cell = originalRenderCalendarDay(options);
    const { item } = options;
    if (!item) {
      return cell;
    }

    cell.classList.toggle("calendar-selected", selectedCalendarItemId === item.id);
    cell.tabIndex = 0;
    cell.setAttribute("role", "button");
    cell.setAttribute("aria-label", `Open ${shortDate(item)} photo controls`);
    cell.addEventListener("click", (event) => {
      if (event.target.closest("input, button, a, label")) {
        return;
      }
      selectedCalendarItemId = selectedCalendarItemId === item.id ? null : item.id;
      render();
    });

    if (selectedCalendarItemId === item.id) {
      const panel = document.createElement("div");
      panel.className = "calendar-selected-panel";
      renderPhotoControls(panel, item, "calendar-selected");
      cell.append(panel);
    }
    return cell;
  };

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
      photoIndex = new Map();
      showSignedOut();
      render();
      client.auth.signOut({ scope: "global" }).catch(() => {});
    });
  }

  async function loadCloudData() {
    try {
      setStatus("Loading cloud progress...");
      await loadCloudProgress();
      setStatus("Loading cloud photos...");
      await loadCloudPhotos();
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
