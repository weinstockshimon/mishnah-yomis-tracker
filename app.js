const DATA = window.MISHNAH_YOMIS_DATA;
const STORAGE_KEY = `mishnah-yomis-progress-v1:${DATA.sourceWorkbook}:${DATA.totalRows}`;

const elements = {
  todayWeekday: document.querySelector("#todayWeekday"),
  todayDate: document.querySelector("#todayDate"),
  dueCount: document.querySelector("#dueCount"),
  dueDetail: document.querySelector("#dueDetail"),
  completedCount: document.querySelector("#completedCount"),
  completedDetail: document.querySelector("#completedDetail"),
  remainingCount: document.querySelector("#remainingCount"),
  remainingDetail: document.querySelector("#remainingDetail"),
  nextPartCount: document.querySelector("#nextPartCount"),
  nextPartDetail: document.querySelector("#nextPartDetail"),
  toolbar: document.querySelector(".toolbar"),
  taskList: document.querySelector("#taskList"),
  calendarView: document.querySelector("#calendarView"),
  calendarGrid: document.querySelector("#calendarGrid"),
  calendarTitle: document.querySelector("#calendarTitle"),
  previousMonth: document.querySelector("#previousMonth"),
  nextMonth: document.querySelector("#nextMonth"),
  todayButton: document.querySelector("#todayButton"),
  template: document.querySelector("#taskTemplate"),
  layoutButtons: [...document.querySelectorAll("[data-calendar-layout]")],
  filterButtons: [...document.querySelectorAll("[data-filter]")],
};

let activeFilter = "due";
let calendarLayout = "english";
const initialCalendarIso = localToday();
let calendarFocusIso = initialCalendarIso;
let calendarCursor = monthStart(dateFromIso(calendarFocusIso));
const hebrewMonths = buildHebrewMonths(DATA.items);
const holidayLookup = buildHolidayLookup(DATA.items);
const tractateSegments = buildTractateSegments(DATA.items);
let hebrewCursorIndex = findHebrewMonthIndex(calendarFocusIso);
let state = loadState();

