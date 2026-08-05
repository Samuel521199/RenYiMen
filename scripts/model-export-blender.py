from __future__ import annotations

import base64
import json
import re
import shutil
import struct
import sys
import zipfile
from pathlib import Path


GLB_JSON_CHUNK = 0x4E4F534A
GLB_BIN_CHUNK = 0x004E4942


def parse_args() -> tuple[Path, Path, str]:
    try:
        separator = sys.argv.index("--")
        input_path, output_path, export_kind = sys.argv[separator + 1 : separator + 4]
    except (ValueError, IndexError):
        raise RuntimeError("Expected: -- <input.glb> <output.zip> <fbx|textures>")
    if export_kind not in {"fbx", "textures"}:
        raise RuntimeError(f"Unsupported export kind: {export_kind}")
    return Path(input_path).resolve(), Path(output_path).resolve(), export_kind


def parse_glb(path: Path) -> tuple[dict, bytes]:
    payload = path.read_bytes()
    if len(payload) < 12 or payload[:4] != b"glTF":
        raise RuntimeError("Input is not a valid binary glTF (GLB) file")
    version, declared_length = struct.unpack_from("<II", payload, 4)
    if version != 2 or declared_length > len(payload):
        raise RuntimeError("Only valid glTF 2.0 GLB files are supported")

    offset = 12
    document = None
    binary_chunk = b""
    while offset + 8 <= declared_length:
        chunk_length, chunk_type = struct.unpack_from("<II", payload, offset)
        offset += 8
        chunk = payload[offset : offset + chunk_length]
        offset += chunk_length
        if chunk_type == GLB_JSON_CHUNK:
            document = json.loads(chunk.rstrip(b"\x00 \t\r\n").decode("utf-8"))
        elif chunk_type == GLB_BIN_CHUNK:
            binary_chunk = chunk
    if not isinstance(document, dict):
        raise RuntimeError("GLB does not contain a JSON document")
    return document, binary_chunk


