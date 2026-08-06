"""Build lightweight homepage showcase MP4s from the existing cover artwork."""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
COVERS = ROOT / "public" / "covers"
OUTPUT = ROOT / "public" / "showcase"

ANIMATED_SOURCES = {
    "camera-replication.mp4": COVERS / "camera-movement-replication-animated.webp",
    "effect-replication.mp4": COVERS / "effect-replication-animated.webp",
    "prompt-intelligence.mp4": COVERS / "prompt-reverse-animated.webp",
}


def run_ffmpeg(*args: str) -> None:
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args],
        check=True,
    )


def convert_animated_webp(source: Path, destination: Path) -> None:
    with tempfile.TemporaryDirectory(prefix="home-showcase-") as temp_dir:
        frame_dir = Path(temp_dir)
        image = Image.open(source)
        for index in range(image.n_frames):
            image.seek(index)
            image.convert("RGB").save(frame_dir / f"{index:04d}.jpg", quality=92)

        run_ffmpeg(
            "-framerate",
            "10",
            "-i",
            str(frame_dir / "%04d.jpg"),
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "slow",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(destination),
        )


def build_talking_character_video(destination: Path) -> None:
    run_ffmpeg(
        "-loop",
        "1",
        "-i",
        str(COVERS / "talking-character-video.webp"),
        "-t",
        "5.5",
        "-vf",
        (
            "scale=960:540,zoompan="
            "z='min(zoom+0.00065,1.07)':"
            "x='iw/2-(iw/zoom/2)':"
            "y='ih/2-(ih/zoom/2)':"
            "d=138:s=960x540:fps=25"
        ),
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "slow",
        "-crf",
        "22",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        str(destination),
    )


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for filename, source in ANIMATED_SOURCES.items():
        convert_animated_webp(source, OUTPUT / filename)
    build_talking_character_video(OUTPUT / "talking-character.mp4")


if __name__ == "__main__":
    main()