function localToday() {
  const params = new URLSearchParams(window.location.search);
  const override = params.get("date");
  if (/^\d{4}-\d{2}-\d{2}$/.test(override || "")) {
    return override;
  }

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromIso(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function isoFromDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function shiftFocusByEnglishMonth(delta) {
  const focus = dateFromIso(calendarFocusIso);
  const targetYear = focus.getFullYear();
  const targetMonth = focus.getMonth() + delta;
  const firstOfTarget = new Date(targetYear, targetMonth, 1);
  const targetDay = Math.min(
    focus.getDate(),
    daysInMonth(firstOfTarget.getFullYear(), firstOfTarget.getMonth()),
  );
  calendarFocusIso = isoFromDate(
    new Date(firstOfTarget.getFullYear(), firstOfTarget.getMonth(), targetDay),
  );
  calendarCursor = monthStart(dateFromIso(calendarFocusIso));
}

function parseHebrewDate(hebrewDate) {
  const parts = String(hebrewDate || "").trim().split(/\s+/);
  const day = Number(parts[0]);
  const year = parts[parts.length - 1];
  const month = parts.slice(1, -1).join(" ");
  return { day, month, year, key: `${month} ${year}` };
}

function buildHebrewMonths(items) {
  const months = [];
  let current = null;

  items.forEach((item, index) => {
    const hebrew = parseHebrewDate(item.hebrewDate);
    if (!current || current.key !== hebrew.key) {
      current = {
        key: hebrew.key,
        title: hebrew.key,
        startIndex: index,
        endIndex: index,
        items: [],
      };
      months.push(current);
    }
    current.endIndex = index;
    current.items.push({ item, hebrew, index });
  });

  return months;
}

function findHebrewMonthIndex(todayIso) {
  const itemIndex = DATA.items.findIndex((item) => item.isoDate === todayIso);
  if (itemIndex === -1) {
    return Math.max(0, hebrewMonths.findIndex((month) => month.endIndex >= 0));
  }

  const monthIndex = hebrewMonths.findIndex(
    (month) => itemIndex >= month.startIndex && itemIndex <= month.endIndex,
  );
  return Math.max(0, monthIndex);
}

function itemForIso(isoDate) {
  return DATA.items.find((item) => item.isoDate === isoDate);
}

function splitTractates(tractate) {
  return String(tractate || "")
    .split(/\s*[-–]\s*/)
    .map((name) => name.trim())
    .filter(Boolean);
}

function buildTractateSegments(items) {
  const segmentsByName = new Map();

  items.forEach((item, index) => {
    for (const name of splitTractates(item.tractate)) {
      const segment = segmentsByName.get(name) || {
        name,
        startIndex: index,
        endIndex: index,
      };
      segment.startIndex = Math.min(segment.startIndex, index);
      segment.endIndex = Math.max(segment.endIndex, index);
      segmentsByName.set(name, segment);
    }
  });

  return [...segmentsByName.values()].sort((a, b) => a.startIndex - b.startIndex);
}

function currentScheduleItem(todayIso) {
  return (
    DATA.items.find((item) => item.isoDate === todayIso) ||
    DATA.items.find((item) => item.isoDate > todayIso) ||
    DATA.items.at(-1)
  );
}

function currentTractateName(todayIso) {
  const item = currentScheduleItem(todayIso);
  const names = splitTractates(item?.tractate);
  return names.at(-1) || "";
}

function currentPartSummary(todayIso) {
  const name = currentTractateName(todayIso);
  const segment = tractateSegments.find((entry) => entry.name === name);

  if (!segment) {
    return {
      count: 0,
      detail: "Calendar complete",
    };
  }

  const segmentItems = DATA.items
    .slice(segment.startIndex, segment.endIndex + 1)
    .filter((item) => splitTractates(item.tractate).includes(name));
  const remainingInPart = segmentItems.filter((item) => !state.completed[item.id]).length;
  const finishItem = DATA.items[segment.endIndex];

  return {
    count: remainingInPart,
    detail: `${name} ends ${finishItem.weekday}, ${shortDate(finishItem)}`,
  };
}

function isPurimMonth(month) {
  return month === "Adar" || month === "Adar II";
}

function addHoliday(lookup, item, name) {
  if (!item) {
    return;
  }

  const names = lookup.get(item.id) || [];
  if (!names.includes(name)) {
    names.push(name);
  }
  lookup.set(item.id, names);
}

function findHebrewItem(items, year, month, day) {
  return items.find((item) => {
    const hebrew = parseHebrewDate(item.hebrewDate);
    return hebrew.year === year && hebrew.month === month && hebrew.day === day;
  });
}

function buildHolidayLookup(items) {
  const lookup = new Map();

  for (const item of items) {
    const hebrew = parseHebrewDate(item.hebrewDate);
    const { day, month } = hebrew;

    if (month === "Tishrei") {
      if (day === 1 || day === 2) addHoliday(lookup, item, "Rosh Hashanah");
      if (day === 10) addHoliday(lookup, item, "Yom Kippur");
      if (day === 15 || day === 16) addHoliday(lookup, item, "Sukkos");
      if (day >= 17 && day <= 20) addHoliday(lookup, item, "Chol Hamoed Sukkos");
      if (day === 21) addHoliday(lookup, item, "Hoshana Rabbah");
      if (day === 22) addHoliday(lookup, item, "Shemini Atzeres");
      if (day === 23) addHoliday(lookup, item, "Simchas Torah");
    }

    if (month === "Teves" && day === 10) addHoliday(lookup, item, "Asara B'Teves");
    if (month === "Shevat" && day === 15) addHoliday(lookup, item, "Tu BiShvat");
    if (month === "Adar I" && day === 14) addHoliday(lookup, item, "Purim Katan");
    if (month === "Adar I" && day === 15) addHoliday(lookup, item, "Shushan Purim Katan");
    if (isPurimMonth(month) && day === 14) addHoliday(lookup, item, "Purim");
    if (isPurimMonth(month) && day === 15) addHoliday(lookup, item, "Shushan Purim");

    if (month === "Nisan") {
      if (day === 15 || day === 16) addHoliday(lookup, item, "Pesach");
      if (day >= 17 && day <= 20) addHoliday(lookup, item, "Chol Hamoed Pesach");
      if (day === 21 || day === 22) addHoliday(lookup, item, "Last Days Pesach");
    }

    if (month === "Iyar" && day === 14) addHoliday(lookup, item, "Pesach Sheni");
    if (month === "Iyar" && day === 18) addHoliday(lookup, item, "Lag BaOmer");
    if (month === "Sivan" && (day === 6 || day === 7)) addHoliday(lookup, item, "Shavuos");
    if (month === "Av" && day === 15) addHoliday(lookup, item, "Tu B'Av");
  }

  const years = [...new Set(items.map((item) => parseHebrewDate(item.hebrewDate).year))];
  for (const year of years) {
    const tishrei3 = findHebrewItem(items, year, "Tishrei", 3);
    const tishrei4 = findHebrewItem(items, year, "Tishrei", 4);
    addHoliday(
      lookup,
      tishrei3?.weekday === "Saturday" ? tishrei4 : tishrei3,
      "Tzom Gedaliah",
    );

    const purimMonth = findHebrewItem(items, year, "Adar II", 14)
      ? "Adar II"
      : "Adar";
    const adar13 = findHebrewItem(items, year, purimMonth, 13);
    const adar11 = findHebrewItem(items, year, purimMonth, 11);
    addHoliday(
      lookup,
      adar13?.weekday === "Saturday" ? adar11 : adar13,
      "Taanis Esther",
    );

    const tamuz17 = findHebrewItem(items, year, "Tamuz", 17);
    const tamuz18 = findHebrewItem(items, year, "Tamuz", 18);
    addHoliday(
      lookup,
      tamuz17?.weekday === "Saturday" ? tamuz18 : tamuz17,
      "Shivah Asar B'Tamuz",
    );

    const av9 = findHebrewItem(items, year, "Av", 9);
    const av10 = findHebrewItem(items, year, "Av", 10);
    addHoliday(lookup, av9?.weekday === "Saturday" ? av10 : av9, "Tisha B'Av");

    const kislev25 = findHebrewItem(items, year, "Kislev", 25);
    if (kislev25) {
      const startIndex = items.findIndex((item) => item.id === kislev25.id);
      for (let offset = 0; offset < 8; offset += 1) {
        addHoliday(lookup, items[startIndex + offset], "Chanukah");
      }
    }
  }

  return lookup;
}

function setHebrewFocusMonth(monthIndex) {
  const currentItem = itemForIso(calendarFocusIso);
  const currentHebrew = currentItem ? parseHebrewDate(currentItem.hebrewDate) : null;
  hebrewCursorIndex = Math.max(0, Math.min(hebrewMonths.length - 1, monthIndex));

  const targetMonth = hebrewMonths[hebrewCursorIndex];
  const targetEntry =
    targetMonth.items.find((entry) => entry.hebrew.day === currentHebrew?.day) ||
    targetMonth.items.at(-1);

  calendarFocusIso = targetEntry.item.isoDate;
}

function shortDate(item) {
  return item.englishDate.replace(/(\d{4})$/, "").trim();
}

function loadState() {
  const initial = {};
  for (const item of DATA.items) {
    initial[item.id] = item.sourceCompleted;
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { completed: initial };
    }

    const saved = JSON.parse(raw);
    const completed = { ...initial };
    if (saved && saved.completed && typeof saved.completed === "object") {
      for (const [id, value] of Object.entries(saved.completed)) {
        if (Object.prototype.hasOwnProperty.call(completed, id)) {
          completed[id] = Boolean(value);
        }
      }
    }
    return { completed };
  } catch {
    return { completed: initial };
  }
}

function saveState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      updatedAt: new Date().toISOString(),
      completed: state.completed,
    }),
  );
}

