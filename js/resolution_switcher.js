import { app } from "../../../scripts/app.js";

// 语言配置：将下面一行的 "en" 改成 "zh" 即可切换中文
const LANG = "en";

const I18N = {
    en: { w: "W", h: "H", batch: "Batch", add: "＋ Add Resolution",
          w_ph: "W", h_ph: "H", batch_ph: "1" },
    zh: { w: "宽", h: "高", batch: "批次", add: "＋ 添加分辨率",
          w_ph: "宽", h_ph: "高", batch_ph: "1" },
};
const T = I18N[LANG] ?? I18N.en;

// Hide the spinner arrows on number inputs so the digits sit truly centered.
// Injected once globally (pseudo-elements can't be set via inline style).
(function injectNumStyle() {
    const style = document.createElement("style");
    style.textContent = `
        .res-switch-num::-webkit-inner-spin-button,
        .res-switch-num::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        .res-switch-num { -moz-appearance: textfield; appearance: textfield; }
    `;
    (document.head || document.documentElement).appendChild(style);
})();

const ROW_H = 28;
const PAD = 10;
const HEADER_H = 22;
const TOGGLE_W = 40;   // 胶囊开关列
const NUM_W = 60;      // W/H 输入框
const BATCH_W = 40;    // batch 输入框
const DEL_W = 36;      // 删除按钮列
const GAP = 5;
// 最小宽度 = 内容总宽 + 行两侧 PAD + 容器两侧 padding(4px each)
const NODE_MIN_W = PAD * 2 + TOGGLE_W + NUM_W * 2 + BATCH_W + DEL_W + 4 * GAP + 8;

function colWidths() {
    // All columns fixed width. Extra space (if node is dragged wider) stays
    // inside the row padding — nothing stretches or collapses.
    return [TOGGLE_W, NUM_W, NUM_W, BATCH_W, DEL_W];
}

