import { app } from "../../../scripts/app.js";

// 语言配置：将下面一行的 "en" 改成 "zh" 即可切换中文
const LANG = "zh";

const I18N = {
    en: { img2img: "img2img", txt2img: "txt2img" },
    zh: { img2img: "图生图", txt2img: "文生图" },
};
const T = I18N[LANG] ?? I18N.en;

app.registerExtension({
    name: "Img2ImgTxt2ImgSwitch",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "Img2ImgTxt2ImgSwitch") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);

            const modeWidget = this.widgets?.find(w => w.name === "mode");
            if (modeWidget) {
                modeWidget.hidden = true;
                modeWidget.computeSize = () => [0, -4];
            }

            this._switchMode = modeWidget?.value ?? true;

            this.addCustomWidget({
                name: "__mode_switch",
                type: "custom_switch_toggle",
                value: this._switchMode ? "txt2img" : "img2img",
                serialize: false,
                computeSize(ww) {
                    return [ww, 32];
                },
                draw(ctx, node, ww, y) {
                    this._lastY = y;
                    this._lastW = ww;

                    const pad = 12, toggleH = 24, toggleW = ww - pad * 2;
                    const rx = pad, ry = y + 4;
                    const isTxt2Img = node._switchMode;

                    // Background bar
                    ctx.beginPath();
                    ctx.roundRect(rx, ry, toggleW, toggleH, 6);
                    ctx.fillStyle = "#1a1a22";
                    ctx.fill();
                    ctx.strokeStyle = "#3a3a4a";
                    ctx.lineWidth = 1;
                    ctx.stroke();

                    const halfW = toggleW / 2;

                    // Active pill
                    const pillX = isTxt2Img ? rx + halfW : rx;
                    ctx.beginPath();
                    ctx.roundRect(pillX + 2, ry + 2, halfW - 4, toggleH - 4, 4);
                    ctx.fillStyle = isTxt2Img ? "#2e7d32" : "#6a1b1b";
                    ctx.fill();

                    const labelY = ry + toggleH / 2;
                    ctx.font = "bold 11px sans-serif";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";

                    // img2img label
                    ctx.fillStyle = isTxt2Img ? "#777" : "#ffaaaa";
                    ctx.fillText(T.img2img, rx + halfW / 2, labelY);

                    // txt2img label
                    ctx.fillStyle = isTxt2Img ? "#aaffaa" : "#777";
                    ctx.fillText(T.txt2img, rx + halfW + halfW / 2, labelY);
                },
                mouse(e, pos, node) {
                    if (e.type !== "pointerdown") return false;
                    const [mx, my] = pos;
                    const y = this._lastY || 0;
                    const ww = this._lastW || node.size[0];
                    const pad = 12, toggleH = 24;
                    const rx = pad, ry = y + 4;
                    if (my < ry || my > ry + toggleH || mx < rx || mx > rx + ww - pad * 2)
                        return false;

                    const halfW = (ww - pad * 2) / 2;
                    node._switchMode = mx >= rx + halfW;

                    const mw = node.widgets?.find(w => w.name === "mode");
                    if (mw) {
                        mw.value = node._switchMode;
                        mw.callback?.(node._switchMode);
                    }
                    app.graph.setDirtyCanvas(true, true);
                    return true;
                }
            });
        };

        // 工作流加载后同步状态：onConfigure 在序列化数据加载完毕后被调用，
        // 此时 mode widget 的值已被恢复为保存时的真实值，需要同步 _switchMode
        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (info) {
            onConfigure?.apply(this, arguments);
            const modeWidget = this.widgets?.find(w => w.name === "mode");
            if (modeWidget) {
                this._switchMode = modeWidget.value;
            }
        };
    }
});