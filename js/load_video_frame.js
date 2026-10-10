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
        // DOM 结构
        // ====================================================================
        const container = document.createElement("div");
        Object.assign(container.style, {
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            width: "100%",
            boxSizing: "border-box",
            padding: "8px",
            background: "rgba(28, 28, 30, 0.85)",
            borderRadius: "6px",
            color: "#ddd",
            fontFamily: "sans-serif",
        });

        // --- 视频预览区 ---
        const videoWrap = document.createElement("div");
        Object.assign(videoWrap.style, {
            position: "relative",
            width: "100%",
            height: "260px",
            background: "#000",
            borderRadius: "4px",
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: "0",
        });

        const videoEl = document.createElement("video");
        Object.assign(videoEl.style, {
            width: "100%",
            height: "100%",
            objectFit: "contain",
            outline: "none",
        });
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
        container.appendChild(videoWrap);

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
        container.appendChild(row);

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
        container.appendChild(slider);

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
            padding: "3px 10px",
            fontSize: "12px",
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
        container.appendChild(bottomRow);

        // 布局常量：
        // - FIXED_BOTTOM：视频区下方的固定控件区（帧号行/时间轴/按钮行/间距/内边距）
        // - DOM_MIN_VIDEO：视频区最小高度
        // - DOM_PLACEHOLDER_H：DOM 的布局占位高度，必须是固定值！
        //   （若动态跟随节点高度，前端缩放限制会与它互相锁死，导致节点只能放大不能缩小）
        const FIXED_BOTTOM = 112;
        const DOM_MIN_VIDEO = 160;
        const DOM_PLACEHOLDER_H = DOM_MIN_VIDEO + FIXED_BOTTOM;
        let videoH = 260;

        const domWidget = node.addDOMWidget("vfx_ui", "div", container);
        if (domWidget) {
            domWidget.computeSize = (w) => [w, DOM_PLACEHOLDER_H];
        }

        // 宽度与视频区高度跟随节点尺寸（只调整 DOM 元素自身，不动布局占位）
        const syncLayout = () => {
            const w = Math.max(200, (node.size?.[0] || 470) - 30);
            container.style.width = `${w}px`;
            container.style.maxWidth = `${w}px`;

            const domY = domWidget && typeof domWidget.last_y === "number" ? domWidget.last_y : 0;
            let target = videoH;
            if (domY > 0) {
                target = node.size[1] - domY - FIXED_BOTTOM - 8;
            }
            target = Math.max(DOM_MIN_VIDEO, Math.min(target, 4000));
            if (Math.abs(target - videoH) > 1) videoH = target;
            videoWrap.style.height = `${videoH}px`;
            container.style.height = `${videoH + FIXED_BOTTOM}px`;
        };
        const origOnResize = node.onResize;
        node.onResize = function () {
            const r = origOnResize ? origOnResize.apply(this, arguments) : undefined;
            syncLayout();
            return r;
        };
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
            setTimeout(refreshVideo, 50);
            return r;
        };

        const origOnRemoved = node.onRemoved;
        node.onRemoved = function () {
            api.removeEventListener("executed", onExecuted);
            if (fileInput.parentNode) fileInput.parentNode.removeChild(fileInput);
            if (origOnRemoved) origOnRemoved.apply(this, arguments);
        };

        // 初始化尺寸与预览
        requestAnimationFrame(() => {
            syncLayout();
            const min = node.computeSize();
            const w = Math.max(node.size[0], 500, min[0]);
            // 初始高度：在固定占位外多留 130px，让视频区初始约 280px 高
            const h = Math.max(node.size[1], min[1] + 130);
            node.setSize([w, h]);
            app.canvas?.setDirty(true, true);
            refreshVideo();
        });
    },
});
