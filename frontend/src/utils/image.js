// Phone photos are usually 3–8 MB, but the server only accepts about 1.5 MB of
// image data. Shrink and re-encode the photo in the browser before uploading.
export async function compressImage(file, { maxSide = 1280, quality = 0.82, maxChars = 1_400_000 } = {}) {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("這張照片的格式無法讀取，請換一張試試。"));
      element.src = url;
    });

    let side = maxSide;
    let currentQuality = quality;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const ratio = Math.min(1, side / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", currentQuality);
      if (dataUrl.length <= maxChars) return dataUrl;
      side = Math.round(side * 0.8);
      currentQuality = Math.max(0.6, currentQuality - 0.06);
    }
    throw new Error("照片太大了，請換一張較小的照片。");
  } finally {
    URL.revokeObjectURL(url);
  }
}
