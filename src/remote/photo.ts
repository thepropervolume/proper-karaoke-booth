import { MAX_PHOTO_BYTES } from '../domain/photo';

/** Decode a selected file in the browser and remove its metadata by re-encoding. */
export async function prepareGuestPhoto(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png'].includes(file.type) || file.size <= 0 || file.size > 12 * 1024 * 1024)
    throw new Error('Choose a JPEG or PNG smaller than 12 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The selected image could not be read.'));
      image.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40_000_000)
      throw new Error('The selected image is too large.');
    const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This device cannot prepare the image.');
    // Flatten transparency so JPEG output is predictable.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.85, 0.7, 0.5, 0.3]) {
      const data = canvas.toDataURL('image/jpeg', quality);
      if (data.startsWith('data:image/jpeg;base64,') && (data.length - 23) * 3 / 4 <= MAX_PHOTO_BYTES) return data;
    }
    throw new Error('The image could not be reduced enough. Choose another image.');
  } finally {
    URL.revokeObjectURL(url);
  }
}
