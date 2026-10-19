import { VEHICLES, VehicleDef, vehicleById } from "./vehicles";
import { MAPS, MapDef } from "./maps";
import { drawVehiclePreview, drawMapPreview } from "./render";
import { Stats, achievementFor, progressText, progressFraction } from "./achievements";
import { INTERIOR_GROUPS, InteriorConfig, InteriorGroup, InteriorOption, resolveInterior } from "./interior";
import { CockpitState, drawCabin, drawDashboard, drawDashToy, drawSteeringWheel, drawMirrorFrame, drawHood, mirrorRect, COCKPIT } from "./cockpit";
import { PARTS, PAINTS, PartDef, Paint, VehicleMods, MAX_LEVEL, EGG_CARE, applyMods } from "./upgrades";
import {
  CarSpec, MapSpec, BODY_STYLES, ENGINE_SOUNDS, THEMES, DECORS, GRAVITIES, DEFAULT_CAR, DEFAULT_MAP,
  carPrice, MAP_PRICE, buildCarDef, buildMapDef, customCars, customMaps, newId,
} from "./custom";

export type GarageTab = "vehicles" | "parts" | "interior" | "terrains" | "egg" | "workshop";

export interface GarageState {
  coins: number;
  owned: Set<string>;
  selected: string;
  ownedMaps: Set<string>;
  selectedMap: string;
  /** Mods of the selected vehicle. */
  mods: VehicleMods;
  ownedPaints: Set<string>;
  lives: number;
  armor: number;
  stats: Stats;
  interior: InteriorConfig;
  /** Owned interior items as "group:id". */
  ownedInterior: Set<string>;
  /** Progress toward the Eggy Plane (own everything). */
  planeProgress?: { have: number; total: number; missing: string[] };
}

export interface GarageActions {
  buy(def: VehicleDef): void;
  select(def: VehicleDef): void;
  buyMap(map: MapDef): void;
  selectMap(map: MapDef): void;
  buyPart(part: PartDef): void;
  choosePaint(paint: Paint): void;
  buyLife(): void;
  buyArmor(): void;
  chooseInterior(group: InteriorGroup, option: InteriorOption): void;
  /** Workshop: build (or rebuild) a custom car / terrain for `price` coins, or delete one. */
  buildCar(spec: CarSpec, price: number): void;
  buildMap(spec: MapSpec, price: number): void;
  deleteCar(id: string): void;
  deleteMap(id: string): void;
}

interface CardSpec {
  name: string;
  blurb: string;
  tag?: string;
  stats: [string, number][];
  price: number;
  owned: boolean;
  selected: boolean;
  preview: (canvas: HTMLCanvasElement) => void;
  onBuy: () => void;
  onSelect: () => void;
  /** Unlocked by an achievement instead of coins. */
  lock?: { title: string; goal: string; progress: string; fraction: number };
}

const TABS: [GarageTab, string][] = [
  ["vehicles", "Vehicles"],
  ["parts", "Parts"],
  ["interior", "Interior"],
  ["terrains", "Terrains"],
  ["egg", "Egg Care"],
  ["workshop", "🔧 Workshop"],
];

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/** Builds the garage card list. Call `render` again whenever coins/ownership change. */
export class Garage {
  tab: GarageTab = "vehicles";

  constructor(
    private list: HTMLElement,
    private coinsEl: HTMLElement,
    private tabs: HTMLElement,
    private actions: GarageActions,
  ) {}

