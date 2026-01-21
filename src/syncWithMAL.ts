// MAL (Jikan API) ile karakter senkronizasyonu
// Mevcut karakterlerin rank ve değerlerini MAL favorilerine göre günceller

import { db } from "./database/db";
import { searchCharacter, calculateRankFromFavorites, calculateValueFromFavorites } from "./utils/jikanApi";

const RATE_LIMIT_DELAY = 1100; // 1.1 saniye (Jikan rate limit: 3 req/sec, güvenli taraf)

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function syncWithMAL() {
    console.log("🔄 MAL Senkronizasyonu başlıyor...\n");

    // Tüm karakterleri al
    const characters = db.query("SELECT id, name, series FROM characters").all() as any[];

    let updated = 0;
    let notFound = 0;
    let errors = 0;

    for (let i = 0; i < characters.length; i++) {
        const char = characters[i];
        console.log(`[${i + 1}/${characters.length}] ${char.name} aranıyor...`);

        try {
            await delay(RATE_LIMIT_DELAY);
            const results = await searchCharacter(char.name);

            if (results.length > 0) {
                // En iyi eşleşmeyi bul (isim benzerliği)
                const match = results.find(r =>
                    r.name.toLowerCase() === char.name.toLowerCase() ||
                    r.name.toLowerCase().includes(char.name.toLowerCase()) ||
                    char.name.toLowerCase().includes(r.name.toLowerCase())
                ) || results[0];

                const favorites = match.favorites || 0;
                const rank = calculateRankFromFavorites(favorites);
                const value = calculateValueFromFavorites(favorites);
                const imageUrl = match.images?.jpg?.image_url || "";

                // Veritabanını güncelle
                db.run(
                    "UPDATE characters SET rank = ?, value = ?, image_url = ? WHERE id = ?",
                    [rank, value, imageUrl, char.id]
                );

                console.log(`  ✅ ${char.name}: ${favorites} fav → Rank #${rank}, ${value} SC`);
                updated++;
            } else {
                console.log(`  ⚠️  ${char.name}: MAL'da bulunamadı`);
                notFound++;
            }
        } catch (error) {
            console.error(`  ❌ ${char.name}: Hata -`, error);
            errors++;
        }
    }

    console.log(`\n🎉 Senkronizasyon tamamlandı!`);
    console.log(`   ✅ ${updated} karakter güncellendi`);
    console.log(`   ⚠️  ${notFound} karakter MAL'da bulunamadı`);
    console.log(`   ❌ ${errors} hata oluştu`);

    // Benzersiz rank ataması yap
    console.log(`\n🔄 Benzersiz rank ataması yapılıyor...`);
    assignUniqueRanks();
}

// Tüm karakterlere değerlerine göre benzersiz rank ata
function assignUniqueRanks() {
    const characters = db.query(`
        SELECT id, name, value 
        FROM characters 
        ORDER BY value DESC, id ASC
    `).all() as any[];

    let updated = 0;
    for (let i = 0; i < characters.length; i++) {
        const newRank = i + 1;
        db.run("UPDATE characters SET rank = ? WHERE id = ?", [newRank, characters[i].id]);
        updated++;
    }

    console.log(`   ✅ ${updated} karaktere benzersiz rank atandı (1-${characters.length})`);
}

// Script'i çalıştır
syncWithMAL();

