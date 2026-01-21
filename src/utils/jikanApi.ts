// Jikan API (MyAnimeList) entegrasyonu
// https://api.jikan.moe/v4

const JIKAN_BASE_URL = "https://api.jikan.moe/v4";
const RATE_LIMIT_DELAY = 1000; // 1 saniye (Jikan rate limit: 3 req/sec)

interface JikanCharacter {
    mal_id: number;
    name: string;
    name_kanji: string;
    favorites: number;
    about: string;
    images: {
        jpg: { image_url: string };
        webp: { image_url: string };
    };
}

interface JikanAnimeCharacter {
    character: JikanCharacter;
    role: "Main" | "Supporting";
}

// Rate limiting için bekleme
function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Top karakterleri getir (global favori sıralamasına göre)
 */
export async function getTopCharacters(page: number = 1, limit: number = 25): Promise<JikanCharacter[]> {
    try {
        const response = await fetch(`${JIKAN_BASE_URL}/top/characters?page=${page}&limit=${limit}`);
        const data = await response.json();
        return data.data || [];
    } catch (error) {
        console.error("Jikan API hatası:", error);
        return [];
    }
}

/**
 * Anime'nin karakterlerini getir
 */
export async function getAnimeCharacters(animeId: number): Promise<JikanAnimeCharacter[]> {
    try {
        await delay(RATE_LIMIT_DELAY);
        const response = await fetch(`${JIKAN_BASE_URL}/anime/${animeId}/characters`);
        const data = await response.json();
        return data.data || [];
    } catch (error) {
        console.error("Jikan API hatası:", error);
        return [];
    }
}

/**
 * Anime ara (isimle)
 */
export async function searchAnime(query: string): Promise<any[]> {
    try {
        await delay(RATE_LIMIT_DELAY);
        const response = await fetch(`${JIKAN_BASE_URL}/anime?q=${encodeURIComponent(query)}&limit=5`);
        const data = await response.json();
        return data.data || [];
    } catch (error) {
        console.error("Jikan API hatası:", error);
        return [];
    }
}

/**
 * Karakter ara (isimle)
 */
export async function searchCharacter(query: string): Promise<JikanCharacter[]> {
    try {
        await delay(RATE_LIMIT_DELAY);
        const response = await fetch(`${JIKAN_BASE_URL}/characters?q=${encodeURIComponent(query)}&limit=5`);
        const data = await response.json();
        return data.data || [];
    } catch (error) {
        console.error("Jikan API hatası:", error);
        return [];
    }
}

/**
 * Favori sayısından rank hesapla
 */
export function calculateRankFromFavorites(favorites: number): number {
    if (favorites >= 100000) return 1;
    if (favorites >= 50000) return Math.floor(Math.random() * 5) + 2; // 2-6
    if (favorites >= 25000) return Math.floor(Math.random() * 10) + 7; // 7-16
    if (favorites >= 10000) return Math.floor(Math.random() * 20) + 17; // 17-36
    if (favorites >= 5000) return Math.floor(Math.random() * 30) + 37; // 37-66
    if (favorites >= 1000) return Math.floor(Math.random() * 50) + 67; // 67-116
    if (favorites >= 500) return Math.floor(Math.random() * 100) + 117; // 117-216
    if (favorites >= 100) return Math.floor(Math.random() * 200) + 217; // 217-416
    return Math.floor(Math.random() * 500) + 417; // 417+
}

/**
 * Favori sayısından değer hesapla
 */
export function calculateValueFromFavorites(favorites: number): number {
    if (favorites >= 100000) return Math.floor(Math.random() * 5000) + 8000; // 8000-13000
    if (favorites >= 50000) return Math.floor(Math.random() * 3000) + 5000; // 5000-8000
    if (favorites >= 25000) return Math.floor(Math.random() * 2000) + 3000; // 3000-5000
    if (favorites >= 10000) return Math.floor(Math.random() * 1500) + 1500; // 1500-3000
    if (favorites >= 5000) return Math.floor(Math.random() * 1000) + 800; // 800-1800
    if (favorites >= 1000) return Math.floor(Math.random() * 500) + 400; // 400-900
    if (favorites >= 500) return Math.floor(Math.random() * 300) + 200; // 200-500
    if (favorites >= 100) return Math.floor(Math.random() * 150) + 100; // 100-250
    return Math.floor(Math.random() * 80) + 50; // 50-130
}
