(() => {
  const SUPABASE_URL = "https://tkzcgnjejuevtfnikmfl.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_gsMVtiDUhfZVw1oCYp1RlA_pwWMErw7";
  const PHOTO_BUCKET = "study-photos";

  const syncStatus = document.querySelector("#syncStatus");
  const syncUser = document.querySelector("#syncUser");
  const authForm = document.querySelector("#authForm");
  const authEmail = document.querySelector("#authEmail");
  const authButton = document.querySelector("#authButton");
  const signOutButton = document.querySelector("#signOutButton");

  if (!window.supabase?.createClient || !window.MISHNAH_YOMIS_DATA) {
    setSyncStatus("Cloud sync unavailable");
    return;
  }

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  let currentUser = null;
  let cloudReady = false;
  let isApplyingCloud = false;
  let previousCompleted = snapshotCompleted();

  const originalSaveState = saveState;
  const originalCapturePhoto = capturePhoto;

  saveState = function saveStateWithCloudSync() {
    originalSaveState();
    const changes = changedCompleted();
    previousCompleted = snapshotCompleted();

    if (isApplyingCloud || !currentUser || !changes.length) {
      return;
    }

    for (const change of changes) {
      syncProgressChange(change.item, change.completed).catch(() => {
        setSyncStatus("Cloud save failed. Saved on this device.");
      });
    }
  };

  capturePhoto = async function capturePhotoWithCloudSync(item) {
    const file = await selectPhotoFile();
    if (!file) {
      return;
    }

    try {
      const { blob, takenAt } = await createStampedPhoto(file, item);
      const fileName = photoFileName(item, takenAt);
      let filePath = null;

      try {
        filePath = await uploadPhotoToCloud(item, blob, fileName, takenAt);
      } catch {
        setSyncStatus("Photo saved on this device. Cloud upload failed.");
      }

      await savePhotoRecord({
        id: item.id,
        itemId: item.id,
        takenAt,
        fileName,
        filePath,
        blob,
      });
      render();
    } catch (error) {
      window.alert(error.message || "The photo could not be saved.");
    }
  };

  renderPhotoControls = function renderPhotoControlsWithCloud(container, item, variant = "list") {
    const meta = photoIndex.get(item.id);
    const wrap = document.createElement("div");
    wrap.className = `photo-controls ${variant}`;

    const button = document.createElement("button");
    button.className = "photo-button";
    button.type = "button";
    button.textContent = meta ? "Replace Photo" : "Add Photo";
    button.addEventListener("click", () => capturePhoto(item));
    wrap.append(button);

    if (meta) {
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
        loadPhotoThumbnail(item.id, meta, image);
        wrap.append(image);
      }
    }

    container.append(wrap);
  };

  function setSyncStatus(message) {
    if (syncStatus) {
      syncStatus.textContent = message;
    }
  }

  function setAuthControlsBusy(isBusy) {
    if (authButton) authButton.disabled = isBusy;
    if (signOutButton) signOutButton.disabled = isBusy;
  }

  function updateAuthUi() {
    const signedIn = Boolean(currentUser);
    if (authForm) authForm.hidden = signedIn;
    if (signOutButton) signOutButton.hidden = !signedIn;
    if (syncUser) syncUser.textContent = signedIn ? currentUser.email || "Signed in" : "Not signed in";

    if (signedIn && cloudReady) {
      setSyncStatus("Cloud sync is on");
    } else if (!signedIn) {
      setSyncStatus("Saved on this device");
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

  function localProgressChanges() {
    return DATA.items
      .filter((item) => Boolean(state.completed[item.id]) !== Boolean(item.sourceCompleted))
      .map((item) => progressPayload(item, state.completed[item.id]));
  }

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
    if (!currentUser) return;

    setSyncStatus("Saving progress...");
    const { error } = await client
      .from("progress")
      .upsert(progressPayload(item, completed), { onConflict: "user_id,study_day_id" });

    if (error) throw error;
    setSyncStatus("Cloud sync is on");
  }

  async function syncLocalProgressChanges() {
    const changes = localProgressChanges();
    if (!changes.length) return;

    const { error } = await client
      .from("progress")
      .upsert(changes, { onConflict: "user_id,study_day_id" });

    if (error) throw error;
  }

  async function loadCloudProgress() {
    setSyncStatus("Loading cloud progress...");
    const { data, error } = await client
      .from("progress")
      .select("study_day_id, completed")
      .eq("user_id", currentUser.id);

    if (error) throw error;

    if (!data.length) {
      await syncLocalProgressChanges();
      previousCompleted = snapshotCompleted();
      return;
    }

    isApplyingCloud = true;
    for (const row of data) {
      if (Object.prototype.hasOwnProperty.call(state.completed, row.study_day_id)) {
        state.completed[row.study_day_id] = Boolean(row.completed);
      }
    }
    originalSaveState();
    previousCompleted = snapshotCompleted();
    isApplyingCloud = false;
  }

  async function loadCloudPhotos() {
    const { data, error } = await client
      .from("photos")
      .select("study_day_id, file_path, file_name, taken_at")
      .eq("user_id", currentUser.id)
      .order("taken_at", { ascending: false });

    if (error) throw error;

    for (const record of data) {
      const existing = photoIndex.get(record.study_day_id);
      if (!existing || new Date(record.taken_at) > new Date(existing.takenAt)) {
        photoIndex.set(record.study_day_id, {
          takenAt: record.taken_at,
          fileName: record.file_name,
          filePath: record.file_path,
          cloud: true,
        });
      }
    }
  }

  async function uploadPhotoToCloud(item, blob, fileName, takenAt) {
    if (!currentUser) return null;

    setSyncStatus("Uploading photo...");
    const filePath = `${currentUser.id}/${item.isoDate}/${fileName}`;
    const { error: uploadError } = await client.storage
      .from(PHOTO_BUCKET)
      .upload(filePath, blob, { contentType: "image/jpeg", upsert: true });

    if (uploadError) throw uploadError;

    const { error: metadataError } = await client.from("photos").insert({
      user_id: currentUser.id,
      study_day_id: item.id,
      file_path: filePath,
      file_name: fileName,
      taken_at: takenAt,
      english_date: item.englishDate,
      hebrew_date: item.hebrewDate,
      tractate: item.tractate,
      assignment: item.assignment,
    });

    if (metadataError) throw metadataError;
    setSyncStatus("Photo saved to cloud");
    return filePath;
  }

  async function signedPhotoUrl(filePath) {
    const { data, error } = await client.storage
      .from(PHOTO_BUCKET)
      .createSignedUrl(filePath, 60 * 10);

    if (error) throw error;
    return data.signedUrl;
  }

  async function loadPhotoThumbnail(itemId, meta, image) {
    try {
      const record = await getPhotoRecord(itemId);
      if (record?.blob && image.isConnected) {
        const url = URL.createObjectURL(record.blob);
        image.onload = () => URL.revokeObjectURL(url);
        image.src = url;
        return;
      }

      if (meta.filePath && image.isConnected) {
        const url = await signedPhotoUrl(meta.filePath);
        if (image.isConnected) image.src = url;
      }
    } catch {
      image.remove();
    }
  }

  function cleanRedirectUrl() {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  async function loadCloudDataForUser() {
    try {
      await loadCloudProgress();
      await loadCloudPhotos();
      cloudReady = true;
      updateAuthUi();
      render();
    } catch (error) {
      cloudReady = false;
      setSyncStatus("Cloud sync needs setup");
      console.warn("Supabase sync failed", error);
    }
  }

  async function handleSession(session) {
    const nextUser = session?.user || null;
    const userChanged = nextUser?.id !== currentUser?.id;
    currentUser = nextUser;
    cloudReady = false;
    updateAuthUi();

    if (currentUser && userChanged) {
      await loadCloudDataForUser();
    }
  }

  if (authForm) {
    authForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = authEmail.value.trim();
      if (!email) return;

      setAuthControlsBusy(true);
      setSyncStatus("Sending sign-in email...");
      const { error } = await client.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: cleanRedirectUrl() },
      });
      setAuthControlsBusy(false);

      if (error) {
        setSyncStatus("Could not send sign-in email");
        window.alert(error.message);
        return;
      }

      setSyncStatus("Check your email for the sign-in link");
    });
  }

  if (signOutButton) {
    signOutButton.addEventListener("click", async () => {
      setAuthControlsBusy(true);
      await client.auth.signOut();
      setAuthControlsBusy(false);
      currentUser = null;
      cloudReady = false;
      updateAuthUi();
      render();
    });
  }

  client.auth.getSession().then(({ data }) => handleSession(data.session));
  client.auth.onAuthStateChange((_event, session) => handleSession(session));
  updateAuthUi();
})();