function todayContext(todayIso) {
  const item = DATA.items.find((entry) => entry.isoDate === todayIso);
  if (item) {
    return {
      weekday: item.weekday,
      date: item.englishDate,
    };
  }

  const date = dateFromIso(todayIso);
  return {
    weekday: new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(date),
    date: new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(date),
  };
}

function getCollections(todayIso) {
  const due = DATA.items.filter(
    (item) => item.isoDate <= todayIso && !state.completed[item.id],
  );
  const upcoming = DATA.items.filter(
    (item) => item.isoDate > todayIso && !state.completed[item.id],
  );
  const completed = DATA.items.filter((item) => state.completed[item.id]);
  const remaining = DATA.items.length - completed.length;
  const nextIncomplete = DATA.items.find((item) => !state.completed[item.id]);

  return { due, upcoming, completed, remaining, nextIncomplete };
}

function statusFor(item, todayIso) {
  if (state.completed[item.id]) {
    return { label: "Done", className: "done" };
  }
  if (item.isoDate < todayIso) {
    return { label: "Missed", className: "overdue" };
  }
  if (item.isoDate === todayIso) {
    return { label: "Today", className: "today" };
  }
  return { label: "Upcoming", className: "" };
}

function visibleItems(collections) {
  if (activeFilter === "due") {
    return collections.due;
  }
  if (activeFilter === "upcoming") {
    return collections.upcoming;
  }
  if (activeFilter === "completed") {
    return [...collections.completed].reverse();
  }
  return DATA.items;
}

