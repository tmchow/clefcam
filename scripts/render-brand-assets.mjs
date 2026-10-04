import sharp from "sharp";
const icons = [
  [180, "apple-touch-icon.png"],
  [192, "icon-192.png"],
  [512, "icon-512.png"],
  [32, "favicon-32.png"],
];
for (const [size, file] of icons) {
  await sharp("public/icon.svg")
    .resize(size, size)
    .flatten({ background: "#315eff" })
    .png()
    .toFile(`public/${file}`);
}
await sharp("docs/assets/clefcam-header.svg")
  .png()
  .toFile("docs/assets/clefcam-header.png");
