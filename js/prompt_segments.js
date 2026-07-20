import { app } from "../../../scripts/app.js";

// 语言配置：将下面一行的 "en" 改成 "zh" 即可切换中文
const LANG = "en";

const I18N = {
    en: { label_ph: "Label...", add: "＋ Add Segment", default_label: "Quality Tags",
          seg_ph: (i) => `Enter segment ${i} prompt...`, order_tip: "Change order (move this segment)" },
    zh: { label_ph: "备注标签...", add: "＋ 添加段落", default_label: "质量词",
          seg_ph: (i) => `输入第 ${i} 段提示词...`, order_tip: "修改顺序（移动此段落）" },
};
const T = I18N[LANG] ?? I18N.en;

var _TAG_DICT = [];
var _TAG_READY = false;
(function () {
    try {
        var url = new URL("./tags/tag_dictionary.json", import.meta.url).href;
        fetch(url).then(function (r) { return r.json(); }).then(function (data) {
            _TAG_DICT = data;
            _TAG_READY = true;
        }).catch(function (e) { console.warn("[PromptSegments] Tag dict load failed:", e); });
    } catch (e) { console.warn("[PromptSegments] Tag dict init failed:", e); }
})();

function _matchTags(prefix) {
    if (!_TAG_READY || prefix.length < 2) return [];
    var lower = prefix.toLowerCase();
    var result = [];
    for (var i = 0; i < _TAG_DICT.length; i++) {
        if (_TAG_DICT[i].toLowerCase().startsWith(lower)) {
            result.push(_TAG_DICT[i]);
            if (result.length >= 10) break;
        }
    }
    return result;
}

function _getWordAtCursor(ta) {
    var val = ta.value;
    var pos = ta.selectionStart;
    var before = val.substring(0, pos);
    var lastDelim = Math.max(
        before.lastIndexOf(','),
        before.lastIndexOf('.'),
        before.lastIndexOf(';'),
        before.lastIndexOf('\n'),
        before.lastIndexOf('，'),
        before.lastIndexOf('。')
    );
    var word = before.substring(lastDelim + 1).trim();
    return { lastDelim: lastDelim, word: word, before: before, after: val.substring(pos) };
}