  render(state: GarageState): void {
    this.coinsEl.textContent = String(state.coins);
    this.renderTabs(state);
    this.list.replaceChildren();
    this.list.classList.toggle("single", this.tab === "parts" || this.tab === "egg" || this.tab === "interior" || this.tab === "workshop");
    if (this.tab === "workshop") return this.renderWorkshop(state);
    if (this.tab === "parts") return this.renderParts(state);
    if (this.tab === "interior") return this.renderInterior(state);
    if (this.tab === "egg") return this.renderEggCare(state);

    const specs: CardSpec[] =
      this.tab === "vehicles"
        ? VEHICLES.map((def) => ({
            name: def.name,
            blurb: def.blurb,
            stats: [
              ["Speed", def.stats.speed],
              ["Power", def.stats.power],
              ["Stability", def.stats.stability],
            ],
            price: def.price,
            owned: state.owned.has(def.id),
            selected: state.selected === def.id,
            preview: (c) => drawVehiclePreview(c, def.id === state.selected ? applyMods(def, state.mods) : def),
            onBuy: () => this.actions.buy(def),
            lock: this.lockFor("vehicle", def.id, state),
            onSelect: () => this.actions.select(def),
          }))
        : MAPS.map((map) => ({
            name: map.name,
            blurb: map.blurb,
            tag: map.tag,
            stats: [
              ["Hills", map.stats.hills],
              ["Grip", map.stats.grip],
            ],
            price: map.price,
            owned: state.ownedMaps.has(map.id),
            selected: state.selectedMap === map.id,
            preview: (c) => drawMapPreview(c, map),
            onBuy: () => this.actions.buyMap(map),
            lock: this.lockFor("map", map.id, state),
            onSelect: () => this.actions.selectMap(map),
          }));

    const previews: [HTMLCanvasElement, CardSpec][] = [];
    for (const spec of specs) {
      const { card, canvas } = this.card(spec, state.coins);
      this.list.appendChild(card);
      previews.push([canvas, spec]);
    }
    // Canvases need to be in the DOM to know their size.
    for (const [canvas, spec] of previews) spec.preview(canvas);
  }

  // ---------- Workshop: build your own cars and terrains ----------

  private wsMode: "car" | "map" = "car";
  private carDraft: CarSpec = { id: "", ...DEFAULT_CAR };
  private mapDraft: MapSpec = { id: "", ...DEFAULT_MAP };

