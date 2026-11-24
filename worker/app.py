"""HTTP wrapper around a monitored Nerfstudio Splatfacto pipeline.

The worker streams reconstruction telemetry into each job resource so the web
app can explain both progress and capture quality. Jobs are persisted beside
their source data, which lets monitoring resume after a container restart.
"""

from __future__ import annotations

import json
import hmac
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from collections import deque
from dataclasses import asdict, dataclass, field, replace
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any, Callable, Literal

from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from worker.tracked_capture import triangulate_capture, unpack_capture


JobStatus = Literal["queued", "processing", "completed", "failed"]
QualityLevel = Literal["pending", "good", "warning", "poor"]
BuildMode = Literal["quick", "preview", "balanced", "high", "maximum"]
DATA_ROOT = Path(os.environ.get("MIRA_DATA_ROOT", "./reconstruction-data")).resolve()
TRAIN_STEPS = max(1_000, int(os.environ.get("MIRA_TRAIN_STEPS", "15000")))
QUICK_TRAIN_STEPS = max(1_000, int(os.environ.get("MIRA_QUICK_TRAIN_STEPS", "2500")))
PREVIEW_TRAIN_STEPS = max(1_000, int(os.environ.get("MIRA_PREVIEW_TRAIN_STEPS", "4000")))
BALANCED_TRAIN_STEPS = max(1_000, int(os.environ.get("MIRA_BALANCED_TRAIN_STEPS", "6500")))
MAXIMUM_TRAIN_STEPS = max(1_000, int(os.environ.get("MIRA_MAXIMUM_TRAIN_STEPS", "15000")))
MIN_CUSTOM_FRAMES = 60
MAX_CUSTOM_FRAMES = 1_200
MIN_CUSTOM_TRAIN_STEPS = 1_000
MAX_CUSTOM_TRAIN_STEPS = 15_000
CUSTOM_DOWNSCALE_FACTORS = {1, 2, 4, 8}
METRICS_POLL_SECONDS = max(1.0, min(60.0, float(os.environ.get("MIRA_METRICS_POLL_SECONDS", "5"))))
TRAIN_LOG_SAMPLES = max(30, min(300, int(os.environ.get("MIRA_TRAIN_LOG_SAMPLES", "100"))))
ALLOWED_EXTENSIONS = {".mp4", ".mov", ".m4v", ".webm", ".miracapture"}
GATEWAY_TOKEN = os.environ.get("MIRA_GATEWAY_TOKEN", "").strip()
ANSI_ESCAPE = re.compile(r"\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])")
TRAIN_STEP = re.compile(r"^\s*(\d+)\s+\((\d+(?:\.\d+)?)%\)")
DATA_ROOT.mkdir(parents=True, exist_ok=True)


def require_gateway(x_mira_worker_token: str | None = Header(default=None)) -> None:
    """Keep reconstruction behind the Express ownership and billing gateway."""
    if GATEWAY_TOKEN and (
        not x_mira_worker_token
        or not hmac.compare_digest(x_mira_worker_token, GATEWAY_TOKEN)
    ):
        raise HTTPException(status_code=401, detail="Reconstruction gateway token is invalid.")


@dataclass(frozen=True)
class BuildProfile:
    num_frames_target: int
    downscale_factor: int
    train_steps: int
    cache_images: Literal["cpu", "gpu"]
    refine_every: int
    stop_split_at: int
    num_downscales: int
    resolution_schedule: int
    sh_degree: int


BUILD_PROFILES: dict[BuildMode, BuildProfile] = {
    "quick": BuildProfile(
        num_frames_target=120,
        downscale_factor=4,
        train_steps=QUICK_TRAIN_STEPS,
        cache_images="gpu",
        refine_every=250,
        stop_split_at=max(500, min(QUICK_TRAIN_STEPS - 500, 1_500)),
        num_downscales=1,
        resolution_schedule=1_250,
        sh_degree=1,
    ),
    "preview": BuildProfile(
        num_frames_target=180,
        downscale_factor=4,
        train_steps=PREVIEW_TRAIN_STEPS,
        cache_images="gpu",
        refine_every=200,
        stop_split_at=max(500, min(PREVIEW_TRAIN_STEPS - 500, 2_400)),
        num_downscales=1,
        resolution_schedule=2_000,
        sh_degree=2,
    ),
    "balanced": BuildProfile(
        num_frames_target=240,
        downscale_factor=2,
        train_steps=BALANCED_TRAIN_STEPS,
        cache_images="gpu",
        refine_every=150,
        stop_split_at=max(500, min(BALANCED_TRAIN_STEPS - 500, 4_500)),
        num_downscales=2,
        resolution_schedule=2_500,
        sh_degree=3,
    ),
    "high": BuildProfile(
        num_frames_target=300,
        downscale_factor=2,
        train_steps=TRAIN_STEPS,
        cache_images="cpu",
        refine_every=100,
        stop_split_at=max(500, min(TRAIN_STEPS - 500, 7_500)),
        num_downscales=2,
        resolution_schedule=3_000,
        sh_degree=3,
    ),
    "maximum": BuildProfile(
        num_frames_target=400,
        downscale_factor=1,
        train_steps=MAXIMUM_TRAIN_STEPS,
        cache_images="cpu",
        refine_every=100,
        stop_split_at=max(500, min(MAXIMUM_TRAIN_STEPS - 500, 12_000)),
        num_downscales=2,
        resolution_schedule=4_000,
        sh_degree=3,
    ),
}