app.registerExtension({
    name: "ResolutionSwitcher",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "ResolutionSwitcher") return;

        const ROW_H_LOCAL = ROW_H;

        nodeType.prototype._calcHeight = function () {
            return HEADER_H + this._presets.length * (ROW_H_LOCAL + GAP) + GAP + 36;
        };

        nodeType.prototype._applySize = function () {
            this._domWidget.element.style.height = "auto";
            this._domWidget.computeSize = () => [0, -4];
            requestAnimationFrame(() => {
                const domH = this._presetContainer.scrollHeight;
                // Bail out (keep last size) when hidden off-screen, same guard
                // as the other nodes.
                if (!domH || domH <= 0) {
                    if (!this._minH) {
                        const h = this._calcHeight();
                        this._minH = h;
                        this.setSize([this.size[0], h]);
                        app.graph.setDirtyCanvas(true, true);
                    }
                    return;
                }
                const h = domH + 50;
                this._minH = h;
                this.setSize([this.size[0], h]);
                app.graph.setDirtyCanvas(true, true);
            });
        };

        nodeType.prototype._render = function () {
            const container = this._presetContainer;
            container.innerHTML = "";

            const cw = colWidths();

            // Helper: every column (header + rows) shares the same width and the
            // same horizontal center, so cells line up exactly. Each cell uses
            // flex centering so labels/inputs stay centered regardless of content.
            const cellBase = (w, extra = "") =>
                `width:${w}px;flex-shrink:0;display:flex;align-items:center;justify-content:center;box-sizing:border-box;${extra}`;

            // Header row — centered labels matching the inputs below.
            const header = document.createElement("div");
            header.style.cssText = `display:flex;align-items:center;justify-content:center;gap:${GAP}px;padding:0 ${PAD}px;height:${HEADER_H}px;font-size:11px;color:#888;font-weight:bold;box-sizing:border-box;`;
            const headCells = ["", T.w, T.h, T.batch, ""];
            headCells.forEach((txt, i) => {
                const c = document.createElement("div");
                c.textContent = txt;
                c.style.cssText = cellBase(cw[i]);
                header.appendChild(c);
            });
            container.appendChild(header);

            this._presets.forEach((p, i) => {
                const row = document.createElement("div");
                const active = !!p.active;
                // Row background follows the Multi LoRA Loader palette:
                // active = green tint, inactive = neutral dark.
                row.style.cssText = `display:flex;align-items:center;justify-content:center;gap:${GAP}px;padding:0 ${PAD}px;height:${ROW_H_LOCAL}px;box-sizing:border-box;border-radius:6px;background:${active ? "#1a2a1a" : "#222226"};border:1px solid ${active ? "#2d5a2d" : "#2a2a2e"};`;

                // Toggle capsule (radio-style: only one active at a time).
                // Green when active, matching the LoRA loader's enabled capsule.
                const toggle = document.createElement("div");
                toggle.style.cssText = cellBase(cw[0], "cursor:pointer;");
                const capsule = document.createElement("div");
                capsule.style.cssText = `width:30px;height:16px;border-radius:8px;background:${active ? "#43a047" : "#555"};position:relative;transition:background 0.15s;border:1px solid ${active ? "#2e7d32" : "#424242"};`;
                capsule.innerHTML = `<div style="position:absolute;top:1px;left:${active ? "15px" : "2px"};width:12px;height:12px;border-radius:50%;background:#fff;transition:left 0.15s;"></div>`;
                toggle.onclick = () => {
                    // Radio behavior: clicking the active one is a no-op (must
                    // always keep exactly one active — this node switches
                    // resolutions, it can't disable resolution). Clicking any
                    // other moves the active flag to it.
                    if (active) return;
                    this._presets.forEach((q, j) => { q.active = (j === i); });
                    this._sync();
                    this._render();
                };
                toggle.appendChild(capsule);
                row.appendChild(toggle);

                // Number inputs (W / H / batch). Width keyed by column, NOT by
                // the outer row index — that was the misalignment bug.
                const mkNum = (key, ph, minv, colIdx) => {
                    const inp = document.createElement("input");
                    inp.type = "number";
                    inp.className = "res-switch-num";
                    inp.value = p[key];
                    inp.placeholder = ph;
                    inp.min = minv;
                    inp.step = key === "batch" ? 1 : 8;
                    inp.style.cssText = `width:${cw[colIdx]}px;height:22px;background:#252525;color:#ddd;border:1px solid #3a3a3a;border-radius:4px;padding:0;font-size:12px;outline:none;box-sizing:border-box;text-align:center;`;
                    inp.onfocus = () => { inp.style.borderColor = "#4a9eff"; };
                    inp.onblur = () => { inp.style.borderColor = "#3a3a3a"; };
                    inp.onchange = () => {
                        let v = parseInt(inp.value, 10);
                        if (!Number.isFinite(v) || v < minv) v = minv;
                        // Snap W/H to multiples of 8
                        if (key !== "batch") v = Math.round(v / 8) * 8;
                        inp.value = v;
                        p[key] = v;
                        this._sync();
                    };
                    return inp;
                };
                row.appendChild(mkNum("width", T.w_ph, 16, 1));
                row.appendChild(mkNum("height", T.h_ph, 16, 2));
                row.appendChild(mkNum("batch", T.batch_ph, 1, 3));

                // Delete button — red box like the Multi LoRA Loader.
                const del = document.createElement("button");
                del.innerHTML = "✕";
                del.style.cssText = `width:22px;height:22px;background:#6a0000;color:#ff6b6b;border:1px solid #c0392b;border-radius:5px;cursor:pointer;font-size:11px;flex-shrink:0;line-height:1;font-weight:bold;transition:filter 0.15s;`;
                del.onmouseenter = () => { del.style.filter = "brightness(1.3)"; };
                del.onmouseleave = () => { del.style.filter = "none"; };
                del.onclick = () => {
                    this._presets.splice(i, 1);
                    this._sync();
                    this._render();
                };
                const delWrap = document.createElement("div");
                delWrap.style.cssText = cellBase(cw[4]);
                delWrap.appendChild(del);
                row.appendChild(delWrap);

                container.appendChild(row);
            });

            // Add button
            const addBtn = document.createElement("button");
            addBtn.innerHTML = T.add;
            addBtn.style.cssText = `width:calc(100% - ${PAD * 2}px);margin:${GAP}px ${PAD}px;padding:6px;background:transparent;color:#4a9eff;border:1px dashed #3a5a7a;border-radius:6px;cursor:pointer;font-size:12px;transition:background 0.15s,border-color 0.15s;`;
            addBtn.onmouseenter = () => { addBtn.style.background = "#1a2a3a"; addBtn.style.borderColor = "#4a9eff"; };
            addBtn.onmouseleave = () => { addBtn.style.background = "transparent"; addBtn.style.borderColor = "#3a5a7a"; };
            addBtn.onclick = () => {
                this._presets.push({ active: false, width: 1024, height: 1024, batch: 1 });
                this._sync();
                this._render();
            };
            container.appendChild(addBtn);

            this._applySize();
        };

        nodeType.prototype._sync = function () {
            if (this._rawWidget) this._rawWidget.value = JSON.stringify(this._presets);
        };

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);

            const raw = this.widgets?.find(w => w.name === "presets");
            if (raw) { raw.hidden = true; raw.computeSize = () => [0, -4]; }
            this._rawWidget = raw;

            // Default presets: 3 common resolutions, first one active.
            this._presets = [
                { active: true, width: 1024, height: 1024, batch: 1 },
                { active: false, width: 896, height: 1152, batch: 1 },
                { active: false, width: 1152, height: 896, batch: 1 },
            ];

            const container = document.createElement("div");
            container.style.cssText = `display:flex;flex-direction:column;gap:${GAP}px;padding:4px;box-sizing:border-box;width:100%;`;
            this._presetContainer = container;

            this._domWidget = this.addDOMWidget("_ui", "div", container, { serialize: false });

            this.onResize = function (size) {
                if (size[0] < NODE_MIN_W) size[0] = NODE_MIN_W;
                if (this._minH && size[1] < this._minH) size[1] = this._minH;
            };

            // Re-measure when becoming visible (same pattern as other nodes).
            this._wasVisible = false;
            if ("IntersectionObserver" in window) {
                this._visObserver = new IntersectionObserver((entries) => {
                    for (const e of entries) {
                        if (e.isIntersecting && !this._wasVisible) {
                            requestAnimationFrame(() => this._applySize());
                        }
                        this._wasVisible = e.isIntersecting;
                    }
                }, { threshold: 0 });
                requestAnimationFrame(() => {
                    if (this._visObserver && this._domWidget?.element) {
                        this._visObserver.observe(this._domWidget.element);
                    }
                });
            }

            if (this.size[0] < NODE_MIN_W) this.size[0] = NODE_MIN_W;

            requestAnimationFrame(() => this._render());
        };

        const onSerialize = nodeType.prototype.onSerialize;
        nodeType.prototype.onSerialize = function (o) {
            onSerialize?.apply(this, arguments);
            // Deep copy so a pasted/duplicated node doesn't share the same array
            // reference with the original.
            o.resolution_presets = JSON.parse(JSON.stringify(this._presets));
        };

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (o) {
            onConfigure?.apply(this, arguments);
            if (o.resolution_presets) {
                this._presets = o.resolution_presets;
                requestAnimationFrame(() => this._render());
            }
        };

        const onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            onRemoved?.apply(this, arguments);
            if (this._visObserver) { this._visObserver.disconnect(); this._visObserver = null; }
        };
    }
});