  private renderWorkshop(state: GarageState): void {
    const wrap = el("div", "workshop");
    const modes = el("div", "segmented ws-modes");
    for (const [id, label] of [
      ["car", "🚗 Build a car"],
      ["map", "🏞️ Build a terrain"],
    ] as const) {
      const b = el("button", this.wsMode === id ? "active" : "", label);
      b.addEventListener("click", () => {
        this.wsMode = id;
        this.render(state);
      });
      modes.appendChild(b);
    }
    wrap.appendChild(modes);
    const body = el("div", "ws-body");
    const preview = el("canvas", "ws-preview");
    const form = el("div", "ws-form");
    body.append(preview, form);
    wrap.appendChild(body);
    this.list.appendChild(wrap);

    const redraw = () => {
      if (this.wsMode === "car") drawVehiclePreview(preview, buildCarDef({ ...this.carDraft, id: "draft" }));
      else drawMapPreview(preview, buildMapDef({ ...this.mapDraft, id: "draft" }));
    };
    const field = (label: string, input: HTMLElement) => {
      const row = el("label", "ws-row");
      row.append(el("span", "ws-label", label), input);
      form.appendChild(row);
    };
    const select = <T extends string | number>(opts: [T, string][], value: T, set: (v: T) => void) => {
      const sel = el("select");
      for (const [v, name] of opts) {
        const o = el("option", "", name);
        o.value = String(v);
        o.selected = v === value;
        sel.appendChild(o);
      }
      sel.addEventListener("change", () => {
        const pick = opts.find((o) => String(o[0]) === sel.value);
        if (pick) set(pick[0]);
        redraw();
        updatePrice();
      });
      return sel;
    };
    const slider = (min: number, max: number, step: number, value: number, set: (v: number) => void, fmt: (v: number) => string) => {
      const box = el("span", "ws-slider");
      const r = el("input");
      r.type = "range";
      r.min = String(min);
      r.max = String(max);
      r.step = String(step);
      r.value = String(value);
      const out = el("output", "", fmt(value));
      r.addEventListener("input", () => {
        set(Number(r.value));
        out.textContent = fmt(Number(r.value));
        redraw();
        updatePrice();
      });
      box.append(r, out);
      return box;
    };
    const check = (value: boolean, set: (v: boolean) => void) => {
      const c = el("input");
      c.type = "checkbox";
      c.checked = value;
      c.addEventListener("change", () => {
        set(c.checked);
        redraw();
      });
      return c;
    };
    const nameInput = (value: string, set: (v: string) => void) => {
      const i = el("input");
      i.type = "text";
      i.maxLength = 20;
      i.value = value;
      i.addEventListener("input", () => set(i.value.trim()));
      return i;
    };
    const stars = (v: number) => "★".repeat(v) + "☆".repeat(5 - v);
    const pct = (v: number) => `${Math.round(v * 100)}%`;

    const buildBtn = el("button", "vbtn buy ws-build");
    let updatePrice = () => {};
    if (this.wsMode === "car") {
      const d = this.carDraft;
      field("Name", nameInput(d.name, (v) => (d.name = v)));
      field("Body style", select(BODY_STYLES, d.base, (v) => (d.base = v)));
      field("Length", slider(0.8, 1.25, 0.05, d.length, (v) => (d.length = v), pct));
      field("Height", slider(0.8, 1.25, 0.05, d.height, (v) => (d.height = v), pct));
      field("Wheel size", slider(0.8, 1.4, 0.05, d.wheels, (v) => (d.wheels = v), pct));
      const color = el("input");
      color.type = "color";
      color.value = d.color;
      color.addEventListener("input", () => {
        d.color = color.value;
        redraw();
      });
      field("Paint", color);
      field("Speed", slider(1, 5, 1, d.speed, (v) => (d.speed = v), stars));
      field("Power", slider(1, 5, 1, d.power, (v) => (d.power = v), stars));
      field("Grip", slider(1, 5, 1, d.grip, (v) => (d.grip = v), stars));
      field("Comfort", slider(1, 5, 1, d.comfort, (v) => (d.comfort = v), stars));
      field("Engine sound", select(ENGINE_SOUNDS, d.engine, (v) => (d.engine = v)));
      updatePrice = () => {
        const editing = customCars().some((c) => c.id === d.id);
        const price = editing ? 0 : carPrice(d);
        buildBtn.replaceChildren(`${editing ? "Save changes" : "Build it"} `, el("span", "coin-icon"), ` ${price.toLocaleString()}`);
        buildBtn.disabled = state.coins < price;
        buildBtn.title = state.coins < price ? `You need ${(price - state.coins).toLocaleString()} more coins` : "";
      };
      buildBtn.addEventListener("click", () => {
        const editing = customCars().some((c) => c.id === d.id);
        const spec = { ...d, id: editing ? d.id : newId("car") };
        this.actions.buildCar(spec, editing ? 0 : carPrice(d));
        this.carDraft = { id: "", ...DEFAULT_CAR };
      });
    } else {
      const d = this.mapDraft;
      field("Name", nameInput(d.name, (v) => (d.name = v)));
      field("Look", select(THEMES, d.theme, (v) => (d.theme = v)));
      field("Scenery", select(DECORS, d.decor, (v) => (d.decor = v)));
      field("Hills", slider(1, 5, 1, d.hills, (v) => (d.hills = v), stars));
      field("Grip", slider(1, 5, 1, d.grip, (v) => (d.grip = v), stars));
      field("Gravity", select(GRAVITIES, d.gravity, (v) => (d.gravity = v)));
      field("Night & stars", check(d.night, (v) => (d.night = v)));
      field("Snowfall", check(d.snow, (v) => (d.snow = v)));
      field("Falling leaves", check(d.leaves, (v) => (d.leaves = v)));
      field("Mist", check(d.mist, (v) => (d.mist = v)));
      updatePrice = () => {
        const editing = customMaps().some((m) => m.id === d.id);
        const price = editing ? 0 : MAP_PRICE;
        buildBtn.replaceChildren(`${editing ? "Save changes" : "Build it"} `, el("span", "coin-icon"), ` ${price}`);
        buildBtn.disabled = state.coins < price;
      };
      buildBtn.addEventListener("click", () => {
        const editing = customMaps().some((m) => m.id === d.id);
        const spec = { ...d, id: editing ? d.id : newId("map") };
        this.actions.buildMap(spec, editing ? 0 : MAP_PRICE);
        this.mapDraft = { id: "", ...DEFAULT_MAP };
      });
    }
    form.appendChild(buildBtn);
    updatePrice();

    // Your creations: drive / edit / delete
    const mine = this.wsMode === "car" ? customCars() : customMaps();
    const list = el("div", "ws-mine");
    list.appendChild(el("h4", "", mine.length ? (this.wsMode === "car" ? "Your cars" : "Your terrains") : "Nothing built yet — design one above!"));
    for (const item of mine) {
      const row = el("div", "ws-item");
      const pv = el("canvas", "ws-thumb");
      const name = el("b", "", item.name);
      const use = el("button", "vbtn select", this.wsMode === "car" ? "Drive" : "Use");
      const edit = el("button", "vbtn", "Edit");
      const del = el("button", "vbtn ws-del", "Delete");
      use.addEventListener("click", () => (this.wsMode === "car" ? this.actions.select(buildCarDef(item as CarSpec)) : this.actions.selectMap(buildMapDef(item as MapSpec))));
      edit.addEventListener("click", () => {
        if (this.wsMode === "car") this.carDraft = { ...(item as CarSpec) };
        else this.mapDraft = { ...(item as MapSpec) };
        this.render(state);
      });
      del.addEventListener("click", () => {
        if (!window.confirm(`Delete "${item.name}"? This can't be undone.`)) return;
        if (this.wsMode === "car") this.actions.deleteCar(item.id);
        else this.actions.deleteMap(item.id);
      });
      row.append(pv, name, use, edit, del);
      list.appendChild(row);
      requestAnimationFrame(() => (this.wsMode === "car" ? drawVehiclePreview(pv, buildCarDef(item as CarSpec)) : drawMapPreview(pv, buildMapDef(item as MapSpec))));
    }
    wrap.appendChild(list);
    requestAnimationFrame(redraw);
  }

