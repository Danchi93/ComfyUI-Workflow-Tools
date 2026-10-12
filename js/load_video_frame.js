import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

// Video Frame Extractor 前端 UI：
// - 节点内嵌 <video> 预览 + 可拖拽时间轴，拖动时实时定位到对应帧
// - 帧号数字框可直接手输，与时间轴双向同步
// - 支持上传视频 / 拖拽视频文件到节点；执行后显示保存结果
// - frame_index 原生 widget 被隐藏，但值实时同步（执行时后端口径一致）

const NODE_CLASS = "VideoFrameExtractor";
const VIDEO_EXT_RE = /\.(mp4|webm|mkv|avi|mov|m4v|flv|wmv|mpg|mpeg|ts|gif)$/i;
const CHUNK_SIZE = 20 * 1024 * 1024; // 20MB/块，绕过 /upload/image 的请求体大小限制

// ---------- 渲染模式热切换监听（1.0 ⇄ 2.0 不重载页面） ----------
// ComfyUI 里切换 "Comfy.VueNodes.Enabled" 是热切换：节点不重建，DOM 结构停留在创建时的
// 模式，会与新渲染器错配（2.0 里跑 1.0 结构 → inner 溢出、盖住底部角标；
// 1.0 里跑 2.0 结构 → 平台按小占位压高度 + overflow:hidden → 内容整块被裁）。
// 监听 LiteGraph.vueNodesMode 的变化（前端唯一写入点），通知各节点做样式适配。
const modeChangeListeners = new Set();
function onRenderModeChange(fn) { modeChangeListeners.add(fn); }
function hookVueNodesMode() {
    const LG = window.LiteGraph;
    if (!LG || LG._vfModeHooked) return;
    LG._vfModeHooked = true;
    let current = LG.vueNodesMode;
    try {
        Object.defineProperty(LG, "vueNodesMode", {
            configurable: true,
            get() { return current; },
            set(v) {
                const changed = current !== v;
                current = v;
                if (changed) {
                    for (const fn of modeChangeListeners) {
                        try { fn(!!v); } catch (e) { }
                    }
                }
            },
        });
    } catch (e) { }
}
hookVueNodesMode();

