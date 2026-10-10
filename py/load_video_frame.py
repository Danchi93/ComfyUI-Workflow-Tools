"""
VideoFrameExtractor - pick a single frame from a video and export it as an image.

Part of ComfyUI-Workflow-Tools.

The node is self-contained: choose a video (dropdown from the ComfyUI input
folder, an upload, or an absolute path), grab the frame at the requested index,
output it as an IMAGE and save a PNG copy into ComfyUI's output directory.

Two small HTTP routes are registered for the timeline UI (js/load_video_frame.js):
    GET /workflow_tools/video_info?video=<name>&path=<abs path>
        -> { ok, fps, duration, total_frames, exact_frames, width, height }
    GET /workflow_tools/video_file?video=<name>&path=<abs path>
        -> the raw video file, used by the <video> preview element.
"""

import os
import time

import av
import numpy as np
import torch
from PIL import Image
from aiohttp import web
import folder_paths
from server import PromptServer


VIDEO_EXTENSIONS = (
    ".mp4", ".webm", ".mkv", ".avi", ".mov", ".m4v", ".flv", ".wmv",
    ".mpg", ".mpeg", ".ts", ".m2ts", ".gif",
)

PLACEHOLDER_NO_FILES = "no video files in input folder"


# ---------------------------------------------------------------------------
# Path helpers
# ---------------------------------------------------------------------------

def _list_input_videos():
    """Video files sitting in the ComfyUI input directory (for the combo widget)."""
    input_dir = folder_paths.get_input_directory()
    files = []
    try:
        for name in os.listdir(input_dir):
            full_path = os.path.join(input_dir, name)
            if os.path.isfile(full_path) and name.lower().endswith(VIDEO_EXTENSIONS):
                files.append(name)
    except FileNotFoundError:
        pass
    return sorted(files)


def _resolve_video_path(video_name, video_path):
    """Resolve to an absolute file path.

    An explicit absolute path (video_path) wins over the dropdown name. The
    dropdown value may itself be an absolute path (desktop drag & drop) or a
    file located in the ComfyUI input folder.
    """
    candidates = []

    explicit = (video_path or "").strip().strip('"').strip("'")
    if explicit:
        candidates.append(explicit)

    name = (video_name or "").strip()
    if name and name != PLACEHOLDER_NO_FILES:
        candidates.append(name)
        try:
            annotated = folder_paths.get_annotated_filepath(name)
            if annotated:
                candidates.append(annotated)
        except Exception:
            pass
        candidates.append(os.path.join(folder_paths.get_input_directory(), name))

    for candidate in candidates:
        if candidate and os.path.isfile(candidate):
            return os.path.abspath(candidate)

    raise FileNotFoundError(
        "Video file not found. Looked at: " + " | ".join(repr(c) for c in candidates if c)
    )


def _safe_upload_name(name):
    """Sanitize an uploaded file name (strip path parts and forbidden chars)."""
    name = os.path.basename((name or "").replace("\\", "/")).strip()
    name = name.lstrip(".").strip()
    for ch in '<>:"|?*':
        name = name.replace(ch, "_")
    return name


# ---------------------------------------------------------------------------
# Video probing / frame extraction (PyAV)
# ---------------------------------------------------------------------------

def _fps_of(stream):
    for attr in ("average_rate", "base_rate", "guessed_rate"):
        rate = getattr(stream, attr, None)
        if rate:
            try:
                value = float(rate)
                if value > 0:
                    return value
            except (TypeError, ValueError):
                pass
    return 24.0


def _duration_of(container, stream):
    if stream.duration is not None and stream.time_base is not None:
        try:
            return float(stream.duration * stream.time_base)
        except (TypeError, ValueError, ZeroDivisionError):
            pass
    if container.duration is not None:
        try:
            return float(container.duration / av.time_base)
        except (TypeError, ValueError, ZeroDivisionError):
            pass
    return 0.0


