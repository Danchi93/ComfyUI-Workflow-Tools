import { app } from "../../../scripts/app.js";

// 语言配置：将下面一行的 "en" 改成 "zh" 即可切换中文
const LANG = "en";

const I18N = {
    en: { on_off: "On/Off", lora: "LoRA", strength: "Strength", note: "Note", del: "Del",
          trigger: "Trigger", trigger_ph: "(none)", url: "URL", order: "#",
          select: "Select LoRA...", add: "＋ Add LoRA", note_ph: "Note...",
          prompt_url: "URL (paste download page link)",
          root_dir: "— Root —" },
    zh: { on_off: "开关", lora: "LoRA", strength: "权重", note: "备注", del: "删除",
          trigger: "触发词", trigger_ph: "(无)", url: "网址", order: "序",
          select: "选择 LoRA...", add: "＋ 添加 LoRA", note_ph: "备注...",
          prompt_url: "网址（粘贴下载页链接）",
          root_dir: "— 根目录 —" },
};
const T = I18N[LANG] ?? I18N.en;

// 最小宽度（拖拽下限，经典 / Nodes 2.0 两种渲染模式都生效）
const NODE_MIN_W = 500;
// 行内固定列宽（名字列自适应剩余空间）
const COL = { order: 22, toggle: 32, strength: 66, trigger: 68, note: 78, url: 22, del: 22 };
const ROW_GAP = 4;
// 顶部槽位区预留（经典模式会随"贴合校正"动态学习增大，保证此后一步到位）
const VUE_RESERVE = 60;
let CLASSIC_RESERVE = 84;
// 内容区自然高度下限（表头 16 + 添加按钮 ~32 + padding 8 + 行 30 + gap 5）。
// 实测 1 行 ≈ 97，18 行 ≈ 692。用来拒绝“布局未完成”的偏小测量，
// 避免把节点窗口打回默认高度、内容整块冒出框外。
function expectedContentH(rowCount) {
    const n = Math.max(1, rowCount | 0);
    return 61 + n * 35;
}

// ---------- LoRA preview (ComfyUI /experiment/models/preview) ----------
let pathIndexMap = null; // normalizedPath -> pathIndex (null = 接口不可用，功能降级)
const noPreviewSet = new Set(); // 已确认无图路径，避免反复 404 请求

async function loadPathIndexMap() {
    try {
        const resp = await fetch("/experiment/models/loras");
        if (!resp.ok) return;
        const list = await resp.json();
        const map = new Map();
        if (Array.isArray(list)) {
            for (const it of list) {
                if (it && typeof it.name === "string") {
                    map.set(it.name.replace(/\\/g, "/"), it.pathIndex ?? 0);
                }
            }
        }
        pathIndexMap = map.size > 0 ? map : null;
    } catch (e) { pathIndexMap = null; }
}

// 构建预览图 URL；接口不可用或路径未知时返回 null（调用方静默跳过）
function previewUrlFor(loraPath) {
    if (!pathIndexMap) return null;
    const norm = (loraPath || "").replace(/\\/g, "/");
    const idx = pathIndexMap.get(norm);
    if (idx === undefined) return null;
    return `/experiment/models/preview/loras/${idx}/` +
        norm.split("/").map(encodeURIComponent).join("/");
}

// hover 浮层：固定显示在下拉框右侧，不遮挡下拉列表
class HoverPreview {
    constructor() {
        this.el = document.createElement("div");
        Object.assign(this.el.style, {
            position: "fixed", zIndex: "100000", display: "none",
            pointerEvents: "none", background: "#151515",
            border: "1px solid #4a8a4a", borderRadius: "8px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.8)", padding: "4px"
        });
        this.img = document.createElement("img");
        Object.assign(this.img.style, {
            display: "block", maxWidth: "260px", maxHeight: "340px",
            objectFit: "contain", borderRadius: "4px"
        });
        this.el.appendChild(this.img);
        document.body.appendChild(this.el);
    }
    show(url, anchorRect) {
        this.img.src = url;
        this.el.style.display = "block";
        const pad = 10;
        let left = anchorRect.right + pad;
        if (left + 280 > window.innerWidth) {
            left = Math.max(4, anchorRect.left - 280 - pad); // 右缘不足 → 放左侧
        }
        let top = anchorRect.top;
        const h = this.img.getBoundingClientRect().height || 300;
        if (top + h > window.innerHeight) top = Math.max(4, window.innerHeight - h - 4);
        this.el.style.left = left + "px";
        this.el.style.top = top + "px";
    }
    hide() {
        this.el.style.display = "none";
        this.img.removeAttribute("src"); // 避免空src触发页面URL请求
    }
}
const hoverPreview = new HoverPreview();

