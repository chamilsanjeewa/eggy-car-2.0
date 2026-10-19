import { MAPS } from "./maps";
import { DIFFICULTIES } from "./difficulty";
import { loadBoard, totalsRanked, medal, SHOW } from "./leaderboard";

/** Real leaderboard tables (longest runs, lifetime meters) from this device's saved runs. */
function renderBoards(): void {
  const runsBox = document.getElementById("board-runs");
  const totalsBox = document.getElementById("board-totals");
  if (!runsBox || !totalsBox) return;
  let me = "";
  try {
    me = localStorage.getItem("eggrally.username") ?? "";
  } catch {
    /* storage unavailable */
  }
  const heading = document.getElementById("my-records-title");
  if (heading && me) heading.textContent = `${me}'s records (this browser)`;
  const board = loadBoard();
  const table = (head: string[], rows: string[][], names: string[]) => {
    if (!rows.length) return `<p class="placeholder">No runs yet — play Endless mode to get on the board!</p>`;
    const t = document.createElement("table");
    t.className = "board";
    t.innerHTML = `<thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead>`;
    const body = document.createElement("tbody");
    rows.forEach((r, i) => {
      const tr = document.createElement("tr");
      if (names[i] === me) tr.className = "me";
      for (const cell of r) {
        const td = document.createElement("td");
        td.textContent = cell;
        tr.appendChild(td);
      }
      body.appendChild(tr);
    });
    t.appendChild(body);
    return t;
  };
  const runs = board.runs.slice(0, SHOW);
  const r = table(
    ["#", "Driver", "Distance", "Vehicle", "Terrain", "Date"],
    runs.map((e, i) => [medal(i + 1), e.name === me ? `${e.name} (you)` : e.name, `${e.meters.toLocaleString()} m`, e.vehicle, `${e.map} · ${e.difficulty}`, new Date(e.date).toLocaleDateString()]),
    runs.map((e) => e.name),
  );
  const totals = totalsRanked(board).slice(0, SHOW);
  const t = table(
    ["#", "Driver", "Total distance"],
    totals.map((e, i) => [medal(i + 1), e.name === me ? `${e.name} (you)` : e.name, `${e.meters.toLocaleString()} m`]),
    totals.map((e) => e.name),
  );
  if (typeof r === "string") runsBox.innerHTML = r;
  else runsBox.replaceChildren(r);
  if (typeof t === "string") totalsBox.innerHTML = t;
  else totalsBox.replaceChildren(t);
}

/** Fills "Your records" on the leaderboard page from the game's saved bests. */
function renderMyRecords(): void {
  const box = document.getElementById("my-records");
  if (!box) return;
  const rows: [string, string, string, string][] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) ?? "";
      const value = Number(localStorage.getItem(key));
      if (!value) continue;
      const parts = key.split(".");
      // eggrally.best.<map>.<difficulty>  and  eggrally.trial.<course>.<map>.<difficulty>
      if (parts[0] === "eggrally" && parts[1] === "best" && parts.length === 4) {
        rows.push(["Endless", mapName(parts[2]), diffName(parts[3]), `${value.toLocaleString()} m`]);
      } else if (parts[0] === "eggrally" && parts[1] === "trial" && parts.length === 5) {
        rows.push([`Time Trial (${parts[2]})`, mapName(parts[3]), diffName(parts[4]), formatTime(value)]);
      }
    }
  } catch {
    /* storage unavailable */
  }
  if (rows.length === 0) {
    box.innerHTML = `<p class="placeholder">No records yet — go play a run!</p>`;
    return;
  }
  const table = document.createElement("table");
  table.innerHTML = "<thead><tr><th>Mode</th><th>Terrain</th><th>Difficulty</th><th>Best</th></tr></thead>";
  const body = document.createElement("tbody");
  for (const r of rows.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]))) {
    const tr = document.createElement("tr");
    for (const cell of r) {
      const td = document.createElement("td");
      td.textContent = cell;
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
  table.appendChild(body);
  box.replaceChildren(table);
}

const mapName = (id: string) => MAPS.find((m) => m.id === id)?.name ?? id;
const diffName = (id: string) => DIFFICULTIES.find((d) => d.id === id)?.name ?? id;
function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(2).padStart(5, "0")}`;
}

/** The contact form is a placeholder: it validates and says thanks, but sends nothing. */
function setupContactForm(): void {
  const form = document.getElementById("contact-form") as HTMLFormElement | null;
  if (!form) return;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const status = document.getElementById("form-status")!;
    if (!form.checkValidity()) {
      status.textContent = "Please fill in your name, a valid email and a message.";
      return;
    }
    status.textContent = "✅ Thanks! (This is a demo form — nothing was actually sent.)";
    form.reset();
  });
}

renderMyRecords();
renderBoards();
setupContactForm();