@dataclass
class MetricSample:
    iteration: int
    elapsed_seconds: int
    loss: float | None = None
    psnr: float | None = None
    gaussian_count: int | None = None
    gpu_memory_mb: float | None = None


@dataclass
class JobMetrics:
    input_frames: int | None = None
    registered_frames: int | None = None
    registration_rate: float | None = None
    available_registered_frames: int | None = None
    selected_model: str | None = None
    sparse_points: int | None = None
    reprojection_error_px: float | None = None
    colmap_models: list[dict[str, Any]] = field(default_factory=list)
    training_iteration: int = 0
    training_iterations: int = TRAIN_STEPS
    training_progress: float = 0.0
    train_loss: float | None = None
    psnr: float | None = None
    gaussian_count: int | None = None
    gpu_memory_mb: float | None = None
    elapsed_seconds: int = 0
    estimated_remaining_seconds: int | None = None
    quality_level: QualityLevel = "pending"
    quality_message: str = "Waiting for camera analysis"
    warnings: list[str] = field(default_factory=list)
    history: list[MetricSample] = field(default_factory=list)


@dataclass
class Job:
    id: str
    name: str
    location: str
    build_mode: BuildMode = "high"
    custom_tuning: bool = False
    live_preview: bool = False
    target_frames: int | None = None
    train_steps: int | None = None
    downscale_factor: int | None = None
    status: JobStatus = "queued"
    progress: int = 1
    stage: str = "Upload accepted"
    model_url: str | None = None
    model_filename: str | None = None
    splat_count: int | None = None
    error: str | None = None
    started_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    completed_at: float | None = None
    metrics: JobMetrics = field(default_factory=JobMetrics)


jobs: dict[str, Job] = {}
jobs_lock = threading.Lock()


def persist_job(job: Job) -> None:
    job_dir = DATA_ROOT / job.id
    if not job_dir.is_dir():
        return
    destination = job_dir / "job.json"
    temporary = job_dir / "job.json.tmp"
    temporary.write_text(json.dumps(asdict(job), indent=2), encoding="utf-8")
    temporary.replace(destination)


def update_job(job_id: str, **changes: object) -> None:
    with jobs_lock:
        job = jobs[job_id]
        for key, value in changes.items():
            setattr(job, key, value)
        job.updated_at = time.time()
        persist_job(job)


def update_metrics(job_id: str, *, sample: MetricSample | None = None, **changes: object) -> None:
    with jobs_lock:
        job = jobs[job_id]
        for key, value in changes.items():
            setattr(job.metrics, key, value)
        if sample is not None:
            job.metrics.history.append(sample)
            job.metrics.history = job.metrics.history[-90:]
        job.updated_at = time.time()
        persist_job(job)


def update_training_progress(
    job_id: str,
    progress: int,
    sample: MetricSample | None = None,
    **changes: object,
) -> None:
    """Persist one training update without writing job.json twice per log line."""
    with jobs_lock:
        job = jobs[job_id]
        for key, value in changes.items():
            setattr(job.metrics, key, value)
        if sample is not None:
            job.metrics.history.append(sample)
            job.metrics.history = job.metrics.history[-90:]
        job.progress = progress
        job.updated_at = time.time()
        persist_job(job)


def job_payload(job: Job) -> dict[str, object]:
    payload = asdict(job)
    end_time = job.completed_at or time.time()
    payload["metrics"]["elapsed_seconds"] = max(0, int(end_time - job.started_at))  # type: ignore[index]
    return payload


