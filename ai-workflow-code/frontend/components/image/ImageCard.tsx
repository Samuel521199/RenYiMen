import type { TaskImage } from "@/lib/types";

interface ImageCardProps {
  image: TaskImage;
  onSelect?: (image: TaskImage) => void;
  onApprove?: (image: TaskImage) => void;
}

function formatDate(value: string) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ImageCard({ image, onSelect, onApprove }: ImageCardProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => onSelect?.(image)}
        className="block w-full bg-gray-100 text-left"
      >
        <img
          src={image.image_url}
          alt={`Task image ${image.id}`}
          className="aspect-square w-full object-cover"
        />
      </button>

      <div className="space-y-3 p-4">
        <div>
          <p className="text-sm font-medium text-gray-900">
            {image.model_name || image.model_provider || "未知模型"}
          </p>
          <p className="mt-1 text-xs text-gray-500">{formatDate(image.created_at)}</p>
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">成本</span>
          <span className="font-medium text-gray-900">${Number(image.cost || 0).toFixed(4)}</span>
        </div>

        {onApprove && (
          <button
            type="button"
            onClick={() => onApprove(image)}
            className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            设为通过
          </button>
        )}
      </div>
    </div>
  );
}
