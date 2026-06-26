import { app } from "../../scripts/app.js";

// Change "en" to "zh" to switch to Chinese，下面一行的"en"改成"zh"即可切换中文
const LANG = "en";

const I18N = {
    en: { label_ph: "Label...", add: "＋ Add Segment", default_label: "Quality Tags",
          seg_ph: (i) => `Enter segment ${i} prompt...` },
    zh: { label_ph: "备注标签...", add: "＋ 添加段落", default_label: "质量词",
          seg_ph: (i) => `输入第 ${i} 段提示词...` },
};
const T = I18N[LANG] ?? I18N.en;

app.registerExtension({
    name: "PromptSegments",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "PromptSegments") return;

        nodeType.prototype._render = function () {
            const container = this._segContainer;
            container.innerHTML = "";

            this._segments.forEach((seg, i) => {
                const row = document.createElement("div");
                const updateRowStyle = () => {
                    row.style.cssText = `display:flex;flex-direction:column;gap:0;border-radius:6px;overflow:hidden;border:1px solid ${seg.enabled ? "#3a3a4a" : "#2a2a2a"};opacity:${seg.enabled ? "1" : "0.5"};transition:opacity 0.2s;`;
                };
                updateRowStyle();

                const top = document.createElement("div");
                top.style.cssText = `display:flex;align-items:center;gap:6px;padding:5px 6px;background:${seg.enabled ? "#2d2d3d" : "#252525"};border-left:3px solid ${seg.enabled ? "#4a9eff" : "#555"};`;

                const toggle = document.createElement("input");
                toggle.type = "checkbox"; toggle.checked = seg.enabled;
                toggle.style.cssText = "width:14px;height:14px;cursor:pointer;accent-color:#4a9eff;flex-shrink:0;";
                toggle.onchange = () => {
                    seg.enabled = toggle.checked;
                    updateRowStyle();
                    top.style.background = seg.enabled ? "#2d2d3d" : "#252525";
                    top.style.borderLeftColor = seg.enabled ? "#4a9eff" : "#555";
                    row.style.borderColor = seg.enabled ? "#3a3a4a" : "#2a2a2a";
                    this._sync();
                };

                const labelNum = document.createElement("span");
                labelNum.textContent = `#${i + 1}`;
                labelNum.style.cssText = "color:#666;font-size:10px;flex-shrink:0;font-family:monospace;";

                const label = document.createElement("input");
                label.type = "text"; label.value = seg.label; label.placeholder = T.label_ph;
                label.style.cssText = "flex:1;background:transparent;color:#bbb;border:none;outline:none;padding:0 2px;font-size:11px;min-width:0;";
                label.oninput = () => { seg.label = label.value; };

                const del = document.createElement("button");
                del.innerHTML = "✕";
                del.style.cssText = "background:transparent;color:#666;border:none;border-radius:3px;padding:2px 5px;cursor:pointer;font-size:11px;flex-shrink:0;line-height:1;transition:color 0.15s,background 0.15s;";
                del.onmouseenter = () => { del.style.color = "#fff"; del.style.background = "#c0392b"; };
                del.onmouseleave = () => { del.style.color = "#666"; del.style.background = "transparent"; };
                del.onclick = () => { this._segments.splice(i, 1); this._sync(); this._render(); };

                top.append(toggle, labelNum, label, del);

                const ta = document.createElement("textarea");
                ta.value = seg.text; ta.placeholder = T.seg_ph(i + 1);
                ta.style.cssText = "width:100%;min-height:64px;height:64px;background:#181820;color:#ddd;border:none;border-top:1px solid #2a2a3a;padding:6px 8px;font-size:12px;resize:none;box-sizing:border-box;outline:none;font-family:monospace;line-height:1.5;overflow:hidden;";
                ta.onfocus = () => { ta.style.background = "#1c1c28"; };
                ta.onblur = () => { ta.style.background = "#181820"; };

                const autoResize = () => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; };
                ta.oninput = () => { seg.text = ta.value; autoResize(); this._applySize(); this._sync(); };
                requestAnimationFrame(autoResize);

                row.append(top, ta);
                container.appendChild(row);
            });

            const addBtn = document.createElement("button");
            addBtn.innerHTML = T.add;
            addBtn.style.cssText = "width:100%;padding:6px;background:transparent;color:#4a9eff;border:1px dashed #3a5a7a;border-radius:6px;cursor:pointer;font-size:12px;transition:background 0.15s,border-color 0.15s;";
            addBtn.onmouseenter = () => { addBtn.style.background = "#1a2a3a"; addBtn.style.borderColor = "#4a9eff"; };
            addBtn.onmouseleave = () => { addBtn.style.background = "transparent"; addBtn.style.borderColor = "#3a5a7a"; };
            addBtn.onclick = () => { this._segments.push({ enabled: true, label: "", text: "" }); this._sync(); this._render(); };
            container.appendChild(addBtn);

            this._applySize();
        };

        nodeType.prototype._applySize = function () {
            this._domWidget.element.style.height = "auto";
            this._domWidget.computeSize = () => [0, -4];

            requestAnimationFrame(() => {
                const domH = this._segContainer.scrollHeight;
                if (!this._overhead) this._overhead = Math.max(this.size[1] - domH, 60);
                const h = domH + this._overhead;
                this._minH = h;
                this.size[1] = h;
                app.graph.setDirtyCanvas(true, true);
            });
        };

        nodeType.prototype._sync = function () {
            if (this._rawWidget) this._rawWidget.value = JSON.stringify(this._segments);
        };

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);

            const raw = this.widgets?.find(w => w.name === "segments");
            if (raw) { raw.hidden = true; raw.computeSize = () => [0, -4]; }
            this._rawWidget = raw;
            this._segments = [{ enabled: true, label: T.default_label, text: "" }];

            const container = document.createElement("div");
            container.style.cssText = "display:flex;flex-direction:column;gap:4px;padding:4px;box-sizing:border-box;width:100%;";
            this._segContainer = container;

            this._domWidget = this.addDOMWidget("_ui", "div", container, { serialize: false });

            this.onResize = function (size) {
                if (this._minH && size[1] < this._minH) size[1] = this._minH;
            };

            requestAnimationFrame(() => this._render());
        };

        const onSerialize = nodeType.prototype.onSerialize;
        nodeType.prototype.onSerialize = function (o) {
            onSerialize?.apply(this, arguments);
            o.prompt_segments = this._segments;};

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (o) {
            onConfigure?.apply(this, arguments);
            if (o.prompt_segments) { this._segments = o.prompt_segments; this._render(); }
        };
    }
});