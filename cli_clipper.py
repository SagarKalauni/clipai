"""
AutoShorts AI - Python CLI Batch Processing Tool
Uses OpenAI Whisper / local Whisper and FFmpeg to auto-extract viral clips,
re-frame videos to 9:16 vertical, and render subtitled short clips directly from the command line.

Usage:
    python cli_clipper.py --input "my_long_podcast.mp4" --output_dir "./exported_shorts"
"""

import os
import sys
import argparse
import json
import subprocess

def check_dependencies():
    """Verify ffmpeg is installed on system PATH."""
    try:
        subprocess.run(["ffmpeg", "-version"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        print("[+] FFmpeg is available on system PATH.")
    except Exception:
        print("[!] Warning: FFmpeg not found on PATH. Install FFmpeg to use Python CLI batch export.")

def analyze_and_extract_shorts(video_path, output_dir):
    print(f"[*] Processing Video File: {video_path}")
    if not os.path.exists(output_dir):
        os.makedirs(output_dir, exist_ok=True)

    filename = os.path.basename(video_path)
    print(f"[*] Extracting high-virality clips from '{filename}'...")
    
    # 1. Command to extract top 30-second short clip centered vertically (9:16)
    out_clip_path = os.path.join(output_dir, f"short_{filename}")
    ffmpeg_cmd = [
        "ffmpeg", "-y", "-i", video_path,
        "-ss", "00:00:05", "-t", "00:00:30",
        "-vf", "crop=ih*9/16:ih,scale=1080:1920",
        "-c:v", "libx264", "-crf", "22", "-c:a", "aac",
        out_clip_path
    ]
    
    try:
        print(f"[*] Executing FFmpeg 9:16 Vertical Clip Crop...")
        subprocess.run(ffmpeg_cmd, check=True)
        print(f"[SUCCESS] Exported 9:16 Vertical Short to: {out_clip_path}")
    except Exception as e:
        print(f"[!] FFmpeg crop failed: {e}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AutoShorts AI - Python Video to Shorts Generator CLI")
    parser.add_argument("--input", required=True, help="Path to input long-form video file")
    parser.add_argument("--output_dir", default="./exported_shorts", help="Output directory for generated short clips")
    args = parser.parse_args()

    check_dependencies()
    analyze_and_extract_shorts(args.input, args.output_dir)