  private lockFor(kind: "vehicle" | "map", id: string, state: GarageState): CardSpec["lock"] {
    if (kind === "vehicle" && id === "eggplane" && state.planeProgress) {
      const p = state.planeProgress;
      const need = p.missing.length ? ` · still need: ${p.missing.slice(0, 4).join(", ")}${p.missing.length > 4 ? ` +${p.missing.length - 4} more` : ""}` : "";
      return { title: "✈️ Collector's prize", goal: "Own every vehicle and terrain", progress: `${p.have} / ${p.total} owned${need}`, fraction: p.have / p.total };
    }
    const a = achievementFor(kind, id);
    if (!a) return undefined;
    return { title: `🏆 ${a.name}`, goal: a.goal, progress: progressText(a, state.stats), fraction: progressFraction(a, state.stats) };
  }

  private renderTabs(state: GarageState): void {
    this.tabs.replaceChildren();
    for (const [id, label] of TABS) {
      const btn = el("button", id === this.tab ? "active" : "", label);
      btn.setAttribute("aria-pressed", String(id === this.tab));
      btn.addEventListener("click", () => {
        this.tab = id;
        this.render(state);
      });
      this.tabs.appendChild(btn);
    }
  }

  private buyButton(price: number, coins: number, label: string, onBuy: () => void): HTMLButtonElement {
    const btn = el("button", "vbtn buy");
    const icon = el("span", "coin-icon");
    btn.append(`${label} `, icon, ` ${price.toLocaleString()}`);
    if (coins < price) {
      btn.disabled = true;
      btn.title = `You need ${(price - coins).toLocaleString()} more coins`;
    } else btn.addEventListener("click", onBuy);
    return btn;
  }

  private pips(level: number, max: number): HTMLElement {
    const bar = el("div", "bar");
    for (let i = 1; i <= max; i++) bar.appendChild(el("i", i <= level ? "on" : ""));
    return bar;
  }