app.registerExtension({
    name: "PromptSegments",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "PromptSegments") return;

        nodeType.prototype._calcHeight = function () {
            const LINE_H = 18, PADDING = 20, TOP_ROW = 30, SEG_GAP = 5, NODE_CHROME = 60, INSERT_ROW = 24;
            let h = NODE_CHROME + INSERT_ROW;
            this._segments.forEach(seg => {
                if (!seg.enabled) {
                    // Collapsed: header + minimal textarea (64px)
                    h += TOP_ROW + 64 + SEG_GAP;
                    return;
                }
                const lines = Math.max(1, (seg.text.match(/\n/g) || []).length + 1);
                h += TOP_ROW + Math.max(64, lines * LINE_H + PADDING) + SEG_GAP;
            });
            return h + 36;
        };

        nodeType.prototype._applySize = function () {
            this._domWidget.element.style.height = "auto";
            this._domWidget.computeSize = () => [0, -4];
            requestAnimationFrame(() => {
                const domH = this._segContainer.scrollHeight;
                const h = (domH && domH > 0) ? domH + 60 : this._calcHeight();
                this._minH = h;
                this.setSize([this.size[0], h]);
                app.graph.setDirtyCanvas(true, true);
            });
        };

        nodeType.prototype._remeasure = function () {
            if (!this._segContainer) return;
            let idx = 0;
            this._segContainer.querySelectorAll("textarea").forEach(ta => {
                const seg = this._segments[idx++];
                // Skip collapsed segments — their height is fixed at 64px.
                if (seg && !seg.enabled) return;
                ta.style.height = "auto";
                const sh = ta.scrollHeight;
                if (sh && sh > 0) ta.style.height = sh + "px";
            });
            this._applySize();
        };

        nodeType.prototype._render = function () {
            const container = this._segContainer;
            container.innerHTML = "";

            const insertRow = document.createElement("div");
            insertRow.style.cssText = "display:inline-flex;align-items:center;gap:6px;padding:3px 6px;background:#1a1a22;border:1px solid #2a2a3a;border-radius:4px;font-size:11px;color:#888;align-self:flex-start;";
            var insertLabel = document.createElement("span");
            insertLabel.textContent = LANG === "zh" ? "→ 外部文本插入到第几段前:" : "→ Insert external text before #:";
            insertLabel.style.cssText = "flex-shrink:0;";
            var insertNum = document.createElement("input");
            insertNum.type = "text";
            insertNum.value = this._insertPosWidget ? this._insertPosWidget.value : 1;
            insertNum.style.cssText = "width:30px;height:18px;background:#1a1a22;color:#aaa;border:1px solid #333344;border-radius:4px;text-align:center;font-size:11px;font-family:monospace;padding:1px 0;outline:none;box-sizing:content-box;";
            insertNum.onfocus = function() { insertNum.style.borderColor = "#4a9eff"; insertNum.style.color = "#fff"; insertNum.select(); };
            insertNum.onblur = function() { insertNum.style.borderColor = "#333344"; insertNum.style.color = "#aaa"; };
            insertNum.onchange = function() {
                var v = parseInt(insertNum.value) || 1;
                if (v < 1) v = 1;
                insertNum.value = v;
                if (this._insertPosWidget) { this._insertPosWidget.value = v; this._insertPosWidget.callback(v); }
                this._sync();
            }.bind(this);
            var insertHint = document.createElement("span");
            insertHint.textContent = LANG === "zh" ? "1=最前" : "1=front";
            insertHint.style.cssText = "color:#555;font-size:10px;flex-shrink:0;";
            insertRow.append(insertLabel, insertNum, insertHint);
            container.appendChild(insertRow);

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
                    seg.enabled = !seg.enabled;
                    toggle.checked = seg.enabled;
                    this._sync();
                    this._minH = 0;
                    this._render();
                };

                const labelNum = document.createElement("input");
                labelNum.type = "text";
                labelNum.value = i + 1;
                labelNum.title = T.order_tip;
                labelNum.style.cssText = "color:#aaa;font-size:11px;flex-shrink:0;font-family:monospace;width:26px;text-align:center;background:#1a1a22;border:1px solid #333344;border-radius:4px;padding:1px 0;outline:none;box-sizing:content-box;";
                labelNum.onfocus = () => { labelNum.style.borderColor = "#4a9eff"; labelNum.style.color = "#fff"; labelNum.select(); };
                labelNum.onblur = () => { labelNum.style.borderColor = "#333344"; labelNum.style.color = "#aaa"; };
                labelNum.onchange = () => {
                    const raw = labelNum.value.trim();
                    const parsed = parseFloat(raw);
                    const total = this._segments.length;
                    const current = i + 1;
                    if (!Number.isFinite(parsed)) { labelNum.value = current; return; }
                    let target = Math.round(parsed);
                    if (target <= 0) target = 1;
                    if (target > total) target = total;
                    if (target === current) { labelNum.value = current; return; }
                    const item = this._segments.splice(i, 1)[0];
                    this._segments.splice(target - 1, 0, item);
                    this._sync();
                    this._render();
                };

                const label = document.createElement("input");
                label.type = "text"; label.value = seg.label; label.placeholder = T.label_ph;
                label.style.cssText = "flex:1;background:transparent;color:#bbb;border:none;outline:none;padding:0 2px;font-size:11px;min-width:0;";
                label.oninput = () => { seg.label = label.value; };

                const del = document.createElement("button");
                del.innerHTML = "✕";
                del.style.cssText = "background:transparent;color:#666;border:none;border-radius:3px;padding:2px 5px;cursor:pointer;font-size:11px;flex-shrink:0;line-height:1;transition:color 0.15s,background 0.15s;";
                del.onmouseenter = () => { del.style.color = "#fff"; del.style.background = "#c0392b"; };
                del.onmouseleave = () => { del.style.color = "#666"; del.style.background = "transparent"; };
                del.onclick = () => {
                    this._segments.splice(i, 1);
                    this._sync();
                    this._minH = 0;
                    this._render();
                };

                top.append(toggle, labelNum, label, del);

                const suggestStrip = document.createElement("div");
                suggestStrip.style.cssText = "display:none;flex-wrap:wrap;gap:3px;padding:3px 6px;background:#161622;border-top:1px solid #2a2a3a;";

                const ta = document.createElement("textarea");
                ta.value = seg.text; ta.placeholder = T.seg_ph(i + 1);

                // Collapsed: lock height to min-height, hide overflow to show ~1 line.
                const taBase = "width:100%;background:#181820;color:#ddd;border:none;border-top:1px solid #2a2a3a;padding:6px 8px;font-size:12px;resize:none;box-sizing:border-box;outline:none;font-family:monospace;line-height:1.5;";
                if (!seg.enabled) {
                    ta.style.cssText = taBase + "height:64px;min-height:64px;overflow:hidden;opacity:0.4;";
                } else {
                    ta.style.cssText = taBase + "min-height:64px;height:64px;overflow:hidden;";
                    ta.onfocus = () => { ta.style.background = "#1c1c28"; suggestStrip.style.display = "none"; this._applySize(); };
                    ta.onblur = () => {
                        ta.style.background = "#181820";
                        setTimeout(() => {
                            if (suggestStrip.style.display !== "none") {
                                suggestStrip.style.display = "none";
                                this._applySize();
                            }
                        }, 200);
                    };

                    const autoResize = () => {
                        ta.style.height = "auto";
                        const sh = ta.scrollHeight;
                        if (sh && sh > 0) ta.style.height = sh + "px";
                        this._applySize();
                    };

                    ta.onkeydown = (e) => {
                        if (suggestStrip.style.display === "none") return;
                        var chips = suggestStrip.querySelectorAll("span");
                        var updateHighlight = function() {
                            chips.forEach(function(c, i) {
                                c.style.background = i === ta._suggestIdx ? "#3a5a7a" : "#252535";
                                c.style.borderColor = i === ta._suggestIdx ? "#5a7a9a" : "#3a3a5a";
                                c.style.color = i === ta._suggestIdx ? "#fff" : "#aaa";
                            });
                        };
                        if (e.key === "Tab") {
                            e.preventDefault();
                            var idx = ta._suggestIdx >= 0 ? ta._suggestIdx : 0;
                            if (chips[idx]) chips[idx].click();
                            return;
                        }
                        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                            e.preventDefault();
                            if (ta._suggestIdx < 0) {
                                ta._suggestIdx = e.key === "ArrowDown" ? 0 : chips.length - 1;
                                updateHighlight();
                                return;
                            }
                            // Build rows based on chip Y positions
                            var rows = [];
                            var lastTop = -1;
                            for (var i = 0; i < chips.length; i++) {
                                var top = chips[i].getBoundingClientRect().top;
                                if (Math.abs(top - lastTop) > 2) { rows.push([]); lastTop = top; }
                                rows[rows.length - 1].push(i);
                            }
                            var rowIdx = -1, colIdx = -1;
                            for (var r = 0; r < rows.length; r++) {
                                var c = rows[r].indexOf(ta._suggestIdx);
                                if (c >= 0) { rowIdx = r; colIdx = c; break; }
                            }
                            if (e.key === "ArrowDown" && rowIdx < rows.length - 1) {
                                var nextRow = rows[rowIdx + 1];
                                ta._suggestIdx = nextRow[Math.min(colIdx, nextRow.length - 1)];
                            } else if (e.key === "ArrowUp" && rowIdx > 0) {
                                var prevRow = rows[rowIdx - 1];
                                ta._suggestIdx = prevRow[Math.min(colIdx, prevRow.length - 1)];
                            }
                            updateHighlight();
                            return;
                        }
                        if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && ta._suggestIdx >= 0) {
                            e.preventDefault();
                            ta._suggestIdx = e.key === "ArrowLeft"
                                ? Math.max(ta._suggestIdx - 1, 0)
                                : Math.min(ta._suggestIdx + 1, chips.length - 1);
                            updateHighlight();
                            return;
                        }
                    };

                    ta.oninput = () => {
                        seg.text = ta.value; autoResize(); this._sync();
                        ta._suggestIdx = -1;
                        var info = _getWordAtCursor(ta);
                        var matches = _matchTags(info.word);
                        if (matches.length === 0) { suggestStrip.style.display = "none"; return; }
                        suggestStrip.innerHTML = "";
                        var node = this;
                        for (var m = 0; m < matches.length; m++) {
                            (function(tag) {
                                var displayTag = tag.replace(/_/g, ' ');
                                var chip = document.createElement("span");
                                chip.textContent = displayTag;
                                chip.style.cssText = "display:inline-block;padding:2px 6px;background:#252535;color:#aaa;border:1px solid #3a3a5a;border-radius:3px;cursor:pointer;font-size:10px;font-family:monospace;white-space:nowrap;transition:background 0.1s,color 0.1s,border-color 0.1s;";
                                chip.onmouseenter = function() { chip.style.background = "#3a4a6a"; chip.style.color = "#fff"; chip.style.borderColor = "#5a7a9a"; };
                                chip.onmouseleave = function() { chip.style.background = "#252535"; chip.style.color = "#aaa"; chip.style.borderColor = "#3a3a5a"; };
                                chip.onclick = function() {
                                    var prefix = info.before.substring(0, info.lastDelim + 1);
                                    var spacer = info.lastDelim >= 0 ? " " : "";
                                    var insert = prefix + spacer + displayTag + ", ";
                                    ta.value = insert + info.after;
                                    seg.text = ta.value;
                                    ta.focus();
                                    ta.setSelectionRange(insert.length, insert.length);
                                    suggestStrip.style.display = "none";
                                    autoResize();
                                    node._sync();
                                };
                                suggestStrip.appendChild(chip);
                            })(matches[m]);
                        }
                        suggestStrip.style.display = "flex";
                    };

                    requestAnimationFrame(autoResize);
                }

                row.append(top, ta, suggestStrip);
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

        nodeType.prototype._sync = function () {
            if (this._rawWidget) this._rawWidget.value = JSON.stringify(this._segments);
        };

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);

            this.size[0] = Math.max(this.size[0], 400);

            const raw = this.widgets?.find(w => w.name === "segments");
            if (raw) { raw.hidden = true; raw.computeSize = () => [0, -4]; }
            this._rawWidget = raw;

            var ipw = this.widgets?.find(function(w) { return w.name === "insert_pos"; });
            if (ipw) { ipw.hidden = true; ipw.computeSize = () => [0, -4]; }
            this._insertPosWidget = ipw;

            this._segments = [{ enabled: true, label: T.default_label, text: "" }];

            const container = document.createElement("div");
            container.style.cssText = "display:flex;flex-direction:column;gap:4px;padding:4px;box-sizing:border-box;width:100%;position:relative;";
            this._segContainer = container;

            this._domWidget = this.addDOMWidget("_ui", "div", container, { serialize: false });

            this.onResize = function (size) {
                if (this._minH && size[1] < this._minH) size[1] = this._minH;
            };

            this._wasVisible = false;
            if ("IntersectionObserver" in window) {
                this._visObserver = new IntersectionObserver((entries) => {
                    for (const e of entries) {
                        if (e.isIntersecting && !this._wasVisible) this._remeasure();
                        this._wasVisible = e.isIntersecting;
                    }
                }, { threshold: 0 });
                requestAnimationFrame(() => {
                    if (this._visObserver && this._domWidget?.element)
                        this._visObserver.observe(this._domWidget.element);
                });
            }

            requestAnimationFrame(() => this._render());
        };

        const onSerialize = nodeType.prototype.onSerialize;
        nodeType.prototype.onSerialize = function (o) {
            onSerialize?.apply(this, arguments);
            o.prompt_segments = JSON.parse(JSON.stringify(this._segments));
        };

        const onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            onRemoved?.apply(this, arguments);
            if (this._visObserver) { this._visObserver.disconnect(); this._visObserver = null; }
        };

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (o) {
            onConfigure?.apply(this, arguments);
            if (o.prompt_segments) {
                this._segments = o.prompt_segments;
                this._minH = 0;
                if (this._domWidget?.element) this._domWidget.element.style.height = "auto";
                requestAnimationFrame(() => this._render());
            }
        };
    }
});