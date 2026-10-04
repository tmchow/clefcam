/** Centered object-fit: cover geometry, shared by capture and inference. */
export function coverCrop(
  sourceWidth: number,
  sourceHeight: number,
  viewWidth: number,
  viewHeight: number,
) {
  if (
    ![sourceWidth, sourceHeight, viewWidth, viewHeight].every(
      (n) => Number.isFinite(n) && n > 0,
    )
  )
    return null;
  const scale = Math.max(viewWidth / sourceWidth, viewHeight / sourceHeight);
  const width = viewWidth / scale,
    height = viewHeight / scale;
  return {
    x: (sourceWidth - width) / 2,
    y: (sourceHeight - height) / 2,
    width,
    height,
  };
}
/** Render into the visible canvas. Native video is used only as a decoder. */
export function drawPreviewFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  mirrored: boolean,
  maxSide = 1920,
) {
  const crop = coverCrop(video.videoWidth, video.videoHeight, width, height);
  if (!crop || video.readyState < 2) return false;
  const scale = Math.min(1, maxSide / Math.max(crop.width, crop.height));
  const w = Math.max(1, Math.round(crop.width * scale));
  const h = Math.max(1, Math.round(crop.height * scale));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(mirrored ? -1 : 1, 0, 0, 1, mirrored ? w : 0, 0);
  ctx.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, w, h);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return true;
}