def run_command(
    command: list[str],
    cwd: Path,
    on_line: Callable[[str], None] | None = None,
) -> None:
    environment = os.environ.copy()
    environment.pop("FORCE_COLOR", None)
    environment.update({"NO_COLOR": "1", "PYTHONUNBUFFERED": "1", "TERM": "dumb", "COLUMNS": "240"})
    process = subprocess.Popen(
        command,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
        env=environment,
    )
    output_tail: deque[str] = deque(maxlen=160)
    assert process.stdout is not None
    for raw_line in process.stdout:
        clean_line = ANSI_ESCAPE.sub("", raw_line).strip()
        if not clean_line:
            continue
        output_tail.append(clean_line)
        if on_line is not None:
            on_line(clean_line)
    return_code = process.wait()
    if return_code != 0:
        raise RuntimeError("\n".join(output_tail)[-4_000:] or "Unknown pipeline error")


def read_ply_vertex_count(path: Path) -> int | None:
    try:
        with path.open("rb") as stream:
            header = stream.read(16_384).decode("ascii", errors="ignore")
        for line in header.splitlines():
            if line.startswith("element vertex "):
                return int(line.rsplit(" ", 1)[-1])
    except (OSError, ValueError):
        pass
    return None


def count_input_frames(processed_dir: Path) -> int:
    image_dir = processed_dir / "images"
    return sum(1 for path in image_dir.iterdir() if path.is_file()) if image_dir.is_dir() else 0


def inspect_colmap_models(processed_dir: Path) -> list[dict[str, Any]]:
    import pycolmap

    model_root = processed_dir / "colmap" / "sparse"
    models: list[dict[str, Any]] = []
    if not model_root.is_dir():
        return models
    for model_dir in sorted(model_root.iterdir(), key=lambda path: path.name):
        if not (model_dir / "cameras.bin").is_file():
            continue
        reconstruction = pycolmap.Reconstruction(str(model_dir))
        models.append(
            {
                "id": model_dir.name,
                "path": str(model_dir),
                "registered_frames": int(reconstruction.num_reg_images()),
                "sparse_points": int(reconstruction.num_points3D()),
                "reprojection_error_px": round(float(reconstruction.compute_mean_reprojection_error()), 4),
            }
        )
    return models


def capture_quality(
    input_frames: int,
    registered_frames: int,
    reprojection_error: float | None,
) -> tuple[QualityLevel, str, list[str]]:
    rate = registered_frames / input_frames if input_frames else 0.0
    warnings: list[str] = []
    if registered_frames < 30:
        warnings.append("Very few camera positions were reconstructed; the scene may collapse or produce spikes.")
    if rate < 0.65:
        warnings.append(f"Only {rate:.0%} of extracted frames aligned. Aim for at least 80%.")
    if reprojection_error is not None and reprojection_error > 2.0:
        warnings.append("Camera reprojection error is high; blur or inconsistent movement may be present.")
    if rate >= 0.85 and (reprojection_error is None or reprojection_error <= 1.5):
        return "good", "Camera coverage is strong and ready for training", warnings
    if rate >= 0.6 and (reprojection_error is None or reprojection_error <= 2.5):
        return "warning", "The capture is usable, but some areas may contain holes", warnings
    return "poor", "Camera alignment is too weak for a dependable scene", warnings


def analyse_capture(processed_dir: Path, *, select_best: bool) -> JobMetrics:
    input_frames = count_input_frames(processed_dir)
    models = inspect_colmap_models(processed_dir)
    if not models:
        raise RuntimeError("COLMAP produced no camera model.")

    best = max(models, key=lambda model: (model["registered_frames"], model["sparse_points"]))
    selected = best
    if not select_best:
        transforms_path = processed_dir / "transforms.json"
        used_frames = 0
        if transforms_path.is_file():
            used_frames = len(json.loads(transforms_path.read_text(encoding="utf-8")).get("frames", []))
        selected = next(
            (model for model in models if model["id"] == "0" and model["registered_frames"] == used_frames),
            next((model for model in models if model["registered_frames"] == used_frames), best),
        )
    elif best["id"] != "0":
        from nerfstudio.process_data.colmap_utils import colmap_to_json

        colmap_to_json(Path(best["path"]), processed_dir)

    registered_frames = int(selected["registered_frames"])
    reprojection_error = float(selected["reprojection_error_px"])
    quality_level, quality_message, warnings = capture_quality(
        input_frames, registered_frames, reprojection_error
    )
    available_registered_frames = int(best["registered_frames"])
    if not select_best and available_registered_frames > registered_frames:
        warnings.insert(
            0,
            f"A better COLMAP model aligned {available_registered_frames} frames, but this build used {registered_frames}.",
        )
        quality_level = "poor"
        quality_message = "This build trained on the wrong camera model"

    return JobMetrics(
        input_frames=input_frames,
        registered_frames=registered_frames,
        registration_rate=registered_frames / input_frames if input_frames else 0.0,
        available_registered_frames=available_registered_frames,
        selected_model=str(selected["id"]),
        sparse_points=int(selected["sparse_points"]),
        reprojection_error_px=reprojection_error,
        colmap_models=models,
        quality_level=quality_level,
        quality_message=quality_message,
        warnings=warnings,
    )


