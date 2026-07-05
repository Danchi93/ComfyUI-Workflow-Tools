import { app } from "../../scripts/app.js";

// 语言配置：将下面一行的 "en" 改成 "zh" 即可切换中文
const LANG = "en";

const I18N = {
    en: { on_off: "On/Off", lora: "LoRA", strength: "Strength", note: "Note", del: "Del",
          select: "Select LoRA...", add: "＋ Add LoRA", note_ph: "Note...",
          prompt_strength: "Strength", prompt_note: "Note" },
    zh: { on_off: "开关", lora: "LoRA", strength: "权重", note: "备注", del: "删除",
          select: "选择 LoRA...", add: "＋ 添加 LoRA", note_ph: "备注...",
          prompt_strength: "权重", prompt_note: "备注" },
};
const T = I18N[LANG] ?? I18N.en;


const ROW_H = 30;
const PAD = 10;          // 底板/整体距节点边界
const INNER_PAD = 4;     // 底板内：内容（开关/输入框/删除）距底板边缘的呼吸空间
const HEADER_H = 22;
const STRENGTH_W = 62;
const TOGGLE_W = 32;   // 给胶囊留足够宽度
const DEL_W = ROW_H;
const NOTE_RATIO = 0.22;
const DROPDOWN_ITEM_H = 24;
const DROPDOWN_MAX = 12;
const NODE_MIN_W = 500;
const GAP = 5;

// 胶囊尺寸：严格小于TOGGLE_W
const TOG_W = 28, TOG_H = 16;

function colWidths(totalW) {
    // 内容区比底板再多缩进 INNER_PAD*2，让开关/删除按钮不贴底板边缘
    const avail = totalW - (PAD + INNER_PAD) * 2 - TOGGLE_W - STRENGTH_W - DEL_W - 4 * GAP;
    const noteW = Math.floor(avail * NOTE_RATIO);
    return [TOGGLE_W, avail - noteW, STRENGTH_W, noteW, DEL_W];
}

class DomDropdown {
    constructor() {
        this.el = document.createElement("div");
        Object.assign(this.el.style, {
            position: "fixed", zIndex: "99999", background: "#1c1c1c",
            border: "1px solid #4a8a4a", borderRadius: "6px", overflowY: "auto",
            boxShadow: "0 6px 20px rgba(0,0,0,0.8)", display: "none",
            maxHeight: `${DROPDOWN_MAX * DROPDOWN_ITEM_H}px`,
        });
        document.body.appendChild(this.el);
        this._onOutside = (e) => { if (!this.el.contains(e.target)) this.hide(); };
    }
    show(items, selectedItem, anchorRect, onSelect) {
        this.el.innerHTML = "";
        items.forEach(item => {
            const div = document.createElement("div");
            div.textContent = item === "None" ? "— None —" :
                item.replace(/\.(safetensors|pt|ckpt)$/i, "").split(/[\\/]/).pop();
            Object.assign(div.style, {
                padding: "5px 12px", cursor: "pointer", fontSize: "12px",
                color: item === selectedItem ? "#7eb8f7" : "#ccc",
                background: item === selectedItem ? "#1a3a5a" : "transparent",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
            });
            div.addEventListener("mouseover", () => div.style.background = "#2a4a2a");
            div.addEventListener("mouseout", () => div.style.background = item === selectedItem ? "#1a3a5a" : "transparent");
            div.addEventListener("mousedown", (e) => { e.stopPropagation(); onSelect(item); this.hide(); });
            this.el.appendChild(div);
        });
        this.el.style.display = "block";
        this.el.style.width = anchorRect.width + "px";
        this.el.style.left = anchorRect.left + "px";
        const spaceBelow = window.innerHeight - anchorRect.bottom;
        const menuH = Math.min(items.length, DROPDOWN_MAX) * DROPDOWN_ITEM_H;
        if (spaceBelow >= menuH || spaceBelow > window.innerHeight / 2) {
            this.el.style.top = anchorRect.bottom + "px"; this.el.style.bottom = "auto";
        } else {
            this.el.style.bottom = (window.innerHeight - anchorRect.top) + "px"; this.el.style.top = "auto";
        }
        const selIdx = items.indexOf(selectedItem);
        if (selIdx > 0) this.el.scrollTop = Math.max(0, selIdx - 3) * DROPDOWN_ITEM_H;
        setTimeout(() => {
            document.addEventListener("mousedown", this._onOutside, true);
            document.addEventListener("pointerdown", this._onOutside, true);
        }, 0);
    }
    hide() {
        if (this.el.style.display === "none") return;
        this.el.style.display = "none";
        document.removeEventListener("mousedown", this._onOutside, true);
        document.removeEventListener("pointerdown", this._onOutside, true);
        app.canvas?.setDirty(true);
    }
}
const domDropdown = new DomDropdown();