def safe_name(value: str, fallback: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", value.strip()).strip("._")
    return cleaned[:80] or fallback


def extension_for_image(image: dict, payload: bytes) -> str:
    mime = str(image.get("mimeType") or "").lower()
    if mime == "image/jpeg" or payload.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if mime == "image/webp" or payload.startswith(b"RIFF") and payload[8:12] == b"WEBP":
        return ".webp"
    return ".png"


def image_bytes(document: dict, binary_chunk: bytes, image: dict, input_dir: Path) -> bytes:
    if isinstance(image.get("bufferView"), int):
        view = document.get("bufferViews", [])[image["bufferView"]]
        start = int(view.get("byteOffset", 0))
        length = int(view["byteLength"])
        return binary_chunk[start : start + length]

    uri = image.get("uri")
    if isinstance(uri, str) and uri.startswith("data:"):
        _, encoded = uri.split(",", 1)
        return base64.b64decode(encoded)
    if isinstance(uri, str):
        candidate = (input_dir / uri).resolve()
        if input_dir not in candidate.parents and candidate != input_dir:
            raise RuntimeError("GLB image URI escapes the input directory")
        return candidate.read_bytes()
    raise RuntimeError("GLB image does not contain readable image data")


def material_texture_roles(document: dict) -> list[dict]:
    textures = document.get("textures") if isinstance(document.get("textures"), list) else []
    materials = document.get("materials") if isinstance(document.get("materials"), list) else []
    output: list[dict] = []
    for material_index, material in enumerate(materials):
        if not isinstance(material, dict):
            continue
        pbr = material.get("pbrMetallicRoughness") if isinstance(material.get("pbrMetallicRoughness"), dict) else {}
        candidates = {
            "base_color": pbr.get("baseColorTexture"),
            "metallic_roughness": pbr.get("metallicRoughnessTexture"),
            "normal": material.get("normalTexture"),
            "occlusion": material.get("occlusionTexture"),
            "emissive": material.get("emissiveTexture"),
        }
        roles: dict[str, int] = {}
        for role, texture_ref in candidates.items():
            if not isinstance(texture_ref, dict) or not isinstance(texture_ref.get("index"), int):
                continue
            texture_index = texture_ref["index"]
            if texture_index >= len(textures) or not isinstance(textures[texture_index], dict):
                continue
            source = textures[texture_index].get("source")
            if isinstance(source, int):
                roles[role] = source
        output.append(
            {
                "index": material_index,
                "name": safe_name(str(material.get("name") or ""), f"material_{material_index + 1:02d}"),
                "roles": roles,
            }
        )
    return output


def split_channel(source_path: Path, output_path: Path, channel_index: int) -> None:
    import bpy

    image = bpy.data.images.load(str(source_path), check_existing=False)
    try:
        image.colorspace_settings.name = "Non-Color"
        width, height = image.size
        if width <= 0 or height <= 0:
            raise RuntimeError(f"Cannot decode texture: {source_path.name}")
        try:
            import numpy as np

            source = np.empty(width * height * 4, dtype=np.float32)
            image.pixels.foreach_get(source)
            source = source.reshape((height, width, 4))
            value = source[:, :, channel_index : channel_index + 1]
            target_pixels = np.concatenate((value, value, value, np.ones_like(value)), axis=2).reshape(-1)
        except ImportError:
            from array import array

            source = array("f", [0.0]) * (width * height * 4)
            image.pixels.foreach_get(source)
            target_pixels = array("f", [0.0]) * len(source)
            for pixel in range(width * height):
                value = source[pixel * 4 + channel_index]
                target_pixels[pixel * 4 : pixel * 4 + 4] = array("f", (value, value, value, 1.0))

        target = bpy.data.images.new(output_path.stem, width=width, height=height, alpha=False)
        try:
            target.colorspace_settings.name = "Non-Color"
            target.pixels.foreach_set(target_pixels)
            target.filepath_raw = str(output_path)
            target.file_format = "PNG"
            target.save()
        finally:
            bpy.data.images.remove(target)
    finally:
        bpy.data.images.remove(image)


def extract_textures(input_path: Path, package_dir: Path) -> tuple[dict, list[str], list[Path]]:
    document, binary_chunk = parse_glb(input_path)
    images = document.get("images") if isinstance(document.get("images"), list) else []
    source_dir = package_dir / "textures" / "source"
    texture_dir = package_dir / "textures"
    source_dir.mkdir(parents=True, exist_ok=True)

    source_paths: list[Path] = []
    warnings: list[str] = []
    for index, image in enumerate(images):
        if not isinstance(image, dict):
            source_paths.append(Path())
            continue
        payload = image_bytes(document, binary_chunk, image, input_path.parent)
        extension = extension_for_image(image, payload)
        filename = safe_name(str(image.get("name") or ""), f"image_{index + 1:02d}") + extension
        destination = source_dir / filename
        destination.write_bytes(payload)
        source_paths.append(destination)

    manifest_materials = []
    for material in material_texture_roles(document):
        exported_roles: dict[str, str] = {}
        for role, image_index in material["roles"].items():
            if image_index >= len(source_paths) or not source_paths[image_index].is_file():
                continue
            source = source_paths[image_index]
            destination = texture_dir / f"{material['name']}_{role}{source.suffix.lower()}"
            shutil.copyfile(source, destination)
            exported_roles[role] = destination.relative_to(package_dir).as_posix()
            if role == "metallic_roughness":
                for split_role, channel in (("roughness", 1), ("metallic", 2)):
                    split_destination = texture_dir / f"{material['name']}_{split_role}.png"
                    try:
                        split_channel(source, split_destination, channel)
                        exported_roles[split_role] = split_destination.relative_to(package_dir).as_posix()
                    except Exception as error:
                        warnings.append(f"Failed to split {split_role} from {source.name}: {error}")
        manifest_materials.append({**material, "exported": exported_roles})

    manifest = {
        "format": "WorkFlow 3D art package v1",
        "source": input_path.name,
        "materials": manifest_materials,
        "channelPacking": {
            "metallicRoughness": "G=roughness, B=metallic",
            "occlusionMetallicRoughness": "R=ambient occlusion, G=roughness, B=metallic when shared",
        },
        "warnings": warnings,
    }
    return manifest, warnings, source_paths


def relink_blender_images(source_paths: list[Path], document: dict) -> None:
    import bpy

    available = [image for image in bpy.data.images if image.type == "IMAGE" and image.name not in {"Render Result", "Viewer Node"}]
    named = {image.name: image for image in available}
    used = set()
    for index, image_definition in enumerate(document.get("images", [])):
        if index >= len(source_paths) or not source_paths[index].is_file():
            continue
        configured_name = str(image_definition.get("name") or "") if isinstance(image_definition, dict) else ""
        image = named.get(configured_name)
        if image is None:
            image = next((candidate for candidate in available if candidate.name not in used), None)
        if image is None:
            continue
        used.add(image.name)
        try:
            if image.packed_file:
                image.unpack(method="REMOVE")
        except Exception:
            pass
        image.filepath_raw = str(source_paths[index])
        try:
            image.reload()
        except Exception:
            pass


def export_fbx(input_path: Path, package_dir: Path, source_paths: list[Path]) -> Path:
    import bpy

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(input_path), import_pack_images=True)
    document, _ = parse_glb(input_path)
    relink_blender_images(source_paths, document)
    destination = package_dir / "model.fbx"
    bpy.ops.export_scene.fbx(
        filepath=str(destination),
        use_selection=False,
        path_mode="RELATIVE",
        embed_textures=False,
        add_leaf_bones=False,
        bake_anim=True,
        use_mesh_modifiers=True,
    )
    if not destination.is_file() or destination.stat().st_size == 0:
        raise RuntimeError("Blender did not produce an FBX file")
    return destination


def write_package_docs(package_dir: Path, export_kind: str, manifest: dict) -> None:
    (package_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    contents = [
        "WorkFlow 3D art delivery package",
        "",
        "model.fbx: converted model (included in the FBX package only)",
        "textures/: semantic PBR textures for art production",
        "textures/source/: original images embedded in the source GLB",
        "manifest.json: material-to-texture mapping and channel packing details",
        "",
        "Metallic/roughness convention: G=roughness, B=metallic. Separate grayscale maps are also exported when decoding succeeds.",
        "FBX material systems differ between DCC applications. Reconnect the exported textures using manifest.json if the target application does not restore them automatically.",
        f"Package type: {export_kind}",
    ]
    (package_dir / "README.txt").write_text("\n".join(contents) + "\n", encoding="utf-8")


def create_zip(package_dir: Path, output_path: Path) -> None:
    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path in sorted(package_dir.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(package_dir).as_posix())


def main() -> None:
    input_path, output_path, export_kind = parse_args()
    package_dir = output_path.parent / "package"
    package_dir.mkdir(parents=True, exist_ok=True)
    manifest, _, source_paths = extract_textures(input_path, package_dir)
    if export_kind == "fbx":
        export_fbx(input_path, package_dir, source_paths)
    write_package_docs(package_dir, export_kind, manifest)
    create_zip(package_dir, output_path)


if __name__ == "__main__":
    main()