  /** Parts shop for the selected vehicle: performance upgrades and paint. */
  private renderParts(state: GarageState): void {
    const def = vehicleById(state.selected);
    const modded = applyMods(def, state.mods);

    const hero = el("div", "parts-hero");
    const canvas = el("canvas");
    const info = el("div");
    info.append(el("h3", "", def.name), el("p", "", "Upgrades apply to this vehicle only. Switch vehicles in the Vehicles tab."));
    hero.append(canvas, info);
    this.list.appendChild(hero);

    const grid = el("div", "parts-grid");
    for (const part of PARTS) {
      const level = state.mods[part.id];
      const row = el("div", "part");
      const title = el("div", "part-title");
      title.append(el("span", "part-icon", part.icon), el("b", "", part.name));
      const desc = el("p", "", part.blurb);
      row.append(title, desc, this.pips(level, MAX_LEVEL));
      if (level >= MAX_LEVEL) {
        const done = el("button", "vbtn current", "Maxed");
        done.disabled = true;
        row.appendChild(done);
      } else {
        row.appendChild(this.buyButton(part.costs[level], state.coins, `Level ${level + 1}`, () => this.actions.buyPart(part)));
      }
      grid.appendChild(row);
    }
    this.list.appendChild(grid);

    const paintBox = el("div", "paint-box");
    paintBox.appendChild(el("h4", "", "Paint"));
    const swatches = el("div", "swatches");
    for (const paint of PAINTS) {
      const owned = state.ownedPaints.has(paint.id);
      const sw = el("button", "swatch" + (state.mods.paint === paint.id ? " active" : "") + (owned ? "" : " locked"));
      sw.title = owned ? paint.name : `${paint.name} — ${paint.price} coins`;
      sw.style.background =
        paint.hue === null ? "linear-gradient(135deg, #e2483d 50%, #c23a30 50%)" : `hsl(${paint.hue}, ${paint.sat ?? 70}%, ${paint.light ?? 50}%)`;
      if (!owned) {
        const tag = el("span", "", String(paint.price));
        sw.appendChild(tag);
        if (state.coins < paint.price) sw.disabled = true;
      }
      sw.addEventListener("click", () => this.actions.choosePaint(paint));
      swatches.appendChild(sw);
    }
    paintBox.appendChild(swatches);
    this.list.appendChild(paintBox);

    drawVehiclePreview(canvas, modded);
  }

  /** Interior shop: a live cockpit preview and the options for each part of the cabin. */
  private renderInterior(state: GarageState): void {
    const canvas = el("canvas", "interior-preview");
    this.list.appendChild(canvas);
    this.list.appendChild(el("p", "egg-note", "Your interior is shared by every vehicle and shows in Driver view (🎥)."));
    for (const group of INTERIOR_GROUPS) {
      const box = el("div", "interior-group");
      box.appendChild(el("h4", "", `${group.icon} ${group.name}`));
      const row = el("div", "interior-options");
      for (const opt of group.options) {
        const owned = opt.price === 0 || state.ownedInterior.has(`${group.id}:${opt.id}`);
        const chosen = state.interior[group.id] === opt.id;
        const btn = el("button", "interior-opt" + (chosen ? " active" : "") + (owned ? "" : " locked"));
        const sw = el("span", "interior-swatch");
        if (opt.swatch.startsWith("#")) sw.style.background = opt.swatch;
        else sw.textContent = opt.swatch;
        btn.append(sw, el("span", "interior-name", opt.name));
        if (!owned) {
          const price = el("small", "interior-price");
          price.append(el("span", "coin-icon"), ` ${opt.price.toLocaleString()}`);
          btn.appendChild(price);
          if (state.coins < opt.price) {
            btn.disabled = true;
            btn.title = `You need ${(opt.price - state.coins).toLocaleString()} more coins`;
          }
        }
        btn.addEventListener("click", () => this.actions.chooseInterior(group.id, opt));
        row.appendChild(btn);
      }
      box.appendChild(row);
      this.list.appendChild(box);
    }
    drawInteriorPreview(canvas, state);
  }

  /** Extra lives (consumable) and shell armor (permanent). */
  private renderEggCare(state: GarageState): void {
    const grid = el("div", "parts-grid");

    const life = el("div", "part");
    const lt = el("div", "part-title");
    lt.append(el("span", "part-icon", "❤️"), el("b", "", "Extra Life"));
    life.append(
      lt,
      el("p", "", "If your egg cracks, a life is used and the egg pops back into your vehicle (it gets flipped upright too)."),
      el("div", "owned-count", `You have ${state.lives}`),
      this.buyButton(EGG_CARE.lifePrice, state.coins, "Buy 1", () => this.actions.buyLife()),
    );

    const armor = el("div", "part");
    const at = el("div", "part-title");
    at.append(el("span", "part-icon", "🛡️"), el("b", "", "Shell Armor"));
    armor.append(
      at,
      el("p", "", "Permanent plating that saves the egg from a crack — once per run per level. Used before extra lives."),
      this.pips(state.armor, EGG_CARE.armorCosts.length),
    );
    if (state.armor >= EGG_CARE.armorCosts.length) {
      const done = el("button", "vbtn current", "Maxed");
      done.disabled = true;
      armor.appendChild(done);
    } else {
      armor.appendChild(this.buyButton(EGG_CARE.armorCosts[state.armor], state.coins, `Level ${state.armor + 1}`, () => this.actions.buyArmor()));
    }
    grid.append(life, armor);
    this.list.appendChild(grid);
    this.list.appendChild(el("p", "egg-note", "Tip: rare ❤️ pickups on the road also give you an extra life."));
  }