function renderTask(item, todayIso) {
  const fragment = elements.template.content.cloneNode(true);
  const card = fragment.querySelector(".task-card");
  const checkbox = fragment.querySelector("input");
  const status = fragment.querySelector(".status-label");
  const date = fragment.querySelector(".date-label");
  const hebrewDate = fragment.querySelector(".hebrew-date");
  const taskMain = fragment.querySelector(".task-main");
  const tractate = fragment.querySelector(".tractate");
  const assignment = fragment.querySelector(".assignment");
  const statusInfo = statusFor(item, todayIso);

  checkbox.checked = state.completed[item.id];
  checkbox.setAttribute("aria-label", `Mark ${shortDate(item)} complete`);
  status.textContent = statusInfo.label;
  status.className = `status-label ${statusInfo.className}`.trim();
  date.textContent = `${item.weekday}, ${item.englishDate}`;
  hebrewDate.textContent = item.hebrewDate;
  tractate.textContent = item.tractate;
  assignment.textContent = item.assignment;
  card.classList.toggle("done", checkbox.checked);

  checkbox.addEventListener("change", () => {
    state.completed[item.id] = checkbox.checked;
    saveState();
    render();
  });


  return fragment;
}

function renderEmpty(collections) {
  const message = document.createElement("div");
  message.className = "empty-state";

  if (activeFilter === "due") {
    message.textContent = collections.upcoming.length
      ? "All due study is complete."
      : "The calendar is complete.";
  } else {
    message.textContent = "No items in this view.";
  }

  elements.taskList.append(message);
}

function renderCalendarDay({ date, dayNumber, item, outsideMonth, todayIso }) {
  const isoDate = item ? item.isoDate : isoFromDate(date);
  const cell = document.createElement("div");
  cell.className = "calendar-day";
  cell.classList.toggle("outside-month", outsideMonth);
  cell.classList.toggle("is-today", isoDate === todayIso);

  const dayHeader = document.createElement("div");
  dayHeader.className = "calendar-day-header";

  const dayNumberLabel = document.createElement("span");
  dayNumberLabel.className = "day-number";
  dayNumberLabel.textContent = String(dayNumber);
  dayHeader.append(dayNumberLabel);

  if (item) {
    const statusInfo = statusFor(item, todayIso);
    const label = document.createElement("span");
    label.className = `calendar-status ${statusInfo.className}`.trim();
    label.textContent = statusInfo.label;
    dayHeader.append(label);
  }

  cell.append(dayHeader);

  if (!item) {
    cell.classList.add("no-study");
    return cell;
  }

  cell.classList.toggle("done", state.completed[item.id]);

  const holidays = holidayLookup.get(item.id) || [];
  if (holidays.length) {
    const holidayWrap = document.createElement("div");
    holidayWrap.className = "holiday-list";
    for (const holiday of holidays) {
      const chip = document.createElement("span");
      chip.className = "holiday-chip";
      chip.textContent = holiday;
      holidayWrap.append(chip);
    }
    cell.append(holidayWrap);
  }

  const body = document.createElement("div");
  body.className = "calendar-study";

  const checkboxLabel = document.createElement("label");
  checkboxLabel.className = "calendar-check";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = state.completed[item.id];
  checkbox.setAttribute("aria-label", `Mark ${shortDate(item)} complete`);
  const checkboxMark = document.createElement("span");
  checkboxMark.className = "calendar-checkmark";
  checkboxMark.setAttribute("aria-hidden", "true");
  checkboxLabel.append(checkbox, checkboxMark);

  const details = document.createElement("div");
  details.className = "calendar-details";
  const hebrewDate = document.createElement("span");
  hebrewDate.className = "calendar-hebrew";
  hebrewDate.textContent = item.hebrewDate;
  const tractate = document.createElement("strong");
  tractate.dir = "rtl";
  tractate.textContent = item.tractate;
  const assignment = document.createElement("span");
  assignment.className = "calendar-assignment";
  assignment.textContent = item.assignment;
  details.append(hebrewDate, tractate, assignment);

  checkbox.addEventListener("change", () => {
    state.completed[item.id] = checkbox.checked;
    saveState();
    render();
  });

  body.append(checkboxLabel, details);
  cell.append(body);

  return cell;
}

function renderCalendar(todayIso) {
  if (calendarLayout === "hebrew") {
    renderHebrewCalendar(todayIso);
    return;
  }

  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const itemsByDate = new Map(DATA.items.map((item) => [item.isoDate, item]));
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  });

  elements.calendarTitle.textContent = formatter.format(first);
  elements.calendarGrid.replaceChildren();

  const fragment = document.createDocumentFragment();
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const isoDate = isoFromDate(date);
    fragment.append(
      renderCalendarDay({
        date,
        dayNumber: date.getDate(),
        item: itemsByDate.get(isoDate),
        outsideMonth: date.getMonth() !== month,
        todayIso,
      }),
    );
  }
  elements.calendarGrid.append(fragment);
}

