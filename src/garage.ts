import { VEHICLES, VehicleDef, vehicleById } from "./vehicles";
import { MAPS, MapDef } from "./maps";
import { drawVehiclePreview, drawMapPreview } from "./render";
import { PARTS, PAINTS, PartDef, Paint, VehicleMods, MAX_LEVEL, EGG_CARE, applyMods } from "./upgrades";

export type GarageTab = "vehicles" | "parts" | "terrains" | "egg";

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
}

const TABS: [GarageTab, string][] = [
  ["vehicles", "Vehicles"],
  ["parts", "Parts"],
  ["terrains", "Terrains"],
  ["egg", "Egg Care"],
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
    this.list.classList.toggle("single", this.tab === "parts" || this.tab === "egg");
    if (this.tab === "parts") return this.renderParts(state);
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
    btn.append(`${label} `, icon, ` ${price}`);
    if (coins < price) {
      btn.disabled = true;
      btn.title = `You need ${price - coins} more coins`;
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
    } else {
      card.appendChild(this.buyButton(spec.price, coins, "Buy", spec.onBuy));
    }
    return { card, canvas };
  }
}
