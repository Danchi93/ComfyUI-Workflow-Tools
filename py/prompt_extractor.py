import json
import os
import torch
from PIL import Image

import folder_paths


class PromptExtractor:
    """Extract prompts from ComfyUI / WebUI PNG metadata.

    1. Copy the PNG into ComfyUI's input/ folder.
    2. Use a standard "Load Image" node to select it (file browser popup).
    3. Connect Load Image output → PromptExtractor.
    4. Positive / negative prompts are available as STRING outputs.
    """

    _MISSING = "No prompt metadata found."

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"image": ("IMAGE",)}}

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("positive", "negative")
    FUNCTION = "extract"
    CATEGORY = "image"
    SEARCH_ALIASES = ["prompt extractor", "metadata", "read prompt", "workflow tools", "提示词提取", "元数据", "读取提示词", "工作流工具"]

    def extract(self, image):
        path = self._find_file(image)
        if not path:
            return (self._MISSING, "")

        raw_prompt, raw_params = self._read_info(path)

        # 1) Try ComfyUI API prompt JSON
        if raw_prompt:
            pos, neg = self._parse_comfyui(raw_prompt)
            if pos is not None and neg is not None:
                return (pos, neg)

        # 2) Fallback to WebUI parameters text
        if raw_params:
            pos, neg = self._parse_webui(raw_params)
            if pos:
                return (pos, neg)

        return (self._MISSING, "")

    # ==================================================================

    def _find_file(self, tensor):
        try:
            import hashlib, numpy as np
            data = tensor.numpy().astype(np.float32)
            h = hashlib.md5(data.tobytes()[:4096]).hexdigest()
            for root, _, files in os.walk(folder_paths.get_input_directory()):
                for f in files:
                    if os.path.splitext(f)[1].lower() not in ('.png','.jpg','.jpeg','.webp','.bmp'):
                        continue
                    fp = os.path.join(root, f)
                    try:
                        arr = np.array(Image.open(fp).convert("RGB")).astype(np.float32) / 255.0
                        if hashlib.md5(arr.tobytes()[:4096]).hexdigest() == h:
                            return fp
                    except Exception:
                        continue
        except Exception:
            pass
        return None

    def _read_info(self, path):
        raw_prompt, raw_params = "", ""
        try:
            img = Image.open(path)
            for k, v in img.info.items():
                if isinstance(v, str):
                    if "prompt" in k.lower():
                        raw_prompt = v
                    elif "parameters" in k.lower():
                        raw_params = v
        except Exception:
            pass
        return raw_prompt, raw_params

    # ==================================================================

    def _parse_comfyui(self, raw):
        """Parse ComfyUI API prompt JSON with proper widget-index reference resolution."""
        try:
            data = json.loads(raw)
        except Exception:
            return None, None

        nodes = data.get("prompt", data)
        if not isinstance(nodes, dict) or not nodes:
            return None, None

        pos_texts, neg_texts = [], []

        for nid, ni in nodes.items():
            if not isinstance(ni, dict):
                continue
            ct = ni.get("class_type", "")
            if "CLIPTextEncode" not in ct and "PromptSegments" not in ct:
                continue

            text_ref = ni.get("inputs", {}).get("text", "")
            text = self._resolve_ref(text_ref, nodes, depth=0)

            # If the node is PromptSegments, extract from its segments JSON
            if "PromptSegments" in ct:
                segs_raw = ni.get("inputs", {}).get("segments", "")
                text = self._parse_prompt_segments(segs_raw)
                # Also check prompts_in chain for upstream text
                upstream = self._resolve_ref(ni.get("inputs", {}).get("prompts_in", ""), nodes, depth=0)
                if upstream and isinstance(upstream, str) and upstream.strip():
                    text = upstream.strip() + (", " + text if text else "")
            elif not isinstance(text, str) or not text.strip():
                continue

            # If resolved value looks like PromptSegments JSON, parse it
            if text.startswith("[{") and '"text"' in text:
                text = self._parse_prompt_segments(text)

            if not text.strip():
                continue

            title = ni.get("_meta", {}).get("title", "").lower()
            is_neg = any(kw in title for kw in ("negative", "neg", "负", "反面", "反向", "负面", "消极"))
            (neg_texts if is_neg else pos_texts).append(text.strip())

        # Deduplicate while preserving order
        seen_pos, seen_neg = set(), set()
        pos_texts = [t for t in pos_texts if not (t in seen_pos or seen_pos.add(t))]
        neg_texts = [t for t in neg_texts if not (t in seen_neg or seen_neg.add(t))]

        pos_texts = [t for t in pos_texts if t not in neg_texts]

        # If no keyword-based distinction was made, use convention:
        # first CLIPTextEncode = positive, second = negative
        if pos_texts and not neg_texts and len(pos_texts) >= 2:
            neg_texts = [pos_texts[-1]]
            pos_texts = pos_texts[:-1]

        if not pos_texts and not neg_texts:
            return None, None

        return (
            ",\n".join(pos_texts) if pos_texts else self._MISSING,
            ",\n".join(neg_texts) if neg_texts else "",
        )

    def _parse_prompt_segments(self, text):
        """Parse a PromptSegments JSON array → join enabled `.text` fields."""
        try:
            segments = json.loads(text)
            if not isinstance(segments, list):
                return text
            parts = []
            for seg in segments:
                if isinstance(seg, dict) and seg.get("enabled", True):
                    t = seg.get("text", "")
                    if t and isinstance(t, str):
                        parts.append(t.strip())
            return ", ".join(parts) if parts else text
        except Exception:
            return text

    def _resolve_ref(self, val, nodes, depth=0):
        """Resolve ComfyUI widget references like ["node_id", widget_idx]."""
        if depth > 10:
            return ""
        if isinstance(val, str):
            return val
        if isinstance(val, list) and len(val) == 2:
            ref_id = str(val[0])
            widget_idx = val[1]
            ref_node = nodes.get(ref_id, {})
            if not isinstance(ref_node, dict):
                return ""
            ref_inputs = ref_node.get("inputs", {})
            if not isinstance(ref_inputs, dict):
                return ""
            keys = list(ref_inputs.keys())
            if 0 <= widget_idx < len(keys):
                return self._resolve_ref(ref_inputs[keys[widget_idx]], nodes, depth + 1)
        return ""

    def _parse_webui(self, raw):
        """Parse A1111 'parameters' text: prompt\nNegative prompt: ...\nSteps: ..."""
        pos, neg = "", ""
        if "\nNegative prompt:" in raw:
            parts = raw.split("\nNegative prompt:", 1)
            pos = parts[0].strip()
            rest = parts[1]
            for m in ["\nSteps:", "\nSampler:", "\nSeed:"]:
                idx = rest.find(m)
                if idx != -1:
                    neg = rest[:idx].strip()
                    break
            if not neg:
                neg = rest.strip()
        else:
            for m in ["\nSteps:", "\nSampler:", "\nSeed:"]:
                idx = raw.find(m)
                if idx != -1:
                    pos = raw[:idx].strip()
                    break
            if not pos:
                pos = raw.strip()
        return (pos, neg)