function renderHebrewCalendar(todayIso) {
  const month = hebrewMonths[hebrewCursorIndex] || hebrewMonths[0];
  const firstEntry = month.items[0];
  const leadingDays = dateFromIso(firstEntry.item.isoDate).getDay();
  const cells = [];

  for (let offset = leadingDays; offset > 0; offset -= 1) {
    const outside = DATA.items[month.startIndex - offset];
    cells.push({ item: outside, outsideMonth: true });
  }

  for (const entry of month.items) {
    cells.push({ item: entry.item, outsideMonth: false });
  }

  while (cells.length < 42) {
    const next = DATA.items[month.endIndex + (cells.length - leadingDays - month.items.length) + 1];
    cells.push({ item: next, outsideMonth: true });
  }

  elements.calendarTitle.textContent = month.title;
  elements.calendarGrid.replaceChildren();

  const fragment = document.createDocumentFragment();
  cells.forEach((cell, index) => {
    const item = cell.item;
    const hebrew = item ? parseHebrewDate(item.hebrewDate) : null;
    fragment.append(
      renderCalendarDay({
        date: item ? dateFromIso(item.isoDate) : new Date(),
        dayNumber: hebrew ? hebrew.day : index + 1,
        item,
        outsideMonth: cell.outsideMonth || !item,
        todayIso,
      }),
    );
  });
  elements.calendarGrid.append(fragment);
}

function render() {
  const todayIso = localToday();
  const today = todayContext(todayIso);
  const collections = getCollections(todayIso);
  const completedCount = DATA.items.length - collections.remaining;
  const partSummary = currentPartSummary(todayIso);
  const items = visibleItems(collections);

  elements.todayWeekday.textContent = today.weekday;
  elements.todayDate.textContent = today.date;
  elements.dueCount.textContent = String(collections.due.length);
  elements.dueDetail.textContent =
    collections.due.length === 1 ? "1 day waiting" : `${collections.due.length} days waiting`;
  elements.completedCount.textContent = String(completedCount);
  elements.completedDetail.textContent = `of ${DATA.items.length}`;
  elements.remainingCount.textContent = String(collections.remaining);
  elements.remainingDetail.textContent = `Finish ${shortDate(DATA.items.at(-1))}`;
  elements.nextPartCount.textContent = String(partSummary.count);
  elements.nextPartDetail.textContent = partSummary.detail;

  elements.layoutButtons.forEach((button) => {
    button.classList.toggle(
      "active",
      button.dataset.calendarLayout === calendarLayout,
    );
  });
  elements.calendarView.classList.toggle(
    "hebrew-layout",
    calendarLayout === "hebrew",
  );

  elements.filterButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === activeFilter);
  });

  renderCalendar(todayIso);
  elements.taskList.replaceChildren();
  if (!items.length) {
    renderEmpty(collections);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const item of items) {
    fragment.append(renderTask(item, todayIso));
  }
  elements.taskList.append(fragment);
}

elements.layoutButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const nextLayout = button.dataset.calendarLayout;
    if (nextLayout === calendarLayout) {
      return;
    }

    if (nextLayout === "hebrew") {
      hebrewCursorIndex = findHebrewMonthIndex(calendarFocusIso);
    } else {
      calendarCursor = monthStart(dateFromIso(calendarFocusIso));
    }

    calendarLayout = nextLayout;
    render();
  });
});

elements.filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    render();
  });
});

elements.previousMonth.addEventListener("click", () => {
  if (calendarLayout === "hebrew") {
    setHebrewFocusMonth(hebrewCursorIndex - 1);
    render();
    return;
  }

  shiftFocusByEnglishMonth(-1);
  render();
});

elements.nextMonth.addEventListener("click", () => {
  if (calendarLayout === "hebrew") {
    setHebrewFocusMonth(hebrewCursorIndex + 1);
    render();
    return;
  }

  shiftFocusByEnglishMonth(1);
  render();
});

elements.todayButton.addEventListener("click", () => {
  calendarFocusIso = localToday();
  calendarCursor = monthStart(dateFromIso(calendarFocusIso));
  hebrewCursorIndex = findHebrewMonthIndex(calendarFocusIso);
  render();
});

render();
