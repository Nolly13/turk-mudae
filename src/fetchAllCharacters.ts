// AniList ve MAL'dan Toplu Karakter Çekme Scripti
// Kullanım: bun run src/fetchAllCharacters.ts --pages 100
// Her sayfa 25 karakter içerir, 100 sayfa = 2500 karakter

import { db, initializeDatabase } from "./database/db";
import { getTopCharactersAniList } from "./utils/anilistApi";
import { calculateRankFromFavorites, calculateValueFromFavorites } from "./utils/jikanApi";

const RATE_LIMIT_DELAY = 700; // 0.7 saniye (AniList rate limit: 90 req/min)

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Argümanları parse et
function parseArgs(): { pages: number; startPage: number } {
    const args = process.argv.slice(2);
    let pages = 100; // Varsayılan: 100 sayfa = 2500 karakter
    let startPage = 1;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--pages" && args[i + 1]) {
            pages = parseInt(args[i + 1]) || 100;
        }
        if (args[i] === "--start-page" && args[i + 1]) {
            startPage = parseInt(args[i + 1]) || 1;
        }
    }

    return { pages, startPage };
}

// Karakter veritabanında var mı kontrol et
function characterExists(name: string, series: string): boolean {
    const result = db.query(
        "SELECT id FROM characters WHERE LOWER(name) = LOWER(?) AND LOWER(series) = LOWER(?)"
    ).get(name, series);
    return !!result;
}

// Karakter ekle veya güncelle
function upsertCharacter(
    name: string,
    series: string,
    imageUrl: string,
    favorites: number,
    gender: string = "unknown"
): { action: "added" | "updated" | "skipped"; id?: number } {
    const value = calculateValueFromFavorites(favorites);

    // Mevcut karakteri kontrol et
    const existing = db.query(
        "SELECT id, value FROM characters WHERE LOWER(name) = LOWER(?) AND LOWER(series) = LOWER(?)"
    ).get(name, series) as any;

    if (existing) {
        // Sadece resim güncellemesi yap (değeri korumak için)
        if (imageUrl) {
            db.run(
                "UPDATE characters SET image_url = ? WHERE id = ?",
                [imageUrl, existing.id]
            );
        }
        return { action: "skipped", id: existing.id };
    }

    // Yeni karakter ekle
    db.run(
        "INSERT INTO characters (name, series, category, image_url, rank, value, gender) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [name, series, "Anime", imageUrl, 9999, value, gender]
    );

    const newChar = db.query(
        "SELECT id FROM characters WHERE LOWER(name) = LOWER(?) AND LOWER(series) = LOWER(?)"
    ).get(name, series) as any;

    return { action: "added", id: newChar?.id };
}

// Tüm karakterlere değerlerine göre benzersiz rank ata
function assignUniqueRanks(): number {
    console.log("\n🔄 Benzersiz rank ataması yapılıyor...");

    const characters = db.query(`
        SELECT id, name, value 
        FROM characters 
        ORDER BY value DESC, id ASC
    `).all() as any[];

    for (let i = 0; i < characters.length; i++) {
        const newRank = i + 1;
        db.run("UPDATE characters SET rank = ? WHERE id = ?", [newRank, characters[i].id]);
    }

    console.log(`   ✅ ${characters.length} karaktere benzersiz rank atandı (1-${characters.length})`);
    return characters.length;
}

// Ana fonksiyon
async function fetchAllCharacters() {
    console.log("🚀 AniList'ten Karakter Çekme Başlıyor...\n");

    // Veritabanını başlat
    initializeDatabase();

    const { pages, startPage } = parseArgs();
    console.log(`📋 Ayarlar: ${pages} sayfa, ${startPage}. sayfadan başla`);
    console.log(`   Tahmini karakter sayısı: ${pages * 25}\n`);

    let totalAdded = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    for (let page = startPage; page < startPage + pages; page++) {
        console.log(`📄 Sayfa ${page}/${startPage + pages - 1} işleniyor...`);

        try {
            const characters = await getTopCharactersAniList(page, 25);

            if (characters.length === 0) {
                console.log(`   ⚠️  Sayfa ${page} boş, sonlandırılıyor.`);
                break;
            }

            for (const char of characters) {
                const name = char.name?.full || "Unknown";
                const series = char.media?.nodes?.[0]?.title?.english ||
                    char.media?.nodes?.[0]?.title?.romaji ||
                    "Unknown Series";
                const imageUrl = char.image?.large || "";
                const favorites = char.favourites || 0;

                try {
                    const result = upsertCharacter(name, series, imageUrl, favorites);

                    if (result.action === "added") {
                        totalAdded++;
                        console.log(`   ✅ Eklendi: ${name} (${series}) - ${favorites} favori`);
                    } else if (result.action === "skipped") {
                        totalSkipped++;
                    }
                } catch (error) {
                    totalErrors++;
                    console.error(`   ❌ Hata (${name}):`, error);
                }
            }

            console.log(`   📊 Sayfa ${page}: ${characters.length} karakter işlendi\n`);

            // Rate limit için bekle
            await delay(RATE_LIMIT_DELAY);

        } catch (error) {
            console.error(`   ❌ Sayfa ${page} hatası:`, error);
            totalErrors++;
            await delay(RATE_LIMIT_DELAY * 2); // Hata durumunda daha uzun bekle
        }
    }

    // Rank ataması
    const totalCharacters = assignUniqueRanks();

    // Özet
    console.log("\n" + "=".repeat(50));
    console.log("🎉 İŞLEM TAMAMLANDI!");
    console.log("=".repeat(50));
    console.log(`   ✅ ${totalAdded} yeni karakter eklendi`);
    console.log(`   ⏭️  ${totalSkipped} karakter zaten vardı`);
    console.log(`   ❌ ${totalErrors} hata oluştu`);
    console.log(`   📊 Toplam karakter sayısı: ${totalCharacters}`);
}

// Script'i çalıştır
fetchAllCharacters();