// 与后端保持一致的改名规则（去路径、去非法字符）
const sanitizeName = (name) => (name || "")
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    .trim()
    .replace(/[<>:"|?*]/g, "_")
    .replace(/^\.+/, "");

// ---------- widget 隐藏/显示（兼容经典 litegraph 与 vueNodes 模式） ----------
function hideWidget(w) {
    if (!w) return;
    w.hidden = true;
    if (!w.options) w.options = {};
    w.options.hidden = true;
    if (!window.LiteGraph || !window.LiteGraph.vueNodesMode) {
        w.computeSize = () => [0, -4];
        if (!w._hiddenDrawHooked) {
            w._origDraw = w.hasOwnProperty("draw") ? w.draw : undefined;
            w._hiddenDrawHooked = true;
        }
        w.draw = () => {};
    }
    if (w.element) w.element.style.display = "none";
}

// ---------- 小工具 ----------
function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) return "--:--";
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

app.registerExtension({
    name: "WorkflowTools.VideoFrameExtractor",
    async nodeCreated(node) {
        if (node.comfyClass !== NODE_CLASS) return;

        const videoWidget = node.widgets?.find((w) => w.name === "video");
        const frameWidget = node.widgets?.find((w) => w.name === "frame_index");
        const pathWidget = node.widgets?.find((w) => w.name === "video_path");
        if (!videoWidget || !frameWidget) return;

        // 帧号由自定义 UI 接管（值保留在 widget 中，执行时后端读取）
        hideWidget(frameWidget);

        // 屏蔽 ComfyUI 原生图像预览，避免和自定义 UI 布局打架
        Object.defineProperty(node, "imgs", {
            get: () => undefined,
            set: () => {},
            configurable: true,
        });

        // ====================================================================
        // DOM 结构 —— 两种模式两套布局策略：
        // - Nodes 2.0：全权交给平台布局（官方 DOM widget 机制：widget 行 auto +
        //   widgets 区 flex:1 吸收节点剩余空间）。我们的元素 flex 填满分配空间、
        //   视频区 flex 吸收剩余高度，零 JS 尺寸管理（无 syncLayout/无观察器）。
        // - 经典模式(1.0)：画布覆盖层无布局流，沿用"零高度挂载点 + absolute 内层 +
        //   手工按节点尺寸分配"的老路径，行为与之前完全一致。
        // ====================================================================
        const IS_VUE2 = !!(window.LiteGraph && window.LiteGraph.vueNodesMode);

        const container = document.createElement("div");
        if (IS_VUE2) {
            Object.assign(container.style, {
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                padding: "8px",
                boxSizing: "border-box",
                width: "100%",
                minHeight: "0",
                background: "rgba(28, 28, 30, 0.85)",
                borderRadius: "6px",
                color: "#ddd",
                fontFamily: "sans-serif",
                overflow: "hidden",
            });
            // 官方契约（DOMWidget.computeLayoutSize）：widget 的最小高度 → 拖拽下限；
            // 节点缩小时"视频区让位、底部控件区完整可见"。
            container.style.setProperty("--comfy-widget-min-height", "130");
        } else {
            Object.assign(container.style, {
                position: "relative",
                width: "100%",
                boxSizing: "border-box",
            });
        }

        // 2.0：内容直接放 container（平台管布局）；1.0：放 absolute 的 inner（手工分配高度）
        const inner = IS_VUE2 ? container : document.createElement("div");
        if (!IS_VUE2) {
            Object.assign(inner.style, {
                position: "absolute",
                top: "0",
                left: "0",
                width: "100%",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                boxSizing: "border-box",
                padding: "8px",
                background: "rgba(28, 28, 30, 0.85)",
                borderRadius: "6px",
                color: "#ddd",
                fontFamily: "sans-serif",
                overflow: "hidden",
            });
            container.appendChild(inner);
        }

        // --- 视频预览区 ---
        const videoWrap = document.createElement("div");
        Object.assign(videoWrap.style, {
            position: "relative",
            width: "100%",
            background: "#000",
            borderRadius: "4px",
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
        });
        if (IS_VUE2) {
            // 吸收节点剩余高度（平台分配多少吃多少），最小可压缩到 0
            videoWrap.style.flex = "1 1 0";
            videoWrap.style.minHeight = "0";
        } else {
            videoWrap.style.height = "260px";
            videoWrap.style.flexShrink = "0";
        }

        const videoEl = document.createElement("video");
        Object.assign(videoEl.style, {
            width: "100%",
            height: "100%",
            objectFit: "contain",
            outline: "none",
        });
        if (IS_VUE2) {
            // 绝对定位：避免视频"内在尺寸"以 min-content 形式撑开整条布局链
            videoEl.style.position = "absolute";
            videoEl.style.inset = "0";
        }
        videoEl.muted = true;
        videoEl.preload = "auto";
        videoWrap.appendChild(videoEl);

        const placeholder = document.createElement("div");
        placeholder.textContent = "选择 / 上传视频文件";
        Object.assign(placeholder.style, {
            position: "absolute",
            color: "#666",
            fontSize: "12px",
            pointerEvents: "none",
        });
        videoWrap.appendChild(placeholder);
        inner.appendChild(videoWrap);

        // --- 帧号 + 信息行 ---
        const row = document.createElement("div");
        Object.assign(row.style, {
            display: "flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "12px",
            flexShrink: "0",
        });

        const labelFrame = document.createElement("span");
        labelFrame.textContent = "帧号";

        const numInput = document.createElement("input");
        numInput.type = "number";
        numInput.min = 0;
        numInput.step = 1;
        Object.assign(numInput.style, {
            width: "88px",
            background: "#111",
            color: "#7ec8e3",
            border: "1px solid #444",
            borderRadius: "4px",
            padding: "2px 6px",
            fontSize: "12px",
            fontFamily: "Consolas, monospace",
            boxSizing: "border-box",
        });

        const totalSpan = document.createElement("span");
        totalSpan.textContent = "";
        totalSpan.style.color = "#888";

        const infoSpan = document.createElement("span");
        infoSpan.textContent = "";
        Object.assign(infoSpan.style, {
            marginLeft: "auto",
            color: "#888",
            fontFamily: "Consolas, monospace",
            fontSize: "11px",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        });

        row.append(labelFrame, numInput, totalSpan, infoSpan);
        inner.appendChild(row);

        // --- 时间轴 ---
        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = 0;
        slider.max = 0;
        slider.step = 1;
        slider.value = 0;
        Object.assign(slider.style, {
            width: "100%",
            margin: "0",
            accentColor: "#4a8ad4",
            flexShrink: "0",
        });
        inner.appendChild(slider);

        // --- 上传按钮 + 状态行 ---
        const bottomRow = document.createElement("div");
        Object.assign(bottomRow.style, {
            display: "flex",
            alignItems: "center",
            gap: "8px",
            flexShrink: "0",
        });

        const uploadBtn = document.createElement("button");
        uploadBtn.textContent = "选择 / 上传视频";
        Object.assign(uploadBtn.style, {
            background: "#2a2a2a",
            color: "#bbb",
            border: "1px solid #484848",
            borderRadius: "4px",
            padding: "4px 14px",
            fontSize: "13px",
            cursor: "pointer",
            flexShrink: "0",
        });
        // 防止点击按钮时拖动节点
        uploadBtn.addEventListener("pointerdown", (e) => e.stopPropagation());

        const statusEl = document.createElement("span");
        Object.assign(statusEl.style, {
            fontSize: "11px",
            color: "#888",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        });

        bottomRow.append(uploadBtn, statusEl);
        inner.appendChild(bottomRow);

        // 布局常量：
        // - FIXED_BOTTOM：视频区下方的固定控件区（帧号行/时间轴/按钮行/间距/内边距）
        // - DOM_MIN_VIDEO：视频区最小高度。取小值，节点缩小时"视频区让位、底部控件常驻"；
        //   若保底太大，节点缩小时容器反而超出节点框（经典模式被裁、2.0 下锁死最小尺寸）
        // - DOM_PLACEHOLDER_H：布局占位基准，必须是固定值！
        //   （若动态跟随节点高度，前端缩放限制会与它互相锁死，导致节点只能放大不能缩小）
        const FIXED_BOTTOM = 112;
        const DOM_MIN_VIDEO = 40;
        const DOM_PLACEHOLDER_H = 272;
        let videoH = 260;

        const domWidget = node.addDOMWidget("vfx_ui", "div", container);
        if (domWidget) {
            // 动态占位高度：
            // - Nodes 2.0：小占位（若报"视频区+控件区"的大高度会被锁死最小尺寸，只能放大不能缩小）
            // - 经典模式：给足高度，避免"2.0 结构节点热切回 1.0"时被小占位压扁、内容整块被裁
            domWidget.computeSize = (w) => {
                try {
                    const vue = !!(window.LiteGraph && window.LiteGraph.vueNodesMode);
                    if (vue) return [w, 40];
                    const first = container.firstElementChild;
                    if (first && first !== container) {
                        // 1.0 结构：恒定小占位。
                        // 注意：不能返回 inner 实际高度——litegraph 拖拽 resize 会把
                        // computeSize()[1] 当作"最小高度"clamp，动态值会让"缩小"每步
                        // 只能缩到上次内容高度（龟速、跟不上鼠标）；固定小值则手感顺滑。
                        return [w, 40];
                    }
                    // 2.0 结构（热切回 1.0 的过渡态）：给足高度避免内容被压扁
                    return [w, 40 + FIXED_BOTTOM + 160];
                } catch (e) { return [w, 40]; }
            };
        }

        // 头顶区高度（节点顶到 DOM 容器顶，布局单位）：取 litegraph 绘制 widget 时写入的
        // last_y（节点首次绘制后可用）。仅经典模式使用（2.0 下 syncLayout 直接返回）。
        const getDomY = () => {
            return domWidget && typeof domWidget.last_y === "number" ? domWidget.last_y : 0;
        };

        // 宽度与视频区高度跟随节点尺寸（仅经典模式）。
        // Nodes 2.0 下平台全权管理布局（flex 链自动分配空间），此处不做任何手工同步。
        // 注意：这里动态读取渲染模式（而非创建时的 IS_VUE2 常量）——热切换后节点不重建，
        // 常量会"定格"，导致切回 1.0 后 syncLayout 不再运行、布局无人管理。
        const syncLayout = () => {
            if (window.LiteGraph && window.LiteGraph.vueNodesMode) return;
            let w = Math.max(200, (node.size?.[0] || 470) - 30);
            container.style.width = `${w}px`;
            container.style.maxWidth = `${w}px`;

            const domY = getDomY();
            let target = videoH;
            if (domY > 0) {
                // 视频区 = 节点可用高度 - 头顶区 - 底部固定控件区 - 余量
                target = node.size[1] - domY - FIXED_BOTTOM - 8;
            }
            target = Math.max(DOM_MIN_VIDEO, Math.min(target, 4000));
            if (Math.abs(target - videoH) > 1) videoH = target;
            videoWrap.style.height = `${videoH}px`;
            // 高度写到 inner（absolute 层）：容器本身保持零高度，绝不参与
            // "内容自然高"，避免布局系统用旧内容高锁死节点尺寸。
            let totalH = videoH + FIXED_BOTTOM;
            if (domY > 0) {
                const avail = (node.size?.[1] || 470) - domY - 14;
                totalH = Math.min(totalH, Math.max(0, avail));
            }
            inner.style.height = `${totalH}px`;
            // 上传按钮随节点宽度温和放大（节点拉大后仍显眼）
            try {
                const bs = Math.min(1.6, Math.max(1, w / 700));
                uploadBtn.style.fontSize = `${(13 * bs).toFixed(1)}px`;
                uploadBtn.style.padding = `${(4 * bs).toFixed(1)}px ${(14 * bs).toFixed(1)}px`;
            } catch (e) { }
        };
        const origOnResize = node.onResize;
        node.onResize = function () {
            const r = origOnResize ? origOnResize.apply(this, arguments) : undefined;
            syncLayout();
            return r;
        };

        // 渲染模式热切换适配（样式层）：让"创建时的结构"在"新渲染器"下也能正常布局。
        // - 切到 2.0：内容入流（去掉 absolute+手动高度），视频区交 flex 吸收
        // - 切回 1.0：恢复"零高度挂载点 + absolute inner + 手动高度"，并按节点尺寸重排
        const adaptToMode = () => {
            try {
                const vue = !!(window.LiteGraph && window.LiteGraph.vueNodesMode);
                const hasInner = inner !== container;
                if (vue) {
                    // container 改为 flex 列，让 inner 能伸展到平台分配的空间
                    container.style.display = "flex";
                    container.style.flexDirection = "column";
                    container.style.minHeight = "0";
                    if (hasInner) {
                        inner.style.position = "static";
                        inner.style.height = "auto";
                        inner.style.width = "100%";
                        inner.style.flex = "1 1 auto";
                        inner.style.minHeight = "0";
                    }
                    container.style.width = "100%";
                    container.style.maxWidth = "";
                    container.style.setProperty("--comfy-widget-min-height", "130");
                    videoEl.style.position = "absolute";
                    videoEl.style.inset = "0";
                    videoWrap.style.flex = "1 1 0";
                    videoWrap.style.minHeight = "0";
                    videoWrap.style.height = "";
                    // 布局由平台驱动：轻推一次同值尺寸请它重算
                    try { node.setSize([node.size[0], node.size[1]]); } catch (e) { }
                } else {
                    if (hasInner) {
                        // 还原"零高度挂载点 + absolute inner"的经典结构
                        inner.style.position = "absolute";
                        inner.style.top = "0";
                        inner.style.left = "0";
                        inner.style.width = "100%";
                        inner.style.height = "";   // 清空，syncLayout 会重新分配
                        inner.style.flex = "";
                        inner.style.minHeight = "";
                        container.style.display = "";
                        container.style.flexDirection = "";
                        container.style.minHeight = "";
                    }
                    container.style.setProperty("--comfy-widget-min-height", "");
                    videoEl.style.position = "";
                    videoEl.style.inset = "";
                    videoWrap.style.flex = "";
                    videoWrap.style.minHeight = "";
                    videoWrap.style.height = "260px";
                    syncLayout();
                    app.canvas?.setDirty(true, true);
                }
            } catch (e) { }
        };
        node._vfAdaptToMode = adaptToMode;
        const modeListener = () => {
            hookVueNodesMode(); // 兜底：模块顶层执行时 LiteGraph 可能尚未就绪
            // 平台切换布局可能稍晚到位，幂等执行两次
            setTimeout(() => { try { adaptToMode(); } catch (e) { } }, 0);
            setTimeout(() => { try { adaptToMode(); } catch (e) { } }, 200);
        };
        node._vfModeListener = modeListener;
        onRenderModeChange(modeListener);
        hookVueNodesMode();
        // 个别前端版本会重置 DOM 高度：绘制时轻量检查并修复
        const origOnDrawForeground = node.onDrawForeground;
        node.onDrawForeground = function (ctx) {
            const r = origOnDrawForeground ? origOnDrawForeground.apply(this, arguments) : undefined;
            if (domWidget && typeof domWidget.last_y === "number" && domWidget.last_y > 0) {
                const target = Math.max(DOM_MIN_VIDEO, Math.min(
                    this.size[1] - domWidget.last_y - FIXED_BOTTOM - 8, 4000));
                if (Math.abs(target - videoH) > 2) syncLayout();
            }
            return r;
        };

        // （Nodes 2.0 的布局由平台管理：widget 行 auto + widgets 区 flex:1，
        //   我们的元素随分配空间自动伸缩，无需任何 JS 触发/同步机制。）

        if (IS_VUE2) {
            // 个别加载时序下平台首帧布局可能未收敛（症状：面板底部超出节点框、遮住底部角标，
            // 手动拉一下才恢复）。稳妥兜底：主动"轻推"尺寸请平台重算布局。
            // - 调度与 rAF 解耦：页面无焦点/被遮挡时 rAF 会被节流甚至停帧，嵌套 rAF 的轻推
            //   会迟到或永不执行——这正是遮角标长时间挂着的原因；setTimeout 兜底保证必达。
            // - 微扰推：制造 2px 的真实差异再立即还原（等价于用户手动拉一下），
            //   强制"差异驱动"的布局系统重算；瞬时无感。
            // 仅有限几次、无轮询。
            const nudge = (perturb) => {
                try {
                    if (!container.isConnected || !node.graph) return;
                    const w = node.size[0], h = node.size[1];
                    if (perturb) {
                        node.setSize([w, h + 2]);
                        const restore = () => { try { node.setSize([w, h]); } catch (e) { } };
                        requestAnimationFrame(restore);
                        setTimeout(restore, 30);
                    } else {
                        node.setSize([w, h]);
                    }
                } catch (e) { }
            };
            let nudgedFirst = false;
            const nudgeFirst = () => {
                if (nudgedFirst) return;
                nudgedFirst = true;
                nudge(false);
            };
            requestAnimationFrame(() => requestAnimationFrame(nudgeFirst));
            setTimeout(nudgeFirst, 60);
            // 首帧收敛兜底（微扰，最可能生效的时点），稍晚再补两次
            setTimeout(() => nudge(true), 350);
            setTimeout(() => nudge(false), 900);
            setTimeout(() => nudge(true), 1800);
            // 页面先前被遮挡/后台加载时，节点进入视口那一刻再补一次（一次性，非轮询）
            if ("IntersectionObserver" in window) {
                try {
                    const io = new IntersectionObserver((entries) => {
                        for (const e of entries) {
                            if (e.isIntersecting) { nudge(true); io.disconnect(); node._vfNudgeIO = null; break; }
                        }
                    }, { threshold: 0 });
                    node._vfNudgeIO = io;
                    const ioAttach = () => { try { io.observe(container); } catch (e) { } };
                    requestAnimationFrame(ioAttach);
                    setTimeout(ioAttach, 0);
                } catch (e) { }
            }
        }

        // ====================================================================
        // 状态与交互逻辑
        // ====================================================================
        let meta = null;            // { fps, duration, total, maxFrame }
        let refreshToken = 0;       // 防止快速切换视频时旧请求覆盖新状态
        let rafId = 0;
        let pendingSeek = null;

        const setStatus = (msg, color = "#888") => {
            statusEl.textContent = msg || "";
            statusEl.style.color = color;
        };

        const seekThrottled = (seconds) => {
            pendingSeek = seconds;
            if (rafId) return;
            rafId = requestAnimationFrame(() => {
                rafId = 0;
                if (pendingSeek == null) return;
                try { videoEl.currentTime = pendingSeek; } catch (e) { /* ignore */ }
            });
        };

        // 统一的"设置当前帧"入口：同步 widget / 数字框 / 时间轴 / 视频预览
        const setFrame = (value, opts = {}) => {
            const { seek = true, syncSlider = true } = opts;
            let n = Math.round(Number(value));
            if (!isFinite(n)) n = 0;
            n = Math.max(0, n);
            if (meta && meta.maxFrame >= 0) n = Math.min(n, meta.maxFrame);
            frameWidget.value = n;
            numInput.value = n;
            if (syncSlider) slider.value = n;
            if (seek && meta && meta.fps > 0) seekThrottled(n / meta.fps);
        };

        slider.addEventListener("input", () => {
            setFrame(slider.value, { syncSlider: false });
        });
        // 防止拖动时间轴时拖走节点
        slider.addEventListener("pointerdown", (e) => e.stopPropagation());

        numInput.addEventListener("change", () => setFrame(numInput.value));
        numInput.addEventListener("pointerdown", (e) => e.stopPropagation());

        const currentSelection = () => {
            const name = (videoWidget.value || "").toString().trim();
            const path = (pathWidget?.value || "").toString().trim();
            const hasName = name && !name.startsWith("no video files");
            return { name: hasName ? name : "", path };
        };

        const refreshVideo = async () => {
            const token = ++refreshToken;
            const { name, path } = currentSelection();

            if (!name && !path) {
                meta = null;
                videoEl.removeAttribute("src");
                videoEl.load();
                placeholder.style.display = "block";
                totalSpan.textContent = "";
                infoSpan.textContent = "";
                slider.max = 0;
                slider.value = 0;
                setStatus("");
                return;
            }

            placeholder.style.display = "none";

            const srcUrl = api.apiURL(
                `/workflow_tools/video_file?video=${encodeURIComponent(name)}&path=${encodeURIComponent(path)}`
            );
            if (videoEl.getAttribute("src") !== srcUrl) videoEl.src = srcUrl;

            try {
                const resp = await api.fetchApi(
                    `/workflow_tools/video_info?video=${encodeURIComponent(name)}&path=${encodeURIComponent(path)}`
                );
                const info = await resp.json();
                if (token !== refreshToken) return;
                if (!info.ok) {
                    meta = null;
                    setStatus(`读取视频信息失败: ${info.error || "unknown"}`, "#ff6b6b");
                    return;
                }
                const fps = info.fps > 0 ? info.fps : 24;
                let maxFrame;
                if (info.total_frames > 0) maxFrame = info.total_frames - 1;
                else if (info.duration > 0) maxFrame = Math.max(0, Math.round(info.duration * fps) - 1);
                else maxFrame = 1000000;
                meta = { fps, duration: info.duration, total: info.total_frames, maxFrame };
                slider.max = maxFrame;
                totalSpan.textContent = info.total_frames > 0
                    ? `/ ${info.total_frames} 帧${info.exact_frames ? "" : "（约）"}`
                    : (info.duration > 0 ? `/ 约 ${maxFrame + 1} 帧` : "");
                infoSpan.textContent = `${fps.toFixed(3)} fps · ${fmtTime(info.duration)} · ${info.width}x${info.height}`;
                setStatus("");
                setFrame(frameWidget.value ?? 0);
            } catch (err) {
                if (token !== refreshToken) return;
                setStatus(`读取视频信息失败: ${err?.message || err}`, "#ff6b6b");
            }
        };

        videoEl.addEventListener("error", () => {
            if (!videoEl.getAttribute("src")) return;
            setStatus("浏览器无法预览此视频（不影响抽帧导出）", "#e0a24a");
        });

        // 选择变化时刷新预览
        const bindVideoWidget = (w) => {
            if (!w) return;
            const orig = w.callback;
            w.callback = function () {
                if (orig) orig.apply(this, arguments);
                refreshVideo();
            };
        };
        bindVideoWidget(videoWidget);
        bindVideoWidget(pathWidget);

        // ====================================================================
        // 上传 / 拖拽
        // ====================================================================
        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = "video/*";
        fileInput.style.display = "none";
        document.body.appendChild(fileInput);

        const acceptUploadedName = (name) => {
            const values = videoWidget.options?.values;
            if (Array.isArray(values) && !values.includes(name)) values.push(name);
            videoWidget.value = name;
            setStatus("");
            refreshVideo();
        };

        const uploadFile = async (file) => {
            try {
                // 桌面环境可直接拿到绝对路径：无需上传，直接当作路径使用
                if (file.path) {
                    acceptUploadedName(file.path);
                    return;
                }

                const safeName = sanitizeName(file.name) || "video.mp4";
                uploadBtn.textContent = "上传中…";
                app.canvas?.setDirty?.(true, false);

                // 同名同大小的文件已存在时直接复用；同名不同大小改用新名字，避免覆盖
                let finalName = safeName;
                try {
                    const checkResp = await api.fetchApi(
                        `/workflow_tools/check_file?filename=${encodeURIComponent(safeName)}&size=${file.size}`
                    );
                    if (checkResp.ok) {
                        const checkData = await checkResp.json();
                        if (checkData.exists) {
                            acceptUploadedName(checkData.name);
                            return;
                        }
                        if (checkData.name) finalName = checkData.name;
                    }
                } catch (e) { /* 去重接口异常时忽略，正常上传 */ }

                // 分块上传（20MB/块），不受 /upload/image 请求体大小限制
                const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
                for (let i = 0; i < totalChunks; i++) {
                    const chunk = file.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
                    const body = new FormData();
                    body.append("file", chunk);
                    body.append("filename", finalName);
                    body.append("chunk_index", i);
                    body.append("total_chunks", totalChunks);
                    const resp = await api.fetchApi("/workflow_tools/upload_chunk", { method: "POST", body });
                    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                    if (totalChunks > 1) {
                        uploadBtn.textContent = `上传中… ${Math.round(((i + 1) / totalChunks) * 100)}%`;
                        app.canvas?.setDirty?.(true, false);
                    }
                }
                acceptUploadedName(finalName);
            } catch (err) {
                setStatus(`上传失败: ${err?.message || err}`, "#ff6b6b");
            } finally {
                uploadBtn.textContent = "选择 / 上传视频";
                fileInput.value = "";
            }
        };

        uploadBtn.addEventListener("click", () => fileInput.click());
        fileInput.addEventListener("change", (e) => {
            if (e.target.files?.length) uploadFile(e.target.files[0]);
        });

        node.onDragOver = function (e) {
            if (e.dataTransfer?.types?.includes("Files")) {
                e.preventDefault();
                return true;
            }
            return false;
        };
        node.onDragDrop = function (e) {
            const file = e.dataTransfer?.files?.[0];
            if (file && (file.type.startsWith("video/") || VIDEO_EXT_RE.test(file.name))) {
                uploadFile(file);
                return true;
            }
            return false;
        };
        node.onDropFile = function (file) {
            if (file && (file.type.startsWith("video/") || VIDEO_EXT_RE.test(file.name))) {
                uploadFile(file);
                return true;
            }
            return false;
        };

        // ====================================================================
        // 执行结果反馈
        // ====================================================================
        const onExecuted = (e) => {
            const detail = e?.detail;
            if (!detail || String(detail.node) !== String(node.id)) return;
            const imgs = detail.output?.images;
            if (Array.isArray(imgs) && imgs.length) {
                const item = imgs[0];
                const shown = item.subfolder ? `${item.subfolder}/${item.filename}` : item.filename;
                setStatus(`已保存: ${shown}`, "#5ccf7a");
            }
        };
        api.addEventListener("executed", onExecuted);

        // ====================================================================
        // 生命周期
        // ====================================================================
        const origOnConfigure = node.onConfigure;
        node.onConfigure = function (info) {
            const r = origOnConfigure ? origOnConfigure.apply(this, arguments) : undefined;
            // 经典模式：存档尺寸可能很小（如从 Nodes 2.0 切回），而初始校正链挂在 rAF 上——
            // 加载繁忙/后台标签等时序下 rAF 会迟到，窗口被内容顶出、底部控件被裁会持续很久。
            // 这里在首次 configure 时同步抬到合理下限（30ms 后再核对一次，避开赋值顺序），
            // 之后不再干预（不干扰用户手动缩放与撤销）。
            if (!IS_VUE2 && !this._vfFirstConfigure) {
                this._vfFirstConfigure = true;
                const fix = () => {
                    try {
                        const curW = this.size?.[0] || 0;
                        const curH = this.size?.[1] || 0;
                        const w = Math.max(curW, 500);
                        const h = Math.max(curH, DOM_PLACEHOLDER_H + 130);
                        if (w !== curW || h !== curH) {
                            this.setSize([w, h]);
                            app.canvas?.setDirty(true, true);
                        }
                    } catch (e) { }
                };
                fix();
                setTimeout(fix, 30);
            }
            setTimeout(refreshVideo, 50);
            return r;
        };

        const origOnRemoved = node.onRemoved;
        node.onRemoved = function () {
            api.removeEventListener("executed", onExecuted);
            if (fileInput.parentNode) fileInput.parentNode.removeChild(fileInput);
            if (node._vfModeListener) modeChangeListeners.delete(node._vfModeListener);
            if (node._vfNudgeIO) { try { node._vfNudgeIO.disconnect(); } catch (e) { } node._vfNudgeIO = null; }
            if (origOnRemoved) origOnRemoved.apply(this, arguments);
        };

        // 初始化尺寸与预览（双通道：正常走 rAF；加载繁忙/后台标签导致 rAF 冻结时
        // 用 setTimeout 兜底触发，避免"窗口小、内容顶出"的错误状态持续很久）
        let _vfInitDone = false;
        const initVideoNode = () => {
            if (_vfInitDone) return;
            _vfInitDone = true;
            if (!IS_VUE2) {
                // 经典模式：手工分配合适的初始尺寸（2.0 由平台按内容/布局管理，无需干预）
                syncLayout();
                let min = [0, 0];
                try { min = node.computeSize() || min; } catch (e) { }
                const w = Math.max(node.size[0] || 0, 500, min[0] || 0);
                // 初始高度：视频区初始约 280px 高（固定占位基准 272 + 130 余量；写死，不依赖占位值）
                const h = Math.max(node.size[1] || 0, DOM_PLACEHOLDER_H + 130);
                node.setSize([w, h]);
                app.canvas?.setDirty(true, true);
                // 二段校正：头顶区实际高度测出后，保证节点高度容得下"视频区 + 底部控件"
                const second = () => {
                    try {
                        const domY = getDomY();
                        if (domY > 0) {
                            const want = domY + DOM_PLACEHOLDER_H + 20;
                            if (want > node.size[1]) {
                                node.setSize([node.size[0], want]);
                                app.canvas?.setDirty(true, true);
                            }
                        }
                        syncLayout();
                    } catch (e) { }
                };
                requestAnimationFrame(second);
                setTimeout(second, 60);
            }
            refreshVideo();
        };
        requestAnimationFrame(initVideoNode);
        setTimeout(initVideoNode, 40);
    },
});
