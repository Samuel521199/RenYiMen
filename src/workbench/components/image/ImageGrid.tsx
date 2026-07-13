import ImageCard from "@workbench/components/image/ImageCard";
import type { TaskImage } from "@workbench/lib/types";

interface ImageGridProps {
  images: TaskImage[];
}

export default function ImageGrid({ images }: ImageGridProps) {
  const safeImages = Array.isArray(images) ? images : [];

  if (safeImages.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
        暂无图片
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {safeImages.map((image) => (
        <ImageCard key={image.id} image={image} />
      ))}
    </div>
  );
}
