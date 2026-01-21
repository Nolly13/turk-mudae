// Tüm karakter resimlerini yeniden düzenleme scripti
// Bütün karakterlerin resimlerini yerel dosyalar, AniList veya MAL'dan günceller

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
                name { full }
                image { large medium }
            }
        }
    `;

    try {
        const response = await fetch(ANILIST_API, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify({ query, variables: { search: characterName } })
        });

        const data = await response.json() as any;
        if (data?.data?.Character?.image) {
            return data.data.Character.image.large || data.data.Character.image.medium;
        }
    } catch (error) { }

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

async function refreshAllImages(source: "local" | "anilist" | "mal" | "all" = "all") {
    console.log(`🔄 Tüm karakter resimlerini yenileme başlıyor... (kaynak: ${source})\n`);

    // TÜM karakterleri al
    const characters = db.query(`SELECT id, name, series, image_url FROM characters ORDER BY rank ASC`).all() as any[];

    console.log(`📊 Toplam ${characters.length} karakter işlenecek\n`);

    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (let i = 0; i < characters.length; i++) {
        const char = characters[i];
        console.log(`[${i + 1}/${characters.length}] ${char.name} (${char.series})...`);

        let newImageUrl: string | null = null;

        // 1. Yerel dosyalarda ara
        if (source === "local" || source === "all") {
            newImageUrl = findLocalImage(char.series, char.name);
            if (newImageUrl) {
                db.run("UPDATE characters SET image_url = ? WHERE id = ?", [newImageUrl, char.id]);
                console.log(`  ✅ Yerel`);
                updated++;
                continue;
            }
        }

        // 2. AniList'te ara
        if (source === "anilist" || source === "all") {
            await delay(RATE_LIMIT_DELAY);
            newImageUrl = await searchAniList(char.name);
            if (newImageUrl) {
                db.run("UPDATE characters SET image_url = ? WHERE id = ?", [newImageUrl, char.id]);
                console.log(`  ✅ AniList`);
                updated++;
                continue;
            }
        }

        // 3. MAL'dan ara
        if (source === "mal" || source === "all") {
            try {
                await delay(RATE_LIMIT_DELAY);
                const results = await searchCharacter(char.name);

                if (results.length > 0) {
                    const match = results.find(r =>
                        r.name.toLowerCase() === char.name.toLowerCase() ||
                        r.name.toLowerCase().includes(char.name.toLowerCase())
                    ) || results[0];

                    const imageUrl = match?.images?.jpg?.image_url;
                    if (imageUrl) {
                        db.run("UPDATE characters SET image_url = ? WHERE id = ?", [imageUrl, char.id]);
                        console.log(`  ✅ MAL`);
                        updated++;
                        continue;
                    }
                }
            } catch (error) {
                console.log(`  ❌ Hata`);
                errors++;
                continue;
            }
        }

        // Resim bulunamadı - mevcut resmi koru
        console.log(`  ⏭️ Korundu (${char.image_url ? "mevcut" : "yok"})`);
        skipped++;
    }

    console.log(`\n🎉 Resim yenileme tamamlandı!`);
    console.log(`   ✅ ${updated} güncellendi`);
    console.log(`   ⏭️ ${skipped} korundu`);
    console.log(`   ❌ ${errors} hata`);
}

// Kullanım: bun run src/refreshAllImages.ts [local|anilist|mal|all]
const source = (process.argv[2] as "local" | "anilist" | "mal" | "all") || "all";
refreshAllImages(source);
