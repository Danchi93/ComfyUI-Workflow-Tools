import { app } from "../../../scripts/app.js";

// 语言配置：将下面一行的 "en" 改成 "zh" 即可切换中文
const LANG = "zh";

const I18N = {
    en: { on_off: "On/Off", lora: "LoRA", strength: "Strength", note: "Note", del: "Del",
          select: "Select LoRA...", add: "＋ Add LoRA", note_ph: "Note...",
          prompt_strength: "Strength", prompt_note: "Note", root_dir: "— Root —" },
    zh: { on_off: "开关", lora: "LoRA", strength: "权重", note: "备注", del: "删除",
          select: "选择 LoRA...", add: "＋ 添加 LoRA", note_ph: "备注...",
          prompt_strength: "权重", prompt_note: "备注", root_dir: "— 根目录 —" },
};
const T = I18N[LANG] ?? I18N.en;


const ROW_H = 30;
const PAD = 10;          // 底板/整体距节点边界
const INNER_PAD = 4;     // 底板内：内容（开关/输入框/删除）距底板边缘的呼吸空间
const HEADER_H = 22;
const STRENGTH_W = 62;
const TOGGLE_W = 32;   // 给胶囊留足够宽度
const DEL_W = ROW_H;
const NOTE_RATIO = 0.28;
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

        // Build folder tree from flat list (paths like "画风/style.safetensors" or "角色\\xxx.safetensors")
        const rootFiles = [];
        const folderMap = new Map(); // folderName -> [fileBaseNames]
        const originalMap = new Map(); // normalizedPath -> originalPath

        for (const item of items) {
            if (item === "None") continue;
            // Normalize path separators to forward slash for consistent parsing
            const normalized = item.replace(/\\/g, "/");
            originalMap.set(normalized, item);
            const idx = normalized.lastIndexOf("/");
            if (idx !== -1) {
                const dir = normalized.substring(0, idx);
                const file = normalized.substring(idx + 1);
                if (!folderMap.has(dir)) folderMap.set(dir, []);
                folderMap.get(dir).push(file);
            } else {
                rootFiles.push(normalized);
            }
        }

        rootFiles.sort();
        const sortedDirs = [...folderMap.keys()].sort();
        for (const dir of sortedDirs) folderMap.get(dir).sort();

        // Normalize selectedItem for consistent comparison
        const selectedNormalized = (selectedItem && selectedItem !== "None")
            ? selectedItem.replace(/\\/g, "/") : selectedItem;

        // Auto-expand the folder containing the currently selected item
        const expandDirs = new Set();
        if (selectedNormalized) {
            const si = selectedNormalized.lastIndexOf("/");
            if (si !== -1) expandDirs.add(selectedNormalized.substring(0, si));
        }

        // ----- "None" (always first) -----
        const noneDiv = document.createElement("div");
        noneDiv.textContent = "— None —";
        Object.assign(noneDiv.style, {
            padding: "5px 12px", cursor: "pointer", fontSize: "12px",
            color: selectedNormalized === "None" ? "#7eb8f7" : "#ccc",
            background: selectedNormalized === "None" ? "#1a3a5a" : "transparent",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
        });
        noneDiv.addEventListener("mouseover", () => noneDiv.style.background = "#2a4a2a");
        noneDiv.addEventListener("mouseout", () => noneDiv.style.background = selectedNormalized === "None" ? "#1a3a5a" : "transparent");
        noneDiv.addEventListener("mousedown", (e) => { e.stopPropagation(); onSelect("None"); this.hide(); });
        this.el.appendChild(noneDiv);

        // ----- Helper: render a single LoRA file row -----
        const makeFileRow = (displayName, fullPathNormalized) => {
            const originalPath = originalMap.get(fullPathNormalized) || fullPathNormalized;
            const div = document.createElement("div");
            div.textContent = displayName;
            Object.assign(div.style, {
                padding: "5px 12px 5px 28px", cursor: "pointer", fontSize: "12px",
                color: selectedNormalized === fullPathNormalized ? "#7eb8f7" : "#bbb",
                background: selectedNormalized === fullPathNormalized ? "#1a3a5a" : "transparent",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
            });
            div.addEventListener("mouseover", () => div.style.background = "#2a4a2a");
            div.addEventListener("mouseout", () => div.style.background = selectedNormalized === fullPathNormalized ? "#1a3a5a" : "transparent");
            div.addEventListener("mousedown", (e) => { e.stopPropagation(); onSelect(originalPath); this.hide(); });
            return div;
        };

        // ----- Render folders -----
        for (const dir of sortedDirs) {
            const files = folderMap.get(dir);
            const expanded = expandDirs.has(dir);

            const header = document.createElement("div");
            const arrowSpan = document.createElement("span");
            arrowSpan.textContent = expanded ? "\u25BE " : "\u25B8 ";
            arrowSpan.style.cssText = "display:inline-block;width:14px;text-align:center;";
            header.appendChild(arrowSpan);
            header.appendChild(document.createTextNode(dir + "/"));
            Object.assign(header.style, {
                padding: "5px 12px", cursor: "pointer", fontSize: "12px",
                color: "#aaa", fontWeight: "bold",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
            });
            header.addEventListener("mouseover", () => header.style.background = "#2a2a2a");
            header.addEventListener("mouseout", () => header.style.background = "transparent");

            const children = document.createElement("div");
            children.style.display = expanded ? "block" : "none";

            for (const file of files) {
                const displayName = file.replace(/\.(safetensors|pt|ckpt)$/i, "");
                children.appendChild(makeFileRow(displayName, dir + "/" + file));
            }

            header.addEventListener("click", (e) => {
                e.stopPropagation();
                const isHidden = children.style.display === "none";
                children.style.display = isHidden ? "block" : "none";
                arrowSpan.textContent = isHidden ? "\u25BE " : "\u25B8 ";
            });

            this.el.appendChild(header);
            this.el.appendChild(children);
        }

        // ----- Root-level files (no subdirectory) -----
        if (rootFiles.length > 0 && sortedDirs.length > 0) {
            // Add a separator between the last folder and root-level files
            const sep = document.createElement("div");
            Object.assign(sep.style, {
                height: "1px", margin: "4px 12px",
                background: "#444", opacity: "0.6"
            });
            this.el.appendChild(sep);

            const rootLabel = document.createElement("div");
            rootLabel.textContent = T.root_dir;
            Object.assign(rootLabel.style, {
                padding: "3px 12px", fontSize: "10px",
                color: "#666", fontStyle: "italic"
            });
            this.el.appendChild(rootLabel);
        }

        for (const file of rootFiles) {
            const displayName = file.replace(/\.(safetensors|pt|ckpt)$/i, "").split(/[\\/]/).pop();
            this.el.appendChild(makeFileRow(displayName, file));
        }

        // ----- Position & show -----
        this.el.style.display = "block";
        this.el.style.width = anchorRect.width + "px";
        this.el.style.left = anchorRect.left + "px";
        const spaceBelow = window.innerHeight - anchorRect.bottom;
        const spaceAbove = anchorRect.top;
        this.el.style.maxHeight = Math.min(Math.max(spaceBelow, spaceAbove) - 20, 480) + "px";
        if (spaceBelow >= 200 || spaceBelow > spaceAbove) {
            this.el.style.top = anchorRect.bottom + "px"; this.el.style.bottom = "auto";
        } else {
            this.el.style.bottom = (window.innerHeight - anchorRect.top) + "px"; this.el.style.top = "auto";
        }
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

            // 权重（带左右箭头微调 & 拖拽调整）
            const sx = x, sw = cols[2];
            drawBox(ctx, sx, ry + 4, sw, rh - 8, 4, "#252525", "#3a3a3a");

            // 左右箭头（各占约10px）
            const arrowW = 10;
            const aY = ry + 4, aH = rh - 8;
            // 左箭头点击区
            this._arrowLL = sx; this._arrowLR = sx + arrowW;
            this._arrowLT = aY; this._arrowLB = aY + aH;
            ctx.fillStyle = "#666";
            ctx.font = "bold 10px sans-serif";
            ctx.textAlign = "center"; ctx.textBaseline = "middle";
            ctx.fillText("◀", sx + arrowW / 2 + 1, aY + aH / 2 + 0.5);
            // 右箭头点击区
            this._arrowRL = sx + sw - arrowW; this._arrowRR = sx + sw;
            this._arrowRT = aY; this._arrowRB = aY + aH;
            ctx.fillText("▶", sx + sw - arrowW / 2 - 1, aY + aH / 2 + 0.5);

            // 中间数值
            ctx.fillStyle = row.strength === 1.0 ? "#aaa" : "#7ec8e3";
            ctx.font = "12px 'Courier New', monospace";
            ctx.textAlign = "center"; ctx.textBaseline = "middle";
            ctx.fillText(row.strength.toFixed(2), sx + sw / 2, ry + rh / 2);

            // 拖拽区（中间数值区域）
            this._dragL = sx + arrowW; this._dragR = sx + sw - arrowW;
            this._dragT = aY; this._dragB = aY + aH;

            // 拖拽时的视觉反馈提示线
            if (this._dragHint !== undefined) {
                ctx.strokeStyle = "#7ec8e3";
                ctx.lineWidth = 1;
                ctx.setLineDash([2, 2]);
                ctx.beginPath();
                ctx.moveTo(this._dragHint, aY);
                ctx.lineTo(this._dragHint, aY + aH);
                ctx.stroke();
                ctx.setLineDash([]);
            }
            x += sw + GAP;

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
            const [mx, my] = pos;
            const ww = this._lastW || node.size[0];
            const y = this._lastY || 0;

            // 拖拽调整权重（左右拖动，向右增大，向左减小）
            if (this._dragging && e.type === "pointermove") {
                const dx = mx - this._dragStartX;
                const delta = dx * 0.001; // 移动1px ≈ 0.001
                let v = Math.round((this._dragStartVal + delta) * 100) / 100;
                if (v < -100) v = -100; if (v > 100) v = 100;
                if (v !== row.strength) {
                    row.strength = v;
                    this._dragChanged = true;  // 权重确实变过，说明是拖拽行为
                    onchange();
                }
                return true;
            }
            if (this._dragging && (e.type === "pointerup" || e.type === "pointerleave")) {
                this._dragging = false;
                const changed = this._dragChanged;
                this._dragChanged = false;
                // 只有权重从未变过才算"点击"，弹出输入框；拖拽过（即使拖回原位）不弹
                if (e.type === "pointerup" && !changed) {
                    app.canvas.prompt(T.prompt_strength, row.strength.toFixed(2), (val) => {
                        const n = parseFloat(val);
                        if (!isNaN(n)) { row.strength = Math.round(n * 100) / 100; onchange(); }
                    }, e);
                }
                app.canvas?.setDirty(true, true);
                return true;
            }

            if (e.type !== "pointerdown") return false;
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
                // 左箭头点击
                if (this._arrowLL !== undefined &&
                    mx >= this._arrowLL && mx <= this._arrowLR &&
                    my >= this._arrowLT && my <= this._arrowLB) {
                    const v = row.strength - 0.01;
                    row.strength = Math.round(Math.max(-100, v) * 100) / 100;
                    onchange();
                    return true;
                }
                // 右箭头点击
                if (this._arrowRL !== undefined &&
                    mx >= this._arrowRL && mx <= this._arrowRR &&
                    my >= this._arrowRT && my <= this._arrowRB) {
                    const v = row.strength + 0.01;
                    row.strength = Math.round(Math.min(100, v) * 100) / 100;
                    onchange();
                    return true;
                }
                // 中间数值区：点击可直接输入，按住拖拽可快速调整（左右水平拖拽）
                if (this._dragL !== undefined &&
                    mx >= this._dragL && mx <= this._dragR &&
                    my >= this._dragT && my <= this._dragB) {
                    this._dragging = true;
                    this._dragChanged = false;
                    this._dragStartVal = row.strength;
                    this._dragStartX = mx;
                    return true;
                }
                return false;
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