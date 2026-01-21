// Karakter resimlerini düzeltme scripti
// MAL, AniList veya yerel dosyalardan resim günceller

import { db } from "./database/db";
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { searchCharacter } from "./utils/jikanApi";

const IMAGES_DIR = join(import.meta.dir, "images");
const RATE_LIMIT_DELAY = 1100;
const ANILIST_API = "https://graphql.anilist.co";

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// AniList API'den karakter ara
async function searchAniList(characterName: string): Promise<string | null> {
    const query = `
        query ($search: String) {
            Character(search: $search) {
                id
                name {
                    full
                }
                image {
                    large
                    medium
                }
            }
        }
    `;

    try {
        const response = await fetch(ANILIST_API, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            body: JSON.stringify({
                query,
                variables: { search: characterName }
            })
        });

        const data = await response.json() as any;
        if (data?.data?.Character?.image) {
            return data.data.Character.image.large || data.data.Character.image.medium;
        }
    } catch (error) {
        // AniList hatası - sessizce devam et
    }

    return null;
}

// Yerel resim dosyasını bul
function findLocalImage(seriesName: string, characterName: string): string | null {
    const folders = readdirSync(IMAGES_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);

    const matchingFolder = folders.find(f =>
        f.toLowerCase().includes(seriesName.toLowerCase()) ||
        seriesName.toLowerCase().includes(f.toLowerCase())
    );

    if (!matchingFolder) return null;

    const seriesPath = join(IMAGES_DIR, matchingFolder);

    const extensions = [".jpg", ".png", ".jpeg", ".gif", ".webp"];
    for (const ext of extensions) {
        const imagePath = join(seriesPath, `${characterName}${ext}`);
        if (existsSync(imagePath)) return imagePath;
    }

    return null;
}

async function fixImages(mode: "local" | "mal" | "anilist" | "all" = "all") {
    console.log(`🔄 Resim düzeltme başlıyor... (mod: ${mode})\n`);

    const characters = db.query(`
        SELECT id, name, series, image_url 
        FROM characters 
        WHERE image_url IS NULL OR image_url = '' OR image_url NOT LIKE 'http%'
    `).all() as any[];

    console.log(`📊 ${characters.length} karakter resmi eksik\n`);

    let fixed = 0;
    let notFound = 0;
    let errors = 0;

    for (let i = 0; i < characters.length; i++) {
        const char = characters[i];
        console.log(`[${i + 1}/${characters.length}] ${char.name} (${char.series})...`);

        // 1. Yerel dosyalarda ara
        if (mode === "local" || mode === "all") {
            const localPath = findLocalImage(char.series, char.name);
            if (localPath) {
                db.run("UPDATE characters SET image_url = ? WHERE id = ?", [localPath, char.id]);
                console.log(`  ✅ Yerel: ${localPath}`);
                fixed++;
                continue;
            }
        }

        // 2. AniList'te ara
        if (mode === "anilist" || mode === "all") {
            await delay(RATE_LIMIT_DELAY);
            const anilistUrl = await searchAniList(char.name);
            if (anilistUrl) {
                db.run("UPDATE characters SET image_url = ? WHERE id = ?", [anilistUrl, char.id]);
                console.log(`  ✅ AniList: ${anilistUrl.substring(0, 50)}...`);
                fixed++;
                continue;
            }
        }

        // 3. MAL'dan ara
        if (mode === "mal" || mode === "all") {
            try {
                await delay(RATE_LIMIT_DELAY);
                const results = await searchCharacter(char.name);

                if (results.length > 0) {
                    const match = results.find(r =>
                        r.name.toLowerCase() === char.name.toLowerCase() ||
                        r.name.toLowerCase().includes(char.name.toLowerCase())
                    ) || results[0];

                    const imageUrl = match.images?.jpg?.image_url;
                    if (imageUrl) {
                        db.run("UPDATE characters SET image_url = ? WHERE id = ?", [imageUrl, char.id]);
                        console.log(`  ✅ MAL: ${imageUrl.substring(0, 50)}...`);
                        fixed++;
                        continue;
                    }
                }

                console.log(`  ⚠️ Bulunamadı`);
                notFound++;
            } catch (error) {
                console.error(`  ❌ Hata:`, error);
                errors++;
            }
        }
    }

    console.log(`\n🎉 Resim düzeltme tamamlandı!`);
    console.log(`   ✅ ${fixed} resim düzeltildi`);
    console.log(`   ⚠️ ${notFound} bulunamadı`);
    console.log(`   ❌ ${errors} hata`);
}

// Kullanım: bun run src/fixImages.ts [local|mal|anilist|all]
const mode = (process.argv[2] as "local" | "mal" | "anilist" | "all") || "all";
fixImages(mode);