def _probe_video(path):
    """Return fps / duration / frame count / size for the timeline UI."""
    container = av.open(path)
    try:
        if not container.streams.video:
            raise ValueError("The file has no video stream: %s" % path)
        stream = container.streams.video[0]
        fps = _fps_of(stream)
        duration = max(0.0, _duration_of(container, stream))

        total = int(stream.frames) if stream.frames else 0
        exact = total > 0
        if total <= 0 and duration > 0:
            total = int(round(duration * fps))

        return {
            "ok": True,
            "filename": os.path.basename(path),
            "fps": fps,
            "duration": duration,
            "total_frames": max(0, total),
            "exact_frames": bool(exact and total > 0),
            "width": int(stream.codec_context.width or 0),
            "height": int(stream.codec_context.height or 0),
        }
    finally:
        container.close()


def extract_frame(path, frame_index):
    """Decode the frame at `frame_index` (0-based) and return an RGB uint8 array.

    Seeks to the keyframe before the target time, then decodes forward until the
    first frame whose presentation time reaches the target. When the index is
    past the end of the video the last decoded frame is returned instead.
    """
    frame_index = max(0, int(frame_index))
    container = av.open(path)
    try:
        if not container.streams.video:
            raise ValueError("The file has no video stream: %s" % path)
        stream = container.streams.video[0]
        fps = _fps_of(stream)
        target_time = frame_index / fps

        if stream.time_base is not None:
            seek_pts = int(target_time / float(stream.time_base))
        else:
            seek_pts = int(target_time * av.time_base)
        container.seek(seek_pts, stream=stream, backward=True)

        last_frame = None
        for frame in container.decode(stream):
            last_frame = frame
            frame_time = frame.time
            if frame_time is None:
                if frame.pts is not None and stream.time_base is not None:
                    frame_time = float(frame.pts * float(stream.time_base))
                else:
                    frame_time = 0.0
            if frame_time >= target_time - 1e-6:
                return frame.to_ndarray(format="rgb24")

        # Requested frame is beyond the end of the video: fall back to the last one.
        if last_frame is not None:
            return last_frame.to_ndarray(format="rgb24")
        return None
    finally:
        container.close()


# ---------------------------------------------------------------------------
# HTTP routes used by the node UI (timeline preview)
# ---------------------------------------------------------------------------

def _query_video(request):
    return _resolve_video_path(request.query.get("video", ""), request.query.get("path", ""))


@PromptServer.instance.routes.get("/workflow_tools/video_info")
async def workflow_tools_video_info(request):
    try:
        payload = _probe_video(_query_video(request))
    except Exception as exc:
        payload = {"ok": False, "error": str(exc)}
    return web.json_response(payload)


@PromptServer.instance.routes.get("/workflow_tools/video_file")
async def workflow_tools_video_file(request):
    try:
        path = _query_video(request)
    except FileNotFoundError as exc:
        return web.Response(status=404, text=str(exc))
    if not path.lower().endswith(VIDEO_EXTENSIONS):
        return web.Response(status=403, text="Only video files are served here.")
    return web.FileResponse(path)


@PromptServer.instance.routes.get("/workflow_tools/check_file")
async def workflow_tools_check_file(request):
    """Deduplicate uploads: report whether the same file already exists.

    Same name + same size -> reuse it. Same name + different size -> suggest a
    timestamped name so an existing file is never overwritten by accident.
    """
    filename = _safe_upload_name(request.query.get("filename", ""))
    try:
        size = int(request.query.get("size", "0") or 0)
    except (TypeError, ValueError):
        size = 0
    if not filename:
        return web.json_response({"exists": False, "name": ""})

    path = os.path.join(folder_paths.get_input_directory(), filename)
    if os.path.isfile(path):
        if size <= 0 or os.path.getsize(path) == size:
            return web.json_response({"exists": True, "name": filename})
        stem, ext = os.path.splitext(filename)
        return web.json_response({
            "exists": False,
            "name": "%s_%d%s" % (stem, int(time.time()), ext),
        })
    return web.json_response({"exists": False, "name": filename})


