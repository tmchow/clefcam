import type { Page } from "@playwright/test";
export async function fakeCamera(
  page: Page,
  delayPermission = false,
  background = "#dedbd3",
) {
  await page.addInitScript(
    ({ delayPermission, background }) => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 960;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, 640, 960);
      ctx.fillStyle = "#ad8969";
      ctx.fillRect(0, 610, 640, 350);
      ctx.fillStyle = "#365b80";
      ctx.beginPath();
      ctx.roundRect(240, 470, 140, 165, 20);
      ctx.fill();
      ctx.strokeStyle = "#365b80";
      ctx.lineWidth = 20;
      ctx.beginPath();
      ctx.arc(382, 535, 36, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = background;
      ctx.fillRect(20, 20, 130, 24);
      ctx.fillStyle = "#52606e";
      ctx.font = "14px sans-serif";
      ctx.fillText("Test camera fixture", 25, 38);
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        value: async () => {
          if (delayPermission)
            await new Promise<void>((resolve) => {
              Object.assign(window, { releaseCameraPermission: resolve });
            });
          const stream = canvas.captureStream(10);
          setInterval(() => {
            ctx.fillStyle = "#52606e";
            ctx.fillRect(1, 1, 1, 1);
          }, 80);
          return stream;
        },
      });
    },
    { delayPermission, background },
  );
}
