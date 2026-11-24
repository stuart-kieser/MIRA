"""Triangulate a sparse model using a .miracapture file's supplied poses.

MIRACAP1 files contain an eight-byte signature, a little-endian uint32 JSON
length, UTF-8 camera metadata, and JPEG frames concatenated in metadata order.
The rotation and translation are COLMAP world-to-camera coordinates.
"""

from __future__ import annotations

import json
import math
import shutil
import sqlite3
import struct
from contextlib import closing
from pathlib import Path
from typing import Callable

from PIL import Image


def unpack_capture(path: Path, output: Path, frame_limit: int) -> tuple[int, int, dict[str, dict]]:
    output.mkdir()
    with path.open("rb") as source:
        header = source.read(12)
        if len(header) != 12 or header[:8] != b"MIRACAP1":
            raise ValueError("Invalid MIRA capture header.")
        length = int.from_bytes(header[8:], "little")
        if not 1 <= length <= 1024**2:
            raise ValueError("Invalid MIRA capture metadata size.")
        metadata = json.loads(source.read(length))
        width, height = metadata["width"], metadata["height"]
        frames = metadata["frames"]
        if (type(width) is not int or type(height) is not int
                or not (1 <= width <= 4096 and 1 <= height <= 4096)
                or not isinstance(frames, list) or not 12 <= len(frames) <= 1200):
            raise ValueError("Invalid MIRA capture dimensions or frame count.")

        sizes = [frame["bytes"] for frame in frames]
        if (any(type(size) is not int or not 4 <= size <= 8 * 1024**2 for size in sizes)
                or sum(sizes) != path.stat().st_size - 12 - length):
            raise ValueError("Invalid MIRA capture frame sizes.")

        sample_count = min(len(frames), max(12, frame_limit))
        selected = {round(index * (len(frames) - 1) / (sample_count - 1)) for index in range(sample_count)}
        selected_frames = {}
        for index, (frame, size) in enumerate(zip(frames, sizes)):
            if index not in selected:
                source.seek(size, 1)
                continue
            for field, dimension in (("intrinsics", 4), ("rotation", 4), ("translation", 3)):
                values = frame[field]
                if (not isinstance(values, list) or len(values) != dimension
                        or any(type(value) not in (int, float) or not math.isfinite(value) for value in values)):
                    raise ValueError("Invalid MIRA capture camera parameters.")
            fx, fy, cx, cy = frame["intrinsics"]
            if not (0 < fx <= width * 10 and 0 < fy <= height * 10 and 0 <= cx <= width and 0 <= cy <= height):
                raise ValueError("Invalid MIRA capture camera calibration.")
            if abs(math.hypot(*frame["rotation"]) - 1) >= 0.01:
                raise ValueError("Invalid MIRA capture camera rotation.")

            name = f"frame_{index:05d}.jpg"
            image_path = output / name
            image_path.write_bytes(source.read(size))
            with Image.open(image_path, formats=["JPEG"]) as image:
                if image.size != (width, height) or image.getexif().get(274, 1) != 1:
                    raise ValueError("A tracked frame has inconsistent camera dimensions or orientation.")
                image.verify()
            selected_frames[name] = frame
    return width, height, selected_frames


def triangulate_capture(
    images: Path,
    prepared: Path,
    width: int,
    height: int,
    frames: dict[str, dict],
    downscale: int,
    run: Callable[[list[str], Path], None],
) -> None:
    import pycolmap
    from nerfstudio.process_data.colmap_utils import colmap_to_json

    database = prepared / "database.db"
    seed = prepared / "tracked"
    model = prepared / "colmap" / "sparse" / "0"
    seed.mkdir(parents=True)
    model.mkdir(parents=True)
    database_args = ["--database_path", str(database)]
    image_args = ["--image_path", str(images)]
    run(["colmap", "feature_extractor", *database_args, *image_args,
         "--ImageReader.camera_model", "PINHOLE", "--ImageReader.single_camera_per_image", "1"], prepared)

    with closing(sqlite3.connect(database)) as db, db:
        rows = db.execute("SELECT image_id, name, camera_id FROM images ORDER BY name").fetchall()
        if len(rows) != len(frames) or len({row[2] for row in rows}) != len(rows):
            raise RuntimeError("COLMAP did not load a camera for each tracked frame.")
        cameras = []
        poses = []
        for image_id, name, camera_id in rows:
            frame = frames[name]
            intrinsics = frame["intrinsics"]
            db.execute("UPDATE cameras SET params = ?, prior_focal_length = 1 WHERE camera_id = ?",
                       (struct.pack("<4d", *intrinsics), camera_id))
            calibration = " ".join(map(str, intrinsics))
            extrinsics = " ".join(map(str, frame["rotation"] + frame["translation"]))
            cameras.append(f"{camera_id} PINHOLE {width} {height} {calibration}\n")
            poses.append(f"{image_id} {extrinsics} {camera_id} {name}\n\n")

    (seed / "cameras.txt").write_text("".join(cameras), encoding="utf-8")
    (seed / "images.txt").write_text("".join(poses), encoding="utf-8")
    (seed / "points3D.txt").touch()
    run(["colmap", "sequential_matcher", *database_args], prepared)
    run(["colmap", "point_triangulator", *database_args, *image_args,
         "--input_path", str(seed), "--output_path", str(model)], prepared)

    reconstruction = pycolmap.Reconstruction(str(model))
    error = reconstruction.compute_mean_reprojection_error()
    if (reconstruction.num_reg_images() < max(12, len(frames) * 0.65)
            or reconstruction.num_points3D() < max(100, len(frames) * 3)
            or not math.isfinite(error) or error > 2.5):
        raise RuntimeError("The supplied camera poses did not triangulate a usable model.")

    shutil.copytree(images, prepared / "images")
    if downscale > 1:
        resized = prepared / f"images_{downscale}"
        resized.mkdir()
        for image_path in images.iterdir():
            with Image.open(image_path) as image:
                image.resize((max(1, width // downscale), max(1, height // downscale)), Image.Resampling.LANCZOS).save(
                    resized / image_path.name, quality=95)
    colmap_to_json(model, prepared, use_single_camera_mode=False)
