import { readdirSync, existsSync } from "fs";
import { join } from "path";

// Images klasörünün yolu
const IMAGES_DIR = join(import.meta.dir, "../images");

/**
 * Seri klasörlerini listele
 */
export function getSeriesFolders(): string[] {
    if (!existsSync(IMAGES_DIR)) return [];
    return readdirSync(IMAGES_DIR, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
}

/**
 * Karakter için yerel resim yolunu bul
 * Pattern: {NAME}.jpg
 */
export function getLocalImagePath(characterName: string, seriesName: string): string | null {
    const seriesPath = join(IMAGES_DIR, seriesName);
    if (!existsSync(seriesPath)) return null;

    const imagePath = join(seriesPath, `${characterName}.jpg`);
    if (existsSync(imagePath)) {
        return imagePath;
    }

    // PNG versiyonunu da dene
    const pngPath = join(seriesPath, `${characterName}.png`);
    if (existsSync(pngPath)) {
        return pngPath;
    }

    return null;
}

/**
 * Karakter için çoklu yerel resim yollarını bul
 * Pattern: {NAME}.jpg, {NAME}_1.jpg, {NAME}_2.jpg, ...
 */
export function getMultipleLocalImages(characterName: string, seriesName: string): string[] {
    const seriesPath = join(IMAGES_DIR, seriesName);
    if (!existsSync(seriesPath)) return [];

    const images: string[] = [];

    // Ana resim
    const mainImage = getLocalImagePath(characterName, seriesName);
    if (mainImage) {
        images.push(mainImage);
    }

    // Numaralı resimleri bul
    const files = readdirSync(seriesPath);
    const pattern = new RegExp(`^${escapeRegex(characterName)}_(\\d+)\\.(jpg|jpeg|png)$`, 'i');

    files.forEach(file => {
        if (pattern.test(file)) {
            images.push(join(seriesPath, file));
        }
    });

    // Sırala
    images.sort((a, b) => {
        const numA = extractImageNumber(a);
        const numB = extractImageNumber(b);
        return numA - numB;
    });

    return images;
}

/**
 * Tüm serilerde karakter resmini ara
 */
export function findCharacterImage(characterName: string): { path: string; series: string } | null {
    const series = getSeriesFolders();

    for (const seriesName of series) {
        const imagePath = getLocalImagePath(characterName, seriesName);
        if (imagePath) {
            return { path: imagePath, series: seriesName };
        }
    }

    return null;
}

/**
 * Tüm serilerde karakter için çoklu resimleri ara
 */
export function findAllCharacterImages(characterName: string): { path: string; series: string }[] {
    const series = getSeriesFolders();
    const results: { path: string; series: string }[] = [];

    for (const seriesName of series) {
        const images = getMultipleLocalImages(characterName, seriesName);
        images.forEach(path => {
            results.push({ path, series: seriesName });
        });
    }

    return results;
}

/**
 * Seri isim_listesi.txt dosyasından anime adını oku
 */
export async function getSeriesAnimeTitle(seriesName: string): Promise<string> {
    const listPath = join(IMAGES_DIR, seriesName, "isim_listesi.txt");
    if (!existsSync(listPath)) return seriesName;

    try {
        const content = await Bun.file(listPath).text();
        const lines = content.split('\n');
        const firstLine = lines[0] || '';
        const match = firstLine.match(/^ANIME:\s*(.+)$/i);
        return match && match[1] ? match[1].trim() : seriesName;
    } catch {
        return seriesName;
    }
}

// Yardımcı fonksiyonlar
function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractImageNumber(path: string): number {
    const match = path.match(/_(\d+)\.(jpg|jpeg|png)$/i);
    return match && match[1] ? parseInt(match[1]) : 0;
}