class IncrementalTensorboardReader:
    """Read only newly appended TensorBoard events and retain the latest scalars."""

    TAG_MAP = {
        "Train Loss": "loss",
        "Train Metrics Dict/psnr": "psnr",
        "Train Metrics Dict/gaussian_count": "gaussian_count",
        "GPU Memory (MB)": "gpu_memory_mb",
    }

    def __init__(self, output_dir: Path, poll_seconds: float = METRICS_POLL_SECONDS) -> None:
        self.output_dir = output_dir
        self.poll_seconds = poll_seconds
        self.values: dict[str, float] = {}
        self.latest_step = 0
        self.event_file: Path | None = None
        self.loader: Any | None = None
        self.lock = threading.Lock()
        self.stop_event = threading.Event()
        self.thread: threading.Thread | None = None
        self.reported_error = False

    @staticmethod
    def scalar_value(value: Any) -> float | None:
        if value.HasField("simple_value"):
            return float(value.simple_value)
        if value.HasField("tensor"):
            from tensorboard.util import tensor_util

            array = tensor_util.make_ndarray(value.tensor)
            if array.size:
                return float(array.reshape(-1)[-1])
        return None

    def poll(self) -> None:
        from tensorboard.backend.event_processing.event_file_loader import EventFileLoader

        event_files = sorted(
            self.output_dir.rglob("events.out.tfevents.*"),
            key=lambda path: path.stat().st_mtime,
        )
        if not event_files:
            return
        newest = event_files[-1]
        if newest != self.event_file:
            self.event_file = newest
            self.loader = EventFileLoader(str(newest))

        changes: dict[str, float] = {}
        latest_step = self.latest_step
        assert self.loader is not None
        for event in self.loader.Load():
            if not event.HasField("summary"):
                continue
            for value in event.summary.value:
                key = self.TAG_MAP.get(value.tag)
                if key is None:
                    continue
                scalar = self.scalar_value(value)
                if scalar is not None:
                    changes[key] = scalar
                    latest_step = max(latest_step, int(event.step))
        if changes:
            with self.lock:
                self.values.update(changes)
                self.latest_step = latest_step

    def snapshot(self) -> tuple[dict[str, float], int]:
        with self.lock:
            return dict(self.values), self.latest_step

    def run(self) -> None:
        while not self.stop_event.is_set():
            try:
                self.poll()
                self.reported_error = False
            except Exception as error:
                if not self.reported_error:
                    print(f"TensorBoard metrics reader warning: {error}", flush=True)
                    self.reported_error = True
            self.stop_event.wait(self.poll_seconds)

    def start(self) -> None:
        self.thread = threading.Thread(target=self.run, name="tensorboard-metrics", daemon=True)
        self.thread.start()

    def stop(self) -> tuple[dict[str, float], int]:
        self.stop_event.set()
        if self.thread is not None:
            self.thread.join(timeout=max(2.0, self.poll_seconds + 1.0))
        try:
            self.poll()
        except Exception as error:
            print(f"Final TensorBoard metrics read warning: {error}", flush=True)
        return self.snapshot()


