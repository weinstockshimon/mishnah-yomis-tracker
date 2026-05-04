(() => {
  const SUPABASE_URL = "https://tkzcgnjejuevtfnikmfl.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_gsMVtiDUhfZVw1oCYp1RlA_pwWMErw7";
  const PHOTO_BUCKET = "study-photos";

  if (!window.supabase?.createClient || !window.MISHNAH_YOMIS_DATA) {
    return;
  }

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  let currentUser = null;
  let photoRecords = [];

  const toolbar = document.querySelector(".toolbar");
  const titleBlock = document.querySelector(".topbar > div:first-child");
  const appTitle = document.querySelector("#app-title");
  const signOutButton = document.querySelector("#signOutButton");
  let selectedCalendarItemId = null;

  if (toolbar) {
    toolbar.remove();
  }

  if (titleBlock && appTitle && signOutButton && !titleBlock.querySelector(".title-row")) {
    const titleRow = document.createElement("div");
    titleRow.className = "title-row";
    appTitle.replaceWith(titleRow);
    titleRow.append(appTitle, signOutButton);
  }

  if (signOutButton) {
    signOutButton.addEventListener(
      "click",
      async (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        await client.auth.signOut({ scope: "local" }).catch(() => {});
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith("sb-")) {
            localStorage.removeItem(key);
          }
        }
        document.body.classList.add("auth-signed-out");
        document.body.classList.remove("auth-signed-in");
        signOutButton.hidden = true;
      },
      true,
    );
  }

  renderPhotoControls = function renderCloudPhotoControls(container, item, variant = "list") {
    const meta = photoIndex.get(item.id);
    const wrap = document.createElement("div");
    wrap.className = `photo-controls ${variant}`;

    const takeButton = document.createElement("button");
    takeButton.className = "photo-button";
    takeButton.type = "button";
    takeButton.textContent = meta ? "Take New Photo" : "Take Photo";
    takeButton.addEventListener("click", () => savePhotoForItem(item, { capture: true }));
    wrap.append(takeButton);

    const uploadButton = document.createElement("button");
    uploadButton.className = "photo-button";
    uploadButton.type = "button";
    uploadButton.textContent = "Upload Photo";
    uploadButton.addEventListener("click", () => savePhotoForItem(item, { capture: false }));
    wrap.append(uploadButton);

    if (meta && variant === "list") {
      const status = document.createElement("span");
      status.className = "photo-status";
      status.textContent = `Photo saved ${new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(meta.takenAt))}`;
      wrap.append(status);

      const image = document.createElement("img");
      image.className = "photo-thumb";
      image.alt = `Stamped photo for ${shortDate(item)}`;
      loadPhotoImage(image, meta);
      wrap.append(image);

      const deleteButton = document.createElement("button");
      deleteButton.className = "photo-button danger";
      deleteButton.type = "button";
      deleteButton.textContent = "Delete Photo";
      deleteButton.addEventListener("click", async () => {
        if (!window.confirm("Delete this photo from Supabase?")) {
          return;
        }
        await deleteCloudPhoto(meta);
        render();
      });
      wrap.append(deleteButton);
    }

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

    cell.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
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

  client.auth.getSession().then(({ data }) => {
    currentUser = data.session?.user || null;
    if (currentUser) {
      refreshPhotos();
    }
  });

  client.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user || null;
    if (currentUser) {
      refreshPhotos();
    } else {
      photoRecords = [];
      photoIndex = new Map();
    }
  });

  async function savePhotoForItem(item, { capture }) {
    if (!currentUser) {
      window.alert("Please sign in first so the photo can save to Supabase.");
      return;
    }

    const file = await choosePhotoFile({ capture });
    if (!file) {
      return;
    }

    try {
      const { blob, takenAt } = await createStampedPhoto(file, item);
      const fileName = cloudPhotoFileName(item, takenAt);
      const photo = await uploadCloudPhoto(item, blob, fileName, takenAt);
      photoRecords = [photo, ...photoRecords.filter((record) => record.filePath !== photo.filePath)];
      setLatestPhotoForDay(photo);
      render();
    } catch (error) {
      window.alert(`The photo did not upload to Supabase.\n\n${error.message || error}`);
    }
  }

  async function uploadCloudPhoto(item, blob, fileName, takenAt) {
    const filePath = `${currentUser.id}/${item.isoDate}/${fileName}`;
    const upload = await client.storage
      .from(PHOTO_BUCKET)
      .upload(filePath, blob, { contentType: "image/jpeg", upsert: true });

    if (upload.error) {
      throw upload.error;
    }

    const row = await client
      .from("photos")
      .insert({
        user_id: currentUser.id,
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
      .single();

    if (row.error) {
      throw row.error;
    }

    return normalizePhoto(row.data);
  }

  async function refreshPhotos() {
    if (!currentUser) {
      return;
    }

    const result = await client
      .from("photos")
      .select("id, study_day_id, file_path, file_name, taken_at, english_date, hebrew_date, tractate, assignment")
      .eq("user_id", currentUser.id)
      .order("taken_at", { ascending: false });

    if (result.error) {
      return;
    }

    photoRecords = result.data.map(normalizePhoto);
    photoIndex = new Map();
    for (const photo of photoRecords) {
      setLatestPhotoForDay(photo);
    }
    render();
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
    };
  }

  function setLatestPhotoForDay(photo) {
    const existing = photoIndex.get(photo.studyDayId);
    if (!existing || new Date(photo.takenAt) > new Date(existing.takenAt)) {
      photoIndex.set(photo.studyDayId, photo);
    }
  }

  async function deleteCloudPhoto(photo) {
    const storage = await client.storage.from(PHOTO_BUCKET).remove([photo.filePath]);
    if (storage.error) {
      throw storage.error;
    }

    const row = await client
      .from("photos")
      .delete()
      .eq("id", photo.rowId)
      .eq("user_id", currentUser.id);

    if (row.error) {
      throw row.error;
    }

    photoRecords = photoRecords.filter((record) => record.rowId !== photo.rowId);
    photoIndex = new Map();
    for (const record of photoRecords) {
      setLatestPhotoForDay(record);
    }
  }

  async function signedPhotoUrl(filePath) {
    const result = await client.storage.from(PHOTO_BUCKET).createSignedUrl(filePath, 600);
    if (result.error) {
      throw result.error;
    }
    return result.data.signedUrl;
  }

  function loadPhotoImage(image, photo) {
    signedPhotoUrl(photo.filePath)
      .then((url) => {
        if (image.isConnected) {
          image.src = url;
        }
      })
      .catch(() => image.remove());
  }

  function choosePhotoFile({ capture }) {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      if (capture) {
        input.capture = "environment";
      }
      input.addEventListener("change", () => resolve(input.files?.[0] || null), {
        once: true,
      });
      input.click();
    });
  }

  function cloudPhotoFileName(item, takenAt) {
    const time = takenAt.slice(11, 19).replace(/:/g, "-");
    return `${item.isoDate}_${item.id}_${time}.jpg`;
  }
})();