// ---------- 下拉框（body 上的 DOM 浮层；锚点直接使用元素 rect，两种渲染模式通用） ----------
class DomDropdown {
    constructor() {
        this.el = document.createElement("div");
        Object.assign(this.el.style, {
            position: "fixed", zIndex: "99999", background: "#1c1c1c",
            border: "1px solid #4a8a4a", borderRadius: "6px", overflowY: "auto",
            boxShadow: "0 6px 20px rgba(0,0,0,0.8)", display: "none",
        });
        document.body.appendChild(this.el);
        this._onOutside = (e) => { if (!this.el.contains(e.target)) this.hide(); };
    }
    show(items, selectedItem, anchorRect, onSelect) {
        this.el.innerHTML = "";

        // 按文件夹分组（路径如 "画风/style.safetensors" 或 "角色\\xxx.safetensors"）
        const rootFiles = [];
        const folderMap = new Map();
        const originalMap = new Map();

        for (const item of items) {
            if (item === "None") continue;
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

        const selectedNormalized = (selectedItem && selectedItem !== "None")
            ? selectedItem.replace(/\\/g, "/") : selectedItem;

        const expandDirs = new Set();
        if (selectedNormalized) {
            const si = selectedNormalized.lastIndexOf("/");
            if (si !== -1) expandDirs.add(selectedNormalized.substring(0, si));
        }

        // ----- "None"（始终第一个） -----
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

        // ----- 单个 LoRA 行 -----
        const makeFileRow = (displayName, fullPathNormalized) => {
            const originalPath = originalMap.get(fullPathNormalized) || fullPathNormalized;
            const div = document.createElement("div");
            Object.assign(div.style, {
                padding: "5px 12px 5px 28px", cursor: "pointer", fontSize: "12px",
                color: selectedNormalized === fullPathNormalized ? "#7eb8f7" : "#bbb",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                display: "flex", alignItems: "center", gap: "6px"
            });
            div.addEventListener("mouseover", () => div.style.background = "#2a4a2a");
            div.addEventListener("mouseout", () => div.style.background = selectedNormalized === fullPathNormalized ? "#1a3a5a" : "transparent");
            div.addEventListener("mousedown", (e) => { e.stopPropagation(); onSelect(originalPath); this.hide(); });

            // 缩略图：有同名/同名.preview 图片时，名字后面显示小缩略图 + hover 浮层大图
            const pUrl = previewUrlFor(originalPath);
            const nameSpan = document.createElement("span");
            nameSpan.textContent = displayName;
            Object.assign(nameSpan.style, {
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                minWidth: "0", flex: "1 1 auto"
            });
            div.appendChild(nameSpan);

            if (pUrl && !noPreviewSet.has(originalPath)) {
                const thumb = document.createElement("img");
                thumb.src = pUrl;
                Object.assign(thumb.style, {
                    width: "14px", height: "14px", objectFit: "cover",
                    borderRadius: "3px", flexShrink: "0", display: "none"
                });
                thumb.addEventListener("load", () => { thumb.style.display = "block"; });
                thumb.addEventListener("error", () => { thumb.remove(); noPreviewSet.add(originalPath); });
                div.appendChild(thumb);

                div.addEventListener("mouseenter", () => {
                    hoverPreview.show(pUrl, this.el.getBoundingClientRect());
                });
                div.addEventListener("mouseleave", () => hoverPreview.hide());
            }
            return div;
        };

        // ----- 文件夹 -----
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

        // ----- 根目录文件 -----
        if (rootFiles.length > 0 && sortedDirs.length > 0) {
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

        // ----- 定位与显示（anchorRect 为锚点元素的 getBoundingClientRect()） -----
        this.el.style.display = "block";
        const w = Math.max(anchorRect.width, 260);
        this.el.style.width = w + "px";
        this.el.style.left = Math.max(4, Math.min(anchorRect.left, window.innerWidth - w - 8)) + "px";
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
        hoverPreview.hide();
        document.removeEventListener("mousedown", this._onOutside, true);
        document.removeEventListener("pointerdown", this._onOutside, true);
    }
}
const domDropdown = new DomDropdown();

// ---------- 行数据工具 ----------
function parseRows(val) {
    try {
        const rows = JSON.parse(val || "[]");
        if (Array.isArray(rows) && rows.length) return rows;
    } catch (e) { }
    return null;
}
function defaultRows() {
    return [{ enabled: true, lora: "None", strength: 1.0, trigger: "", note: "", url: "" }];
}
function loraBasename(path) {
    return (path || "").replace(/\.(safetensors|pt|ckpt)$/i, "").split(/[\\/]/).pop();
}
const hasUrlRe = /^https?:\/\//i;

// ---------- 节点（DOM 渲染，和 Prompt Segments / Resolution Switcher 相同架构） ----------
app.registerExtension({
    name: "MultiLoraLoader",
    async nodeCreated(node) {
        if (node.comfyClass !== "MultiLoraLoader") return;

        // lora_stack 隐藏：两种渲染模式都认 hidden（值照常保存/恢复）
        const stackWidget = node.widgets?.find(w => w.name === "lora_stack");
        if (stackWidget) {
            stackWidget.hidden = true;
            if (!stackWidget.options) stackWidget.options = {};
            stackWidget.options.hidden = true;
        }

        // 工作流恢复（含 2.0→1.0 重载）会把 size 写回存档里的默认高度，
        // 且发生时机可能在我们量完高度之后。钩子必须在 await 之前装上，否则错过 configure。
        let pendingRefit = false;
        const refitFromData = () => {
            if (typeof node._mlRender !== "function") {
                pendingRefit = true;
                return;
            }
            const parsed = parseRows(stackWidget?.value);
            if (parsed && JSON.stringify(parsed) !== JSON.stringify(node._mlRows)) {
                node._mlRows = parsed;
                node._mlRender();
                return;
            }
            // 已测到内容时同步拉回。configure 是直接写 size，不等这一下，下一帧就会画出“窗口默认、内容冒出”。
            if (node._mlContentH > 0) {
                const reserve = window.LiteGraph?.vueNodesMode ? VUE_RESERVE : CLASSIC_RESERVE;
                const h = node._mlContentH + reserve;
                if (node.size[1] < h - 2) node.setSize([node.size[0], h]);
            }
            try { node._mlApplySize?.(); } catch (e) { }
        };
        const origOnConfigure = node.onConfigure;
        node.onConfigure = function () {
            const r = origOnConfigure?.apply(this, arguments);
            refitFromData();
            return r;
        };
        const origAfter = node.onAfterGraphConfigured;
        node.onAfterGraphConfigured = function () {
            const r = origAfter?.apply(this, arguments);
            const run = () => { try { refitFromData(); } catch (e) { } };
            requestAnimationFrame(run);
            setTimeout(run, 0);
            return r;
        };

        // 宽度矫正 + 拖拽下限（两种模式通用）
        if (node.size[0] < NODE_MIN_W) node.size = [NODE_MIN_W, node.size[1]];
        if (!node._minWidthPatched) {
            node._minWidthPatched = true;
            const origOnResize = node.onResize;
            node.onResize = function (size) {
                if (size[0] < NODE_MIN_W) size[0] = NODE_MIN_W;
                return origOnResize?.call(this, size);
            };
        }
        // 绘制时兜底：无论谁把 size 写回默认高度（configure 直接赋值、模式切换后的迟到恢复），
        // 下一帧画节点时拉回。只在确实偏矮时动手，不是定时轮询。
        if (!node._mlDrawFitPatched) {
            node._mlDrawFitPatched = true;
            const origDraw = node.onDrawForeground;
            node.onDrawForeground = function (ctx) {
                const ret = origDraw?.apply(this, arguments);
                try {
                    const rows = this._mlRows?.length || 0;
                    const floor = rows ? expectedContentH(rows) + 40 : 0;
                    if (floor && this.size[1] < floor) {
                        if (this._mlContentH > 0) {
                            const reserve = window.LiteGraph?.vueNodesMode ? VUE_RESERVE : CLASSIC_RESERVE;
                            const h = this._mlContentH + reserve;
                            if (this.size[1] < h - 2) this.setSize([this.size[0], h]);
                        } else if (!this._mlDrawFitQueued) {
                            this._mlDrawFitQueued = true;
                            const run = () => {
                                if (!this._mlDrawFitQueued) return;
                                this._mlDrawFitQueued = false;
                                try { this._mlApplySize?.(); } catch (e) { }
                            };
                            requestAnimationFrame(run);
                            setTimeout(run, 30);
                        }
                    }
                } catch (e) { }
                return ret;
            };
        }

        // 可见性变化时重测高度：初次渲染的测量可能受画布布局/拉伸影响而失真，
        // 等节点真正上屏后再测一次（经典模式必须有；Vue 模式同样受益）。
        node._wasVisible = false;
        if ("IntersectionObserver" in window) {
            node._visObserver = new IntersectionObserver((entries) => {
                for (const e of entries) {
                    if (e.isIntersecting) {
                        // 从未测到、或窗口仍明显矮于内容（被打回默认高度）时补测。
                        // 已正常贴合则仅首次可见时复测一次。
                        const nRows = node._mlRows?.length || 0;
                        const need = nRows ? expectedContentH(nRows) + 40 : 0;
                        const tooSmall = !node._mlContentH || (need > 0 && node.size[1] < need);
                        if (tooSmall || !node._wasVisible) {
                            node._mlMeasureTries = 0;
                            try { node._mlApplySize(); } catch (e2) { }
                        }
                    }
                    node._wasVisible = e.isIntersecting;
                }
            }, { threshold: 0 });
            const attachObserver = () => {
                if (node._visObserver && node._mlDomWidget?.element) {
                    node._visObserver.observe(node._mlDomWidget.element);
                }
            };
            requestAnimationFrame(attachObserver);
            setTimeout(attachObserver, 0);
        }
        const origOnRemoved = node.onRemoved;
        node.onRemoved = function () {
            origOnRemoved?.call(this);
            if (node._visObserver) { node._visObserver.disconnect(); node._visObserver = null; }
        };

        // LoRA 列表
        let loraList = ["None"];
        try {
            const resp = await fetch("/object_info/LoraLoader");
            const data = await resp.json();
            const vals = data?.LoraLoader?.input?.required?.lora_name?.[0];
            if (Array.isArray(vals)) loraList = ["None", ...vals];
        } catch (e) { }

        // 预览图目录映射（接口不可用时静默降级）
        loadPathIndexMap();

        // 数据（向后兼容：沿用 lora_stack 的 widgets_values 作为持久化载体）
        node._mlRows = parseRows(stackWidget?.value) ?? defaultRows();
        node._mlContentH = 0;

        // DOM 容器（flex:0 0 auto —— 防止 Nodes 2.0 下被 WidgetDOM 容器拉伸）
        const container = document.createElement("div");
        container.style.cssText =
            `display:flex;flex-direction:column;gap:5px;padding:4px;box-sizing:border-box;width:100%;flex:0 0 auto;`;
        node._mlContainer = container;
        node._mlDomWidget = node.addDOMWidget("_ui", "div", container, {
            serialize: false,
            // 2.0 的最小高度读这个；没设时平台默认 50，节点就能缩回默认高度、内容冒出去
            getMinHeight: () => node._mlContentH || expectedContentH(node._mlRows?.length || 1),
        });

        // ---- 数据同步（写回 lora_stack，py 端与工作流持久化使用） ----
        node._mlSync = function () {
            if (stackWidget) stackWidget.value = JSON.stringify(node._mlRows);
        };

        // 平台若用 computeSize()/setSize() 把窗口打回默认高度，这里兜住（内容已测到之后才锁）
        if (!node._mlComputeSizePatched) {
            node._mlComputeSizePatched = true;
            const origCompute = node.computeSize;
            node.computeSize = function (out) {
                const sz = origCompute ? origCompute.call(this, out) : (out || [this.size[0], this.size[1]]);
                const content = this._mlContentH || 0;
                if (content > 0) {
                    const reserve = window.LiteGraph?.vueNodesMode ? VUE_RESERVE : CLASSIC_RESERVE;
                    const need = content + reserve;
                    if (sz[1] < need) sz[1] = need;
                }
                if (sz[0] < NODE_MIN_W) sz[0] = NODE_MIN_W;
                return sz;
            };
            const origSetSize = node.setSize;
            node.setSize = function (size) {
                if (this._mlSetSizeGuard) return origSetSize?.call(this, size);
                if (size && this._mlSizeLock && this._mlContentH > 0) {
                    const reserve = window.LiteGraph?.vueNodesMode ? VUE_RESERVE : CLASSIC_RESERVE;
                    const need = this._mlContentH + reserve;
                    if (size[1] < need - 2) size = [Math.max(size[0], NODE_MIN_W), need];
                }
                this._mlSetSizeGuard = true;
                try {
                    return origSetSize ? origSetSize.call(this, size) : undefined;
                } finally {
                    this._mlSetSizeGuard = false;
                }
            };
        }

        // ---- 高度自适应 ----
        node._mlApplySize = function () {
            const dw = node._mlDomWidget;
            if (!dw) return;
            dw.element.style.height = "auto";
            dw.computeSize = () => [0, node._mlContentH || -4];
            // 双通道调度：正常走 rAF；模式切换/后台加载等时序下 rAF 会被冻结，
            // setTimeout 兜底保证校正不被拖延（二者只执行其一）。
            let fired = false;
            const measure = () => {
                if (fired) return;
                fired = true;
                // 用"子元素累加"测量自然高度（不依赖容器是否被拉伸，避免读到虚高值）
                let domH = 0;
                try {
                    const cs = getComputedStyle(container);
                    domH = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
                    const gap = parseFloat(cs.rowGap) || 0;
                    const kids = [...container.children];
                    kids.forEach((k, i) => { domH += k.offsetHeight + (i > 0 ? gap : 0); });
                } catch (e) {
                    domH = container.scrollHeight;
                }
                const expectH = expectedContentH(node._mlRows?.length || 1);
                // 布局未完成时子元素高度会偏小（甚至只剩表头）。这时若写回 size，
                // 窗口会被打回默认高度，随后真正渲染的内容全部冒出框外。偏小就当没测到，继续重试。
                if (!domH || domH <= 0 || domH < expectH * 0.85) {
                    // 元素可能尚未上屏（如工作流加载中 / 新 JS 冷启动）：持续重试。
                    // 冷启动时布局就绪可能远超 1 秒，按文档加载状态给足重试窗口：
                    // 文档未完成前最多 ~40 秒；完成后 ~10 秒兜底。
                    node._mlMeasureTries = (node._mlMeasureTries || 0) + 1;
                    const limit = document.readyState === "complete" ? 40 : 160;
                    if (node._mlMeasureTries <= limit) {
                        setTimeout(() => { try { node._mlApplySize(); } catch (e) { } }, 250);
                    }
                    return;
                }
                node._mlMeasureTries = 0;
                node._mlContentH = domH;
                node._mlSizeLock = true;
                try {
                    container.style.setProperty("--comfy-widget-min-height", Math.ceil(domH) + "px");
                } catch (e) { }
                // 顶部槽位区预留：2.0 约 60；经典模式基准 84（实测 76 + 8px 紧凑余量）。
                // 一次性给足，避免"先小后补"的两段式高度跳变（视觉闪烁）；
                // 若个别环境槽位更高导致溢出，由下方校正逻辑兜底，并把补量"学习"进
                // CLASSIC_RESERVE —— 之后所有节点直接一步到位，不会再反复补。
                const reserve = window.LiteGraph?.vueNodesMode ? VUE_RESERVE : CLASSIC_RESERVE;
                const h = domH + reserve;
                if (Math.abs(h - node.size[1]) > 1) {
                    node.setSize([node.size[0], h]);
                    app.graph.setDirtyCanvas(true, true);
                }
                // 经典模式：布局生效后再量一次 —— 若 DOM 底部超出节点框底部，则补增高度。
                // （不同 litegraph 版本的"槽位区"高度不同，静态预留无法通吃，实测校正最稳）
                if (!window.LiteGraph?.vueNodesMode) {
                    requestAnimationFrame(() => {
                        try {
                            const gb = node.getBounding ? node.getBounding() : null;
                            if (!gb) return;
                            const cr = app.canvas.canvas.getBoundingClientRect();
                            const scale = app.canvas.ds?.scale || 1;
                            const offY = app.canvas.ds?.offset?.[1] ?? 0;
                            // 屏幕 = canvas 原点 + (世界坐标 + 视图偏移) × 缩放
                            const nodeBottomScreen = cr.top + (gb[1] + gb[3] + offY) * scale;
                            const domBottom = container.getBoundingClientRect().bottom;
                            const overflowScreen = domBottom - nodeBottomScreen;
                            // 只处理"轻微溢出"：正常预留下溢出最多 ~10px；
                            // 超过 40px 视为"测量基准异常"（如加载态的假溢出）直接忽略，
                            // 更不允许把异常值学习进预留（否则造成"巨长/大空白"）。
                            const overflowLayout = overflowScreen / scale;
                            if (overflowLayout > 2 && overflowLayout < 40) {
                                const add = Math.min(overflowLayout + 6, 200);
                                CLASSIC_RESERVE = Math.min(CLASSIC_RESERVE + add, 200); // 学习（封顶 200）
                                node.setSize([node.size[0], node.size[1] + add]);
                                app.graph.setDirtyCanvas(true, true);
                            }
                        } catch (e) { }
                    });
                }
            };
            requestAnimationFrame(measure);
            setTimeout(measure, 30);
        };

        // ---- 单个 LoRA 行 ----
        const makeRow = (row, i) => {
            const el = document.createElement("div");
            el.style.cssText =
                `display:flex;align-items:center;gap:${ROW_GAP}px;height:30px;padding:0 4px;` +
                `border-radius:6px;box-sizing:border-box;flex-shrink:0;` +
                `background:${row.enabled ? "#1a2a1a" : "#271818"};` +
                `border:1px solid ${row.enabled ? "#2d5a2d" : "#5a2d2d"};`;

            // 序号（输入数字排序）
            const idx = document.createElement("input");
            idx.type = "text";
            idx.value = i + 1;
            idx.title = T.order;
            idx.style.cssText =
                `width:${COL.order}px;height:22px;background:#1e1e28;color:#8a8a9a;flex-shrink:0;` +
                `border:1px solid #35354a;border-radius:4px;text-align:center;font-size:11px;` +
                `font-weight:bold;font-family:monospace;outline:none;box-sizing:border-box;padding:0;`;
            idx.onfocus = () => { idx.style.borderColor = "#4a9eff"; idx.style.color = "#fff"; idx.select(); };
            idx.onblur = () => { idx.style.borderColor = "#35354a"; idx.style.color = "#8a8a9a"; };
            idx.onchange = () => {
                const parsed = parseFloat(idx.value.trim());
                const total = node._mlRows.length;
                const current = i + 1;
                if (!Number.isFinite(parsed)) { idx.value = current; return; }
                let target = Math.round(parsed);
                if (target <= 0) target = 1;
                if (target > total) target = total;
                if (target === current) { idx.value = current; return; }
                const item = node._mlRows.splice(i, 1)[0];
                node._mlRows.splice(target - 1, 0, item);
                node._mlSync();
                node._mlRender();
            };
            el.appendChild(idx);

            // 开关胶囊
            const tog = document.createElement("div");
            tog.style.cssText = `width:${COL.toggle}px;flex-shrink:0;display:flex;justify-content:center;cursor:pointer;`;
            const cap = document.createElement("div");
            const paintCap = () => {
                cap.style.cssText =
                    `width:28px;height:16px;border-radius:8px;position:relative;transition:background .15s,border-color .15s;` +
                    `background:${row.enabled ? "#2e7d32" : "#424242"};border:1px solid ${row.enabled ? "#43a047" : "#555"};`;
                cap.innerHTML =
                    `<div style="position:absolute;top:1px;left:${row.enabled ? "13px" : "1px"};` +
                    `width:12px;height:12px;border-radius:50%;background:#fff;transition:left .15s;"></div>`;
            };
            paintCap();
            tog.onclick = () => {
                row.enabled = !row.enabled;
                el.style.background = row.enabled ? "#1a2a1a" : "#271818";
                el.style.borderColor = row.enabled ? "#2d5a2d" : "#5a2d2d";
                paintCap();
                node._mlSync();
            };
            tog.appendChild(cap);
            el.appendChild(tog);

            // LoRA 名（点击打开下拉；与触发词/备注按 2:1:1 弹性分配，拉宽时三者一起变宽）
            const name = document.createElement("div");
            name.style.cssText =
                `flex:2 1 0;min-width:0;height:22px;line-height:20px;background:#252525;` +
                `border:1px solid #3a3a3a;border-radius:4px;padding:0 6px;font-size:11.5px;` +
                `white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;` +
                `box-sizing:border-box;color:${row.lora === "None" ? "#555" : "#ddd"};`;
            name.textContent = row.lora === "None" ? T.select : loraBasename(row.lora);
            name.onmouseenter = () => { name.style.borderColor = "#5a5a5a"; };
            name.onmouseleave = () => { name.style.borderColor = "#3a3a3a"; };
            name.onclick = () => {
                const rect = name.getBoundingClientRect();
                domDropdown.show(loraList, row.lora, rect, (sel) => {
                    row.lora = sel;
                    if (sel !== "None") {
                        try {
                            const t = localStorage.getItem("lora_trigger_" + sel);
                            row.trigger = t !== null ? t : "";
                            const u = localStorage.getItem("lora_url_" + sel);
                            row.url = u !== null ? u : "";
                        } catch (e) { }
                    } else {
                        row.trigger = "";
                        row.url = "";
                    }
                    name.textContent = sel === "None" ? T.select : loraBasename(sel);
                    name.style.color = sel === "None" ? "#555" : "#ddd";
                    trg.value = row.trigger;
                    paintUrl();
                    node._mlSync();
                });
            };
            el.appendChild(name);

            // 权重：[◀ 数值 ▶]，数值可拖拽微调、直接输入
            const stWrap = document.createElement("div");
            stWrap.style.cssText =
                `width:${COL.strength}px;height:22px;background:#252525;border:1px solid #3a3a3a;` +
                `border-radius:4px;display:flex;align-items:center;box-sizing:border-box;flex-shrink:0;overflow:hidden;`;
            const mkArrow = (txt, delta) => {
                const b = document.createElement("div");
                b.textContent = txt;
                b.style.cssText =
                    `width:14px;flex-shrink:0;text-align:center;font-size:10px;color:#666;cursor:pointer;` +
                    `user-select:none;line-height:20px;`;
                b.onmouseenter = () => { b.style.color = "#aaa"; };
                b.onmouseleave = () => { b.style.color = "#666"; };
                b.onclick = () => {
                    const v = Math.round(Math.min(100, Math.max(-100, row.strength + delta)) * 100) / 100;
                    row.strength = v;
                    num.value = v.toFixed(2);
                    num.style.color = v === 1.0 ? "#aaa" : "#7ec8e3";
                    node._mlSync();
                };
                return b;
            };
            const num = document.createElement("input");
            num.type = "text";
            num.value = row.strength.toFixed(2);
            num.style.cssText =
                `flex:1 1 auto;min-width:0;width:100%;background:transparent;border:none;outline:none;` +
                `text-align:center;font-size:12px;font-family:'Courier New',monospace;padding:0;` +
                `color:${row.strength === 1.0 ? "#aaa" : "#7ec8e3"};`;
            num.onfocus = () => num.select();
            num.onchange = () => {
                let v = parseFloat(num.value);
                if (!Number.isFinite(v)) v = row.strength;
                v = Math.round(Math.min(100, Math.max(-100, v)) * 100) / 100;
                row.strength = v;
                num.value = v.toFixed(2);
                num.style.color = v === 1.0 ? "#aaa" : "#7ec8e3";
                node._mlSync();
            };
            num.onblur = () => { num.value = row.strength.toFixed(2); };
            // 按住数值左右拖拽调整（1px ≈ 0.001）；单击则聚焦编辑。
            // 关键：pointerdown 阻止默认行为 —— 否则输入的"文本选择/HTML5 拖拽"会抢走
            // 手势（拖动时拖出 ghost 文本而非改数值）。单击（未拖动）在 pointerup 时
            // 手动聚焦并全选，保持"点击直接输入"的便利。
            num.addEventListener("dragstart", (e) => e.preventDefault());
            num.addEventListener("pointerdown", (e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                e.stopPropagation();
                const startX = e.clientX;
                const startVal = row.strength;
                let dragging = false;
                const onMove = (ev) => {
                    const dx = ev.clientX - startX;
                    if (!dragging) {
                        if (Math.abs(dx) < 5) return;   // 阈值：点击时的手抖不算拖拽
                        dragging = true;
                        try { num.setPointerCapture(ev.pointerId); } catch (er) { }
                        document.body.style.cursor = "ew-resize";
                    }
                    const v = Math.round(Math.min(100, Math.max(-100, startVal + dx * 0.001)) * 100) / 100;
                    if (v !== row.strength) {
                        row.strength = v;
                        num.value = v.toFixed(2);
                        num.style.color = v === 1.0 ? "#aaa" : "#7ec8e3";
                        node._mlSync();
                    }
                };
                const onUp = (ev) => {
                    num.removeEventListener("pointermove", onMove);
                    num.removeEventListener("pointerup", onUp);
                    num.removeEventListener("pointercancel", onUp);
                    document.body.style.cursor = "";
                    if (dragging) {
                        try { num.releasePointerCapture(ev.pointerId); } catch (er) { }
                    } else {
                        // 单击（未拖动）：聚焦并全选，直接输入覆盖
                        num.focus();
                        num.select();
                    }
                };
                num.addEventListener("pointermove", onMove);
                num.addEventListener("pointerup", onUp);
                num.addEventListener("pointercancel", onUp);
            });
            stWrap.appendChild(mkArrow("◀", -0.01));
            stWrap.appendChild(num);
            stWrap.appendChild(mkArrow("▶", 0.01));
            el.appendChild(stWrap);

            // 触发词（弹性：与名字/备注按 3:1:1 分配剩余空间）
            const trg = document.createElement("input");
            trg.type = "text";
            trg.value = row.trigger || "";
            trg.placeholder = T.trigger_ph;
            trg.style.cssText =
                `flex:1 1 0;min-width:0;height:22px;background:#1e1e28;border:1px solid #35354a;` +
                `border-radius:4px;padding:0 4px;font-size:10px;color:#e8c87e;outline:none;` +
                `box-sizing:border-box;text-overflow:ellipsis;`;
            trg.onfocus = () => { trg.style.borderColor = "#4a9eff"; };
            trg.onblur = () => { trg.style.borderColor = "#35354a"; };
            trg.oninput = () => {
                row.trigger = trg.value;
                if (row.lora !== "None") {
                    try { localStorage.setItem("lora_trigger_" + row.lora, trg.value); } catch (e) { }
                }
                node._mlSync();
            };
            el.appendChild(trg);

            // 备注（弹性：与名字/触发词按 3:1:1 分配剩余空间）
            const note = document.createElement("input");
            note.type = "text";
            note.value = row.note || "";
            note.placeholder = T.note_ph;
            note.style.cssText =
                `flex:1 1 0;min-width:0;height:22px;background:#1e1e28;border:1px solid #35354a;` +
                `border-radius:4px;padding:0 4px;font-size:11px;color:#bbb;outline:none;` +
                `box-sizing:border-box;text-overflow:ellipsis;`;
            note.onfocus = () => { note.style.borderColor = "#4a9eff"; };
            note.onblur = () => { note.style.borderColor = "#35354a"; };
            note.oninput = () => { row.note = note.value; node._mlSync(); };
            el.appendChild(note);

            // 网址按钮：未配置=灰 ＋，已配置=绿 ↗（点击跳转；Shift+点击 / 无网址时编辑）
            const urlBtn = document.createElement("button");
            urlBtn.style.cssText =
                `width:${COL.url}px;height:22px;border-radius:5px;cursor:pointer;font-size:11px;` +
                `flex-shrink:0;line-height:1;font-weight:bold;padding:0;transition:filter .15s;`;
            const paintUrl = () => {
                const on = hasUrlRe.test((row.url || "").trim());
                urlBtn.textContent = on ? "↗" : "＋";
                urlBtn.style.background = on ? "#0f3a1a" : "#2a2a2a";
                urlBtn.style.border = `1px solid ${on ? "#2e9e4f" : "#4a4a4a"}`;
                urlBtn.style.color = on ? "#5ccf7a" : "#8a8a8a";
            };
            paintUrl();
            urlBtn.onmouseenter = () => { urlBtn.style.filter = "brightness(1.3)"; };
            urlBtn.onmouseleave = () => { urlBtn.style.filter = "none"; };
            urlBtn.onclick = (e) => {
                const url = row.url || "";
                const setUrl = (val) => {
                    row.url = (val || "").trim();
                    if (row.lora !== "None") {
                        try { localStorage.setItem("lora_url_" + row.lora, row.url); } catch (er) { }
                    }
                    paintUrl();
                    node._mlSync();
                };
                if (hasUrlRe.test(url.trim())) {
                    if (e.ctrlKey || e.shiftKey) {
                        app.canvas.prompt(T.prompt_url, url, (val) => { setUrl(val); }, e);
                    } else {
                        window.open(url.trim(), "_blank");
                    }
                } else {
                    app.canvas.prompt(T.prompt_url, url, (val) => { setUrl(val); }, e);
                }
            };
            el.appendChild(urlBtn);

            // 删除
            const del = document.createElement("button");
            del.textContent = "✕";
            del.style.cssText =
                `width:${COL.del}px;height:22px;background:#6a0000;color:#ff6b6b;flex-shrink:0;` +
                `border:1px solid #c0392b;border-radius:5px;cursor:pointer;font-size:11px;` +
                `line-height:1;font-weight:bold;padding:0;transition:filter .15s;`;
            del.onmouseenter = () => { del.style.filter = "brightness(1.3)"; };
            del.onmouseleave = () => { del.style.filter = "none"; };
            del.onclick = () => {
                const liveIdx = node._mlRows.indexOf(row);
                if (liveIdx >= 0) node._mlRows.splice(liveIdx, 1);
                node._mlSync();
                node._mlRender();
            };
            el.appendChild(del);

            return el;
        };

        // ---- 全量渲染 ----
        node._mlRender = function () {
            container.innerHTML = "";

            // 表头
            const header = document.createElement("div");
            header.style.cssText =
                `display:flex;align-items:center;gap:${ROW_GAP}px;padding:0 4px;height:16px;` +
                `font-size:10px;color:#606060;font-weight:bold;box-sizing:border-box;flex-shrink:0;`;
            const headCells = [
                { t: T.order, w: COL.order, align: "center" },
                { t: T.on_off, w: COL.toggle, align: "center" },
                { t: T.lora, flex: "2 1 0", align: "left", pad: true },
                { t: T.strength, w: COL.strength, align: "center" },
                { t: T.trigger, flex: "1 1 0", align: "center" },
                { t: T.note, flex: "1 1 0", align: "center" },
                { t: T.url, w: COL.url, align: "center" },
                { t: T.del, w: COL.del, align: "center" },
            ];
            for (const hc of headCells) {
                const c = document.createElement("div");
                c.textContent = hc.t;
                c.style.cssText =
                    `text-align:${hc.align};box-sizing:border-box;overflow:hidden;white-space:nowrap;` +
                    (hc.flex
                        ? `flex:${hc.flex};min-width:0;` + (hc.pad ? "padding-left:6px;" : "")
                        : `width:${hc.w}px;flex-shrink:0;`);
                header.appendChild(c);
            }
            container.appendChild(header);

            // 行
            node._mlRows.forEach((row, i) => {
                container.appendChild(makeRow(row, i));
            });

            // 添加按钮
            const addBtn = document.createElement("button");
            addBtn.textContent = T.add;
            addBtn.style.cssText =
                `width:100%;padding:6px;background:#1e1e1e;color:#7c6cf0;border:1px solid #404040;` +
                `border-radius:6px;cursor:pointer;font-size:13px;font-weight:bold;flex-shrink:0;transition:filter .15s;`;
            addBtn.onmouseenter = () => { addBtn.style.filter = "brightness(1.3)"; };
            addBtn.onmouseleave = () => { addBtn.style.filter = "none"; };
            addBtn.onclick = () => {
                node._mlRows.push({ enabled: true, lora: "None", strength: 1.0, trigger: "", note: "", url: "" });
                node._mlSync();
                node._mlRender();
            };
            container.appendChild(addBtn);

            node._mlApplySize();
            // 布局稳定后复测一次（纠正初次测量可能受画布布局影响的偏差）
            setTimeout(() => { try { node._mlApplySize(); } catch (e) { } }, 350);
            // 更晚的兜底复测：个别加载时序（如模式切换后首载）下，早期测量可能偏小，
            // 页面完全就绪后再校正一次（一次性，非轮询）。
            setTimeout(() => { try { node._mlApplySize(); } catch (e) { } }, 1600);
        };

        // configure 发生在渲染函数定义之前时，只记了一笔；这里把行数据补上再画
        if (pendingRefit) {
            pendingRefit = false;
            const parsed = parseRows(stackWidget?.value);
            if (parsed) node._mlRows = parsed;
        }

        // 初次渲染 + 复查（防止 configure 恢复数据晚于渲染）。
        // 双通道调度：窗口无焦点/被遮挡时 rAF 可能被节流甚至停帧，
        // setTimeout 兜底保证首渲染与校正不被拖延（二者只执行其一）。
        let _mlInitRendered = false;
        const firstRender = () => {
            if (_mlInitRendered) return;
            _mlInitRendered = true;
            node._mlRender();
            const verify = () => {
                const parsed = parseRows(stackWidget?.value);
                if (parsed && JSON.stringify(parsed) !== JSON.stringify(node._mlRows)) {
                    node._mlRows = parsed;
                    node._mlRender();
                }
            };
            requestAnimationFrame(verify);
            setTimeout(verify, 80);
        };
        requestAnimationFrame(firstRender);
        setTimeout(firstRender, 0);
    }
});