def training_log_interval(training_steps: int) -> int:
    """Keep roughly the same number of progress updates for every quality package."""
    return max(10, (training_steps + TRAIN_LOG_SAMPLES - 1) // TRAIN_LOG_SAMPLES)


def training_line_handler(
    job_id: str,
    phase_started_at: float,
    training_steps: int,
    metrics_reader: IncrementalTensorboardReader,
) -> Callable[[str], None]:
    last_sample_iteration = -1
    history_interval = max(20, training_steps // 60)

    def handle(line: str) -> None:
        nonlocal last_sample_iteration
        match = TRAIN_STEP.match(line)
        if not match:
            return
        iteration = min(training_steps, int(match.group(1)))
        now = time.time()
        cached_values, _ = metrics_reader.snapshot()

        fraction = max(0.0001, iteration / training_steps)
        phase_elapsed = max(1, int(now - phase_started_at))
        remaining = max(0, int(phase_elapsed / fraction - phase_elapsed))
        changes: dict[str, object] = {
            "training_iteration": iteration,
            "training_progress": round(fraction * 100, 2),
            "estimated_remaining_seconds": remaining,
        }
        if "loss" in cached_values:
            changes["train_loss"] = cached_values["loss"]
        if "psnr" in cached_values:
            changes["psnr"] = cached_values["psnr"]
        if "gaussian_count" in cached_values:
            changes["gaussian_count"] = int(cached_values["gaussian_count"])
        if "gpu_memory_mb" in cached_values:
            changes["gpu_memory_mb"] = cached_values["gpu_memory_mb"]

        sample = None
        if iteration == 0 or iteration - last_sample_iteration >= history_interval:
            sample = MetricSample(
                iteration=iteration,
                elapsed_seconds=phase_elapsed,
                loss=cached_values.get("loss"),
                psnr=cached_values.get("psnr"),
                gaussian_count=int(cached_values["gaussian_count"])
                if "gaussian_count" in cached_values
                else None,
                gpu_memory_mb=cached_values.get("gpu_memory_mb"),
            )
            last_sample_iteration = iteration
        update_training_progress(
            job_id,
            progress=min(90, 38 + int(52 * fraction)),
            sample=sample,
            **changes,
        )

    return handle


def effective_profile(job: Job) -> BuildProfile:
    profile = BUILD_PROFILES[job.build_mode]
    if not job.custom_tuning:
        return profile
    custom_steps = job.train_steps or profile.train_steps
    return replace(
        profile,
        num_frames_target=job.target_frames or profile.num_frames_target,
        train_steps=custom_steps,
        downscale_factor=job.downscale_factor or profile.downscale_factor,
        stop_split_at=max(500, min(custom_steps - 500, profile.stop_split_at)),
        resolution_schedule=max(500, min(custom_steps, profile.resolution_schedule)),
    )


def latest_checkpoint_step(output_dir: Path) -> int | None:
    steps: list[int] = []
    for checkpoint in output_dir.rglob("step-*.ckpt"):
        match = re.search(r"step-(\d+)\.ckpt$", checkpoint.name)
        if match:
            steps.append(int(match.group(1)))
    return max(steps) if steps else None


def export_trained_scene(job_id: str, job_dir: Path) -> None:
    output_dir = job_dir / "training"
    export_dir = job_dir / "export"
    configs = sorted(output_dir.rglob("config.yml"), key=lambda item: item.stat().st_mtime)
    if not configs:
        raise RuntimeError("Training completed but no Nerfstudio config.yml was produced.")

    with jobs_lock:
        job = jobs[job_id]
        training_steps = effective_profile(job).train_steps
    update_metrics(
        job_id,
        training_iteration=training_steps,
        training_progress=100.0,
        estimated_remaining_seconds=0,
    )
    update_job(job_id, status="processing", progress=94, stage="Optimizing for the web", error=None)
    export_dir.mkdir(parents=True, exist_ok=True)
    run_command(
        [
            "ns-export",
            "gaussian-splat",
            "--load-config",
            str(configs[-1]),
            "--output-dir",
            str(export_dir),
        ],
        job_dir,
    )

    candidates = sorted(export_dir.glob("*.ply"), key=lambda item: item.stat().st_mtime)
    if not candidates:
        raise RuntimeError("Export completed but no Gaussian-splat PLY was produced.")
    model_path = candidates[-1]
    final_path = job_dir / "scene.ply"
    shutil.move(str(model_path), str(final_path))
    splat_count = read_ply_vertex_count(final_path)
    update_metrics(job_id, gaussian_count=splat_count or jobs[job_id].metrics.gaussian_count)
    update_job(
        job_id,
        status="completed",
        progress=100,
        stage="Ready to explore",
        model_url=f"/v1/reconstructions/{job_id}/model",
        model_filename="scene.ply",
        splat_count=splat_count,
        completed_at=time.time(),
    )


def recover_completed_training(job_id: str) -> None:
    job_dir = DATA_ROOT / job_id
    try:
        export_trained_scene(job_id, job_dir)
    except Exception as error:
        update_job(
            job_id,
            status="failed",
            error=f"Checkpoint recovery export failed: {error}",
            stage="Build failed",
            completed_at=time.time(),
        )


def run_pipeline(job_id: str, video_path: Path) -> None:
    job_dir = video_path.parent
    processed_dir = job_dir / "processed"
    output_dir = job_dir / "training"
    with jobs_lock:
        job = jobs[job_id]
        profile = effective_profile(job)
    try:
        update_job(job_id, status="processing", progress=12, stage="Finding camera positions")
        if video_path.suffix == ".miracapture":
            with TemporaryDirectory(dir=job_dir) as directory:
                root = Path(directory)
                images = root / "frames"
                prepared = root / "prepared"
                width, height, frames = unpack_capture(video_path, images, profile.num_frames_target)
                update_job(job_id, stage="Triangulating tracked camera frames")
                try:
                    triangulate_capture(images, prepared, width, height, frames, profile.downscale_factor, run_command)
                except Exception as error:
                    print(f"Tracked reconstruction for {job_id} fell back to image alignment: {error}", flush=True)
                    update_job(job_id, stage="Refining camera alignment from images")
                    run_command(
                        ["ns-process-data", "images", "--data", str(images), "--output-dir", str(processed_dir)],
                        job_dir,
                    )
                else:
                    prepared.rename(processed_dir)
        else:
            run_command(
                [
                    "ns-process-data",
                    "video",
                    "--data",
                    str(video_path),
                    "--output-dir",
                    str(processed_dir),
                    "--num-frames-target",
                    str(profile.num_frames_target),
                ],
                job_dir,
            )

        metrics = analyse_capture(processed_dir, select_best=True)
        metrics.training_iterations = profile.train_steps
        update_job(job_id, metrics=metrics, progress=36, stage="Camera analysis complete")
        minimum_registered = max(12, int((metrics.input_frames or 0) * 0.25))
        if (metrics.registered_frames or 0) < minimum_registered:
            raise RuntimeError(
                f"Only {metrics.registered_frames or 0} of {metrics.input_frames or 0} frames aligned. "
                "Capture more overlap and reduce motion blur before training."
            )

        update_job(job_id, progress=38, stage="Training Gaussian scene")
        training_started_at = time.time()
        metrics_reader = IncrementalTensorboardReader(output_dir)
        metrics_reader.start()
        try:
            run_command(
                [
                    *([sys.executable, str(Path(__file__).with_name('train_preview.py').resolve())] if job.live_preview else ["ns-train"]),
                    "splatfacto",
                    "--output-dir",
                    str(output_dir),
                    "--max-num-iterations",
                    str(profile.train_steps),
                    "--vis",
                    "tensorboard",
                    "--logging.steps-per-log",
                    str(training_log_interval(profile.train_steps)),
                    "--logging.local-writer.max-log-size",
                    "0",
                    "--logging.profiler",
                    "none",
                    "--pipeline.datamanager.cache-images",
                    profile.cache_images,
                    "--pipeline.model.refine-every",
                    str(profile.refine_every),
                    "--pipeline.model.stop-split-at",
                    str(profile.stop_split_at),
                    "--pipeline.model.num-downscales",
                    str(profile.num_downscales),
                    "--pipeline.model.resolution-schedule",
                    str(profile.resolution_schedule),
                    "--pipeline.model.sh-degree",
                    str(profile.sh_degree),
                    "--pipeline.model.use-scale-regularization",
                    "True",
                    "nerfstudio-data",
                    "--data",
                    str(processed_dir),
                    "--downscale-factor",
                    str(profile.downscale_factor),
                ],
                job_dir,
                on_line=training_line_handler(
                    job_id,
                    training_started_at,
                    profile.train_steps,
                    metrics_reader,
                ),
            )
        finally:
            final_values, _ = metrics_reader.stop()

        try:
            update_metrics(
                job_id,
                training_iteration=profile.train_steps,
                training_progress=100.0,
                train_loss=final_values.get("loss", jobs[job_id].metrics.train_loss),
                psnr=final_values.get("psnr", jobs[job_id].metrics.psnr),
                gaussian_count=int(final_values["gaussian_count"])
                if "gaussian_count" in final_values
                else jobs[job_id].metrics.gaussian_count,
                gpu_memory_mb=final_values.get("gpu_memory_mb", jobs[job_id].metrics.gpu_memory_mb),
                estimated_remaining_seconds=0,
            )
        except Exception:
            update_metrics(
                job_id,
                training_iteration=profile.train_steps,
                training_progress=100.0,
                estimated_remaining_seconds=0,
            )

        export_trained_scene(job_id, job_dir)
    except Exception as error:
        update_job(
            job_id,
            status="failed",
            error=str(error),
            stage="Build failed",
            completed_at=time.time(),
        )


def load_persisted_jobs() -> list[str]:
    recovery_jobs: list[str] = []
    for job_dir in DATA_ROOT.iterdir():
        if not job_dir.is_dir():
            continue
        metadata_path = job_dir / "job.json"
        if metadata_path.is_file():
            try:
                raw = json.loads(metadata_path.read_text(encoding="utf-8"))
                raw_metrics = raw.pop("metrics", {})
                raw_metrics["history"] = [MetricSample(**sample) for sample in raw_metrics.get("history", [])]
                job = Job(**raw, metrics=JobMetrics(**raw_metrics))
                if job.status in {"queued", "processing"}:
                    scene_path = job_dir / "scene.ply"
                    expected_steps = effective_profile(job).train_steps
                    checkpoint_step = latest_checkpoint_step(job_dir / "training")
                    if scene_path.is_file():
                        job.status = "completed"
                        job.progress = 100
                        job.stage = "Ready to explore"
                        job.model_url = f"/v1/reconstructions/{job.id}/model"
                        job.model_filename = "scene.ply"
                        job.splat_count = read_ply_vertex_count(scene_path)
                        job.completed_at = scene_path.stat().st_mtime
                        job.metrics.training_iteration = expected_steps
                        job.metrics.training_progress = 100.0
                        job.metrics.estimated_remaining_seconds = 0
                    elif checkpoint_step is not None and checkpoint_step >= expected_steps - 1:
                        job.status = "processing"
                        job.progress = 94
                        job.stage = "Recovering completed training"
                        job.error = None
                        job.completed_at = None
                        job.metrics.training_iteration = expected_steps
                        job.metrics.training_progress = 100.0
                        job.metrics.estimated_remaining_seconds = 0
                        recovery_jobs.append(job.id)
                    else:
                        job.status = "failed"
                        job.stage = "Build interrupted"
                        job.error = "The reconstruction worker restarted before this build completed."
                        job.completed_at = time.time()
                jobs[job.id] = job
                persist_job(job)
                continue
            except (OSError, TypeError, ValueError, json.JSONDecodeError):
                pass

        scene_path = job_dir / "scene.ply"
        processed_dir = job_dir / "processed"
        if not scene_path.is_file():
            continue
        try:
            metrics = analyse_capture(processed_dir, select_best=False)
        except Exception:
            metrics = JobMetrics(
                quality_level="warning",
                quality_message="This older build has limited diagnostic data",
            )
        job = Job(
            id=job_dir.name,
            name="Recovered reconstruction",
            location="",
            status="completed",
            progress=100,
            stage="Ready to explore",
            model_url=f"/v1/reconstructions/{job_dir.name}/model",
            model_filename="scene.ply",
            splat_count=read_ply_vertex_count(scene_path),
            completed_at=scene_path.stat().st_mtime,
            metrics=metrics,
        )
        jobs[job.id] = job
        persist_job(job)
    return recovery_jobs


jobs_to_recover = load_persisted_jobs()
for recovery_job_id in jobs_to_recover:
    threading.Thread(
        target=recover_completed_training,
        args=(recovery_job_id,),
        name=f"recover-{recovery_job_id[:8]}",
        daemon=True,
    ).start()

app = FastAPI(title="Mira Reconstruction API", version="1.1.0")
beta_directory = Path(__file__).with_name('beta-dist')
if beta_directory.is_dir():
    app.mount('/beta', StaticFiles(directory=beta_directory, html=True), name='beta')
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.environ.get(
            "MIRA_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
        ).split(",")
        if origin.strip()
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "status": "ok",
        "jobs": len(jobs),
        "live_preview": {"enabled": True, "every_steps": 250, "min_seconds": 15, "max_splats": 200_000},
        "build_modes": {name: asdict(profile) for name, profile in BUILD_PROFILES.items()},
        "advanced_tuning": {
            "min_target_frames": MIN_CUSTOM_FRAMES,
            "max_target_frames": MAX_CUSTOM_FRAMES,
            "min_train_steps": MIN_CUSTOM_TRAIN_STEPS,
            "max_train_steps": MAX_CUSTOM_TRAIN_STEPS,
            "downscale_factors": sorted(CUSTOM_DOWNSCALE_FACTORS),
        },
        "metrics": {
            "tensorboard_reader": "incremental",
            "poll_seconds": METRICS_POLL_SECONDS,
            "target_log_samples": TRAIN_LOG_SAMPLES,
            "steps_per_log": {
                name: training_log_interval(profile.train_steps)
                for name, profile in BUILD_PROFILES.items()
            },
        },
    }


@app.post("/v1/reconstructions", status_code=202)
async def create_reconstruction(
    background_tasks: BackgroundTasks,
    video: UploadFile = File(...),
    name: str = Form("Untitled space"),
    location: str = Form(""),
    build_mode: BuildMode = Form("high"),
    target_frames: int | None = Form(None),
    train_steps: int | None = Form(None),
    downscale_factor: int | None = Form(None),
    live_preview: bool = Form(False),
    _gateway: None = Depends(require_gateway),
) -> dict[str, object]:
    extension = Path(video.filename or "").suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail="Upload a supported video or MIRA tracked capture.")

    tuning_values = (target_frames, train_steps, downscale_factor)
    custom_tuning = any(value is not None for value in tuning_values)
    if custom_tuning and not all(value is not None for value in tuning_values):
        raise HTTPException(status_code=422, detail="All advanced tuning values are required together.")
    if custom_tuning:
        if build_mode != "maximum":
            raise HTTPException(status_code=422, detail="Advanced tuning requires the Maximum build tier.")
        if not MIN_CUSTOM_FRAMES <= (target_frames or 0) <= MAX_CUSTOM_FRAMES:
            raise HTTPException(status_code=422, detail="Target frames must be between 60 and 1,200.")
        if not MIN_CUSTOM_TRAIN_STEPS <= (train_steps or 0) <= MAX_CUSTOM_TRAIN_STEPS:
            raise HTTPException(status_code=422, detail="Training steps must be between 1,000 and 15,000.")
        if downscale_factor not in CUSTOM_DOWNSCALE_FACTORS:
            raise HTTPException(status_code=422, detail="Downscale must be 1, 2, 4, or 8.")

    job_id = uuid.uuid4().hex
    job_dir = DATA_ROOT / job_id
    job_dir.mkdir(parents=True, exist_ok=False)
    video_path = job_dir / f"walkthrough{extension}"
    with video_path.open("wb") as destination:
        while chunk := await video.read(1024 * 1024):
            destination.write(chunk)
    await video.close()

    profile = BUILD_PROFILES[build_mode]
    effective_train_steps = train_steps if custom_tuning and train_steps is not None else profile.train_steps
    job = Job(
        id=job_id,
        name=name[:80],
        location=location[:120],
        build_mode=build_mode,
        custom_tuning=custom_tuning,
        live_preview=live_preview,
        target_frames=target_frames if custom_tuning else None,
        train_steps=train_steps if custom_tuning else None,
        downscale_factor=downscale_factor if custom_tuning else None,
        progress=8,
        metrics=JobMetrics(training_iterations=effective_train_steps),
    )
    with jobs_lock:
        jobs[job_id] = job
        persist_job(job)
    background_tasks.add_task(run_pipeline, job_id, video_path)
    return job_payload(job)