function parseRows(val) {
    try {
        const rows = JSON.parse(val || "[]");
        if (Array.isArray(rows) && rows.length) return rows;
    } catch {}
    return null;
}
function defaultRows() {
    return [{ enabled: true, lora: "None", strength: 1.0, note: "" }];
}

function drawBox(ctx, x, y, w, h, r, fill, stroke) {
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
    ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}

function makeHeaderWidget() {
    return {
        name: "__lora_header", type: "custom_lora_header",
        value: null, serialize: false,
        computeSize(ww) { return [ww, HEADER_H]; },
        draw(ctx, node, ww, y) {
            const cols = colWidths(ww);
            let x = PAD + INNER_PAD;
            ctx.fillStyle = "#606060";
            ctx.font = "10px sans-serif";
            ctx.textBaseline = "middle";
            // 修复1：最后一列改回"删除"
            [T.on_off, T.lora, T.strength, T.note, T.del].forEach((label, i) => {
                ctx.textAlign = "center";
                ctx.fillText(label, x + cols[i] / 2, y + HEADER_H / 2);
                x += cols[i] + GAP;
            });
        },
        mouse() { return false; }
    };
}

function makeLoraRowWidget(node, row, rowIndex, loraList, onDelete, onchange) {
    return {
        name: `__lora_row_${rowIndex}`, type: "custom_lora_row",
        value: null, serialize: false,
        computeSize(ww) { return [ww, ROW_H + 6]; },
        draw(ctx, node, ww, y) {
            this._lastY = y; this._lastW = ww;
            const cols = colWidths(ww);
            const ry = y + 3, rh = ROW_H;

            drawBox(ctx, PAD, ry, ww - PAD * 2, rh, 6,
                row.enabled ? "#1a2a1a" : "#271818",
                row.enabled ? "#2d5a2d" : "#5a2d2d");

            // 内容从底板内 INNER_PAD 处开始，开关/删除按钮不再贴底板边缘
            let x = PAD + INNER_PAD;

            // 修复2：胶囊严格居中在TOGGLE_W列内，不超出
            const tx = x + (cols[0] - TOG_W) / 2;
            const ty = ry + (rh - TOG_H) / 2;
            drawBox(ctx, tx, ty, TOG_W, TOG_H, TOG_H / 2,
                row.enabled ? "#2e7d32" : "#424242",
                row.enabled ? "#43a047" : "#555");
            const knobR = TOG_H / 2 - 2;
            const knobX = row.enabled ? tx + TOG_W - knobR - 2 : tx + knobR + 2;
            ctx.beginPath(); ctx.arc(knobX, ty + TOG_H / 2, knobR, 0, Math.PI * 2);
            ctx.fillStyle = "#fff"; ctx.fill();
            x += cols[0] + GAP;

            // LoRA下拉
            const lx = x, lw = cols[1];
            drawBox(ctx, lx, ry + 4, lw, rh - 8, 4, "#252525", "#3a3a3a");
            ctx.save(); ctx.rect(lx + 6, ry, lw - 20, rh + 6); ctx.clip();
            ctx.fillStyle = row.lora === "None" ? "#555" : "#ddd";
            ctx.font = "11.5px sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
            ctx.fillText(
                row.lora === "None" ? T.select:
                    row.lora.replace(/\.(safetensors|pt|ckpt)$/i, "").split(/[\\/]/).pop(),
                lx + 7, ry + rh / 2);
            ctx.restore();
            ctx.fillStyle = "#666"; ctx.font = "10px sans-serif";
            ctx.textAlign = "right"; ctx.textBaseline = "middle";
            ctx.fillText("▾", lx + lw - 5, ry + rh / 2);
            x += lw + GAP;

            // 权重
            drawBox(ctx, x, ry + 4, cols[2], rh - 8, 4, "#252525", "#3a3a3a");
            ctx.fillStyle = row.strength === 1.0 ? "#aaa" : "#7ec8e3";
            ctx.font = "12px 'Courier New', monospace";
            ctx.textAlign = "center"; ctx.textBaseline = "middle";
            ctx.fillText(row.strength.toFixed(2), x + cols[2] / 2, ry + rh / 2);
            x += cols[2] + GAP;

            // 备注
            drawBox(ctx, x, ry + 4, cols[3], rh - 8, 4, "#1e1e28", "#35354a");
            ctx.save(); ctx.rect(x + 4, ry, cols[3] - 8, rh + 6); ctx.clip();
            ctx.fillStyle = row.note ? "#aaa" : "#444";
            ctx.font = "11px sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
            ctx.fillText(row.note || T.note_ph, x + 6, ry + rh / 2);
            ctx.restore();
            x += cols[3] + GAP;

            // 删除
            const bs = rh - 8, bx = x + (cols[4] - bs) / 2, by = ry + 4;
            drawBox(ctx, bx, by, bs, bs, 5, "#6a0000", "#c0392b");
            ctx.fillStyle = "#ff6b6b";
            ctx.font = `bold ${Math.floor(bs * 0.58)}px sans-serif`;
            ctx.textAlign = "center"; ctx.textBaseline = "middle";
            ctx.fillText("✕", bx + bs / 2, by + bs / 2);
        },
        mouse(e, pos, node) {
            if (e.type !== "pointerdown") return false;
            const [mx, my] = pos;
            const ww = this._lastW || node.size[0];
            const y = this._lastY || 0;
            if (my < y || my > y + ROW_H + 6) return false;
            const cols = colWidths(ww);
            let x = PAD + INNER_PAD;
            if (mx >= x && mx < x + cols[0]) { row.enabled = !row.enabled; onchange(); return true; }
            x += cols[0] + GAP;
            if (mx >= x && mx < x + cols[1]) {
                const rect = app.canvas.canvas.getBoundingClientRect();
                const scale = app.canvas.ds?.scale ?? 1;
                const off = app.canvas.ds?.offset ?? [0, 0];
                const sx = rect.left + (node.pos[0] + x) * scale + off[0] * scale;
                const sy = rect.top + (node.pos[1] + y + ROW_H) * scale + off[1] * scale;
                domDropdown.show(loraList, row.lora,
                    { left: sx, top: sy, bottom: sy, width: cols[1] * scale },
                    (sel) => { row.lora = sel; onchange(); });
                return true;
            }
            x += cols[1] + GAP;
            if (mx >= x && mx < x + cols[2]) {
                app.canvas.prompt(T.prompt_strength, row.strength.toFixed(2), (val) => {
                    const n = parseFloat(val);
                    if (!isNaN(n)) { row.strength = Math.round(n * 100) / 100; onchange(); }
                }, e);
                return true;
            }
            x += cols[2] + GAP;
            if (mx >= x && mx < x + cols[3]) {
                app.canvas.prompt(T.prompt_note, row.note, (val) => { row.note = val; onchange(); }, e);
                return true;
            }
            x += cols[3] + GAP;
            if (mx >= x && mx < x + cols[4]) { onDelete(); return true; }
            return false;
        }
    };
}