@PromptServer.instance.routes.post("/workflow_tools/upload_chunk")
async def workflow_tools_upload_chunk(request):
    """Chunked upload straight into the ComfyUI input folder.

    Bypasses the request body limit of /upload/image (~100MB), so videos of any
    size can be uploaded from the node UI (20MB per chunk from the frontend).
    """
    post = await request.post()
    file_field = post.get("file")
    filename = _safe_upload_name(post.get("filename", ""))
    try:
        chunk_index = int(post.get("chunk_index", "0"))
        total_chunks = int(post.get("total_chunks", "1"))
    except (TypeError, ValueError):
        return web.Response(status=400, text="Invalid chunk parameters")

    if not filename or file_field is None or not hasattr(file_field, "file"):
        return web.Response(status=400, text="Missing file or filename")
    if not filename.lower().endswith(VIDEO_EXTENSIONS):
        return web.Response(status=400, text="Only video files can be uploaded here")

    upload_dir = folder_paths.get_input_directory()
    os.makedirs(upload_dir, exist_ok=True)
    file_path = os.path.join(upload_dir, filename)
    mode = "ab" if chunk_index > 0 else "wb"
    with open(file_path, mode) as handle:
        handle.write(file_field.file.read())

    if chunk_index == total_chunks - 1:
        return web.json_response({"name": filename})
    return web.json_response({"status": "ok"})


# ---------------------------------------------------------------------------
# Node
# ---------------------------------------------------------------------------

class VideoFrameExtractor:
    """Load a video and export a single frame as an image.

    Pick the video, set the frame index (type it or drag the timeline in the
    node), run the workflow: the frame is output as IMAGE and saved as PNG in
    ComfyUI's output folder at the same time.
    """

    @classmethod
    def INPUT_TYPES(cls):
        files = _list_input_videos() or [PLACEHOLDER_NO_FILES]
        return {
            "required": {
                "video": (files, {
                    "tooltip": "Videos found in the ComfyUI input folder. "
                               "Use the button on the node to upload a new one.",
                }),
                "frame_index": ("INT", {
                    "default": 0, "min": 0, "max": 2147483647, "step": 1,
                    "tooltip": "0-based frame number. Drag the timeline to pick a frame visually.",
                }),
                "filename_prefix": ("STRING", {
                    "default": "frame_extract",
                    "tooltip": "Prefix of the PNG file saved into the output folder.",
                }),
            },
            "optional": {
                "video_path": ("STRING", {
                    "default": "",
                    "tooltip": "Optional absolute path to a video file. Takes priority over the dropdown when set.",
                }),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "extract"
    CATEGORY = "video"
    OUTPUT_NODE = True
    SEARCH_ALIASES = [
        "extract frame", "video frame", "frame export", "save frame",
        "视频抽帧", "提取帧", "导出帧", "保存帧", "工作流工具",
    ]

    def extract(self, video, frame_index, filename_prefix, video_path=""):
        path = _resolve_video_path(video, video_path)
        rgb = extract_frame(path, frame_index)
        if rgb is None:
            raise RuntimeError("No frame could be decoded from: %s" % path)

        image = torch.from_numpy(np.ascontiguousarray(rgb)).float().div_(255.0).unsqueeze(0)
        saved = self._save_png(image, filename_prefix)
        print("[VideoFrameExtractor] %s | frame %d -> %s" % (
            os.path.basename(path), int(frame_index), saved[0]["filename"]))
        return {"ui": {"images": saved}, "result": (image,)}

    @classmethod
    def VALIDATE_INPUTS(cls, **kwargs):
        try:
            _resolve_video_path(kwargs.get("video"), kwargs.get("video_path", ""))
        except FileNotFoundError as exc:
            return str(exc)
        return True

    @staticmethod
    def _save_png(image, filename_prefix):
        prefix = (filename_prefix or "").strip() or "frame_extract"
        full_output_folder, filename, counter, subfolder, _ = folder_paths.get_save_image_path(
            prefix, folder_paths.get_output_directory(), image.shape[2], image.shape[1]
        )
        file_name = "%s_%05d_.png" % (filename, counter)
        array = np.clip(image[0].cpu().numpy() * 255.0, 0, 255).astype(np.uint8)
        Image.fromarray(array).save(os.path.join(full_output_folder, file_name), compress_level=4)
        return [{"filename": file_name, "subfolder": subfolder, "type": "output"}]