  private card(spec: CardSpec, coins: number): { card: HTMLElement; canvas: HTMLCanvasElement } {
    const card = el("div", "vcard" + (spec.selected ? " selected" : "") + (spec.owned ? "" : " locked"));
    const canvas = el("canvas");
    card.appendChild(canvas);

    const title = el("h3", "", spec.name);
    if (spec.tag) title.append(" ", el("span", "tag", spec.tag));
    card.append(title, el("p", "", spec.blurb));

    for (const [label, value] of spec.stats) {
      const row = el("div", "stat");
      row.append(el("span", "", label), this.pips(value, 5));
      card.appendChild(row);
    }

    if (spec.selected) {
      card.appendChild(el("button", "vbtn current", "✓ Selected"));
    } else if (spec.owned) {
      const btn = el("button", "vbtn select", "Select");
      btn.addEventListener("click", spec.onSelect);
      card.appendChild(btn);
    } else if (spec.lock) {
      // Achievement reward: show the goal and progress instead of a price
      const box = el("div", "lock-box");
      const bar = el("div", "lock-bar");
      const fill = el("i");
      fill.style.width = `${Math.round(spec.lock.fraction * 100)}%`;
      bar.appendChild(fill);
      box.append(el("b", "", spec.lock.title), el("span", "", spec.lock.goal), bar, el("small", "", spec.lock.progress));
      card.appendChild(box);
      const btn = el("button", "vbtn locked-btn", "🔒 Unlock with achievement");
      btn.disabled = true;
      card.appendChild(btn);
    } else {
      card.appendChild(this.buyButton(spec.price, coins, "Buy", spec.onBuy));
    }
    return { card, canvas };
  }
}

/** A miniature driver's-seat view with the chosen interior, for the shop. */
function drawInteriorPreview(canvas: HTMLCanvasElement, state: GarageState): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 600;
  const h = canvas.clientHeight || 300;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Simple sunny road scene through the windshield
  const sky = ctx.createLinearGradient(0, 0, 0, h * COCKPIT.winBottom);
  sky.addColorStop(0, "#5ab4ea");
  sky.addColorStop(1, "#d8f0fb");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#62c13f";
  ctx.fillRect(0, h * 0.42, w, h);
  ctx.fillStyle = "#b9895a";
  ctx.beginPath();
  ctx.moveTo(w * 0.47, h * 0.42);
  ctx.lineTo(w * 0.53, h * 0.42);
  ctx.lineTo(w * 0.85, h);
  ctx.lineTo(w * 0.15, h);
  ctx.fill();
  const style = resolveInterior(state.interior);
  const st = new CockpitState();
  st.speedKmh = 48;
  st.dice = 0.25;
  drawHood(ctx, w, h, "#c23a30");
  drawCabin(ctx, w, h, style);
  const m = mirrorRect(w, h);
  ctx.fillStyle = "#8fc6e8";
  ctx.beginPath();
  ctx.roundRect(m.x, m.y, m.w, m.h, 8);
  ctx.fill();
  drawMirrorFrame(ctx, m, st, style);
  drawDashboard(ctx, w, h, st, { glue: 0, fuel: 0.7, rpm: 3200, gear: 2, terrain: null, carX: 0, ghostX: null, mph: false, egg: "ok", readout: "Preview", attitude: { pitch: 0.05, slope: 0.05, airborne: false } }, style);
  drawDashToy(ctx, w, h, st, style);
  drawSteeringWheel(ctx, w, h, st, style);
}