// 修复3：自定义添加按钮widget，文字真正垂直居中
function makeAddButtonWidget(onClick) {
    const BTN_H = 28;
    return {
        name: "__lora_add_btn", type: "custom_lora_add",
        value: null, serialize: false,
        computeSize(ww) { return [ww, BTN_H + 8]; },
        draw(ctx, node, ww, y) {
            this._lastY = y;
            drawBox(ctx, PAD, y + 4, ww - PAD * 2, BTN_H, 6, "#1e1e1e", "#404040");
            ctx.fillStyle = "#7c6cf0";
            ctx.font = "bold 13px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";   // 真正居中
            ctx.fillText(T.add, ww / 2, y + 4 + BTN_H / 2);
        },
        mouse(e, pos) {
            if (e.type !== "pointerdown") return false;
            const [, my] = pos;
            const y = this._lastY || 0;
            if (my >= y + 4 && my <= y + 4 + BTN_H) { onClick(); return true; }
            return false;
        }
    };
}

app.registerExtension({
    name: "MultiLoraLoader",
    async nodeCreated(node) {
        if (node.comfyClass !== "MultiLoraLoader") return;

        const stackWidget = node.widgets?.find(w => w.name === "lora_stack");
        if (stackWidget) {
            stackWidget.computeSize = () => [0, -4];
            stackWidget.draw = () => {};
        }

        if (node.size[0] < NODE_MIN_W) node.size[0] = NODE_MIN_W;

        let loraList = ["None"];
        try {
            const resp = await fetch("/object_info/LoraLoader");
            const data = await resp.json();
            const vals = data?.LoraLoader?.input?.required?.lora_name?.[0];
            if (Array.isArray(vals)) loraList = ["None", ...vals];
        } catch (e) {}

        node._rebuild = (rows) => {
            node._loraRows = rows;
            node.widgets = (node.widgets || []).filter(w =>
                w.name === "model" || w.name === "lora_stack"
            );
            const sw = node.widgets?.find(w => w.name === "lora_stack");
            if (sw) { sw.computeSize = () => [0, -4]; sw.draw = () => {}; }

            node.addCustomWidget(makeHeaderWidget());
            rows.forEach((row, i) => {
                node.addCustomWidget(makeLoraRowWidget(node, row, i, loraList,
                    () => { rows.splice(i, 1); node._rebuild(rows); },
                    () => { if (sw) sw.value = JSON.stringify(rows); app.canvas?.setDirty(true, true); }
                ));
            });

            // 用自定义widget替代原生button
            node.addCustomWidget(makeAddButtonWidget(() => {
                rows.push({ enabled: true, lora: "None", strength: 1.0, note: "" });
                node._rebuild(rows);
            }));

            if (stackWidget) stackWidget.value = JSON.stringify(rows);
            node.setSize([node.size[0], node.computeSize()[1]]);
            app.canvas?.setDirty(true, true);
        };

        const initialRows = parseRows(stackWidget?.value) ?? defaultRows();
        node._rebuild(initialRows);
    }
});