@app.get('/v1/reconstructions')
def list_reconstructions(_gateway: None = Depends(require_gateway)) -> dict[str, object]:
    with jobs_lock:
        return {'jobs': [job_payload(job) for job in sorted(jobs.values(), key=lambda job: job.started_at, reverse=True)[:100]]}


def job_directory(job_id: str) -> Path:
    if not re.fullmatch(r'[a-f0-9]{32}', job_id):
        raise HTTPException(status_code=404, detail='Reconstruction not found.')
    with jobs_lock:
        if job_id not in jobs:
            raise HTTPException(status_code=404, detail='Reconstruction not found.')
    return DATA_ROOT / job_id


@app.get('/v1/reconstructions/{job_id}/preview')
def preview_status(job_id: str, _gateway: None = Depends(require_gateway)) -> dict[str, object]:
    directory = job_directory(job_id)
    metadata = directory / 'preview' / 'latest.json'
    if not metadata.is_file():
        return {'available': False}
    latest = json.loads(metadata.read_text(encoding='utf-8'))
    return {'available': 'filename' in latest, **latest}


@app.get('/v1/reconstructions/{job_id}/preview/{revision}')
def preview_model(job_id: str, revision: int, _gateway: None = Depends(require_gateway)) -> FileResponse:
    directory = job_directory(job_id)
    path = directory / 'preview' / f'step-{revision:09d}.splat'
    if not path.is_file():
        raise HTTPException(status_code=404, detail='Preview revision expired; refresh for the latest snapshot.')
    return FileResponse(path, media_type='application/octet-stream', headers={'Cache-Control': 'private, no-store'})


@app.get("/v1/reconstructions/{job_id}")
def get_reconstruction(
    job_id: str, _gateway: None = Depends(require_gateway)
) -> dict[str, object]:
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Reconstruction not found.")
        return job_payload(job)


@app.get("/v1/reconstructions/{job_id}/model")
def get_model(job_id: str, _gateway: None = Depends(require_gateway)) -> FileResponse:
    model_path = job_directory(job_id) / "scene.ply"
    if not model_path.is_file():
        raise HTTPException(status_code=404, detail="Model is not ready.")
    return FileResponse(model_path, media_type="application/octet-stream", filename="scene.ply